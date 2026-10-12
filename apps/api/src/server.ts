import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { EventEmitter } from 'node:events';
import { chromium, type Browser } from 'playwright';
import { Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { z } from 'zod';
import { analyzeRoundTrip, createReferenceFixture, decodeTransaction, signWithControlledWallet, type AppMode, type ProfileId, type TransactionEvidence } from '../../../packages/solana-engine/src/index.ts';
import { inspectTransaction, InspectionError } from '../../../packages/solana-engine/src/inspector.ts';

const root = resolve(import.meta.dirname, '../../..');
const dbPath = resolve(root, process.env.ERRLING_DB_PATH || 'data/errling.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, target_url TEXT NOT NULL, profile TEXT NOT NULL, app_mode TEXT NOT NULL, interaction_mode TEXT NOT NULL, state TEXT NOT NULL, error_code TEXT, report_json TEXT); CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, sequence INTEGER NOT NULL, timestamp TEXT NOT NULL, type TEXT NOT NULL, source TEXT NOT NULL, payload_json TEXT NOT NULL, UNIQUE(run_id, sequence));');
if (!(db.prepare('PRAGMA table_info(runs)').all() as Array<{name:string}>).some(column => column.name === 'configuration_json')) db.exec('ALTER TABLE runs ADD COLUMN configuration_json TEXT');
const bus = new EventEmitter();
bus.setMaxListeners(100);
const active = new Map<string, Browser>();
const reservedRuns = new Set<string>();
const terminal = new Set(['COMPLETED', 'FAILED', 'TIMED_OUT', 'CANCELLED']);
const profiles = [
  { id: 'BASELINE_VERBATIM_V1', name: 'Baseline Wallet', description: 'Signs the unchanged legacy transaction message.', behavior: 'No message mutation', versions: ['legacy'] },
  { id: 'WALLET_APPENDED_INSTRUCTION_V1', name: 'Wallet-Appended Instruction', description: 'Appends a deterministic Memo before wallet signing.', behavior: 'Adds one diagnostic Memo', versions: ['legacy'] },
  { id: 'SIGN_ONLY_V1', name: 'Sign-Only Wallet', description: 'Advertises signTransaction and omits signAndSendTransaction.', behavior: 'Missing optional feature', versions: ['legacy'] }
] as const;
const profileIds = profiles.map(p => p.id) as [ProfileId, ...ProfileId[]];
const runSchema = z.object({
  targetUrl: z.string().url().max(300), profile: z.enum(profileIds), appMode: z.enum(['vulnerable', 'protected']).default('protected'),
  interactionMode: z.enum(['automated', 'guided']).default('automated'),
  interactionPlan: z.array(z.object({ selector: z.string().min(1).max(120), action: z.enum(['click']) })).max(8).optional(),
  broadcastEnabled: z.boolean().default(false)
});
type RunConfig = z.infer<typeof runSchema>;
type RunRow = { id: string; created_at: string; updated_at: string; target_url: string; profile: ProfileId; app_mode: AppMode; interaction_mode: string; state: string; error_code: string | null; report_json: string | null };
const iso = () => new Date().toISOString();
const row = (id: string) => db.prepare('SELECT * FROM runs WHERE id=?').get(id) as RunRow | undefined;
function event(runId: string, type: string, source: string, payload: Record<string, unknown> = {}) {
  const result = db.prepare('SELECT COALESCE(MAX(sequence),0)+1 AS next FROM events WHERE run_id=?').get(runId) as { next: number };
  const envelope = { schemaVersion: 1, id: randomUUID(), runId, sequence: result.next, timestamp: iso(), type, source, payload };
  db.prepare('INSERT INTO events VALUES (?,?,?,?,?,?,?)').run(envelope.id, runId, envelope.sequence, envelope.timestamp, type, source, JSON.stringify(payload));
  bus.emit(runId, envelope);
  return envelope;
}
function state(runId: string, value: string, errorCode: string | null = null) {
  const current = row(runId);
  if (!current || terminal.has(current.state)) return;
  db.prepare('UPDATE runs SET state=?,updated_at=?,error_code=? WHERE id=?').run(value, iso(), errorCode, runId);
  event(runId, 'run.state', 'runner', { state: value, errorCode });
}
function saveReport(id: string, report: unknown) {
  db.prepare('UPDATE runs SET report_json=?,updated_at=? WHERE id=?').run(JSON.stringify(report), iso(), id);
}
function isLoopbackUrl(value: string) {
  try { const u = new URL(value); return u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) && !!u.port && !u.username && !u.password; }
  catch { return false; }
}
function reportFrom(id: string) {
  const run = row(id);
  return run?.report_json ? JSON.parse(run.report_json) as Record<string, unknown> : null;
}
async function executeRun(id: string, config: RunConfig) {
  let browser: Browser | undefined;
  const wallet = Keypair.generate();
  let capture: { requestId: string; before: TransactionEvidence; after: TransactionEvidence } | null = null;
  let appOutcome = 'inconclusive';
  let observedError: string | null = null;
  let notifySigned: (() => void) | null = null;
  const signedObserved = new Promise<void>(resolve => { notifySigned = resolve; });
  const started = Date.now();
  try {
    state(id, 'STARTING_BROWSER');
    const script = readFileSync(resolve(root, 'packages/wallet-runtime/dist/wallet.js'), 'utf8');
    const icon = readFileSync(resolve(root, 'apps/web/public/errling-icon.svg')).toString('base64');
    browser = await chromium.launch({ channel: 'chrome', headless: config.interactionMode !== 'guided', executablePath: process.env.ERRLING_CHROMIUM_PATH || undefined });
    active.set(id, browser);
    const context = await browser.newContext({ acceptDownloads: false, permissions: [], serviceWorkers: 'block' });
    context.setDefaultTimeout(15000);
    const walletConfig = { address: wallet.publicKey.toBase58(), publicKey: Array.from(wallet.publicKey.toBytes()), profile: config.profile, icon: `data:image/svg+xml;base64,${icon}`, broadcastEnabled: config.broadcastEnabled };
    await context.exposeBinding('__errlingBridge', async (source, request: { action: string; transactionBase64?: string; chain?: string }) => {
      if (source.frame !== source.page.mainFrame() || !isLoopbackUrl(source.frame.url())) throw new Error('Wallet bridge is limited to local top-level application pages');
      if (request.action === 'connect') { event(id, 'wallet.connected', 'wallet', { account: walletConfig.address }); return {}; }
      if (!request.transactionBase64 || request.transactionBase64.length > 5000) throw new Error('Invalid signing payload');
      if (request.action !== 'signTransaction' && request.action !== 'signAndSendTransaction') throw new Error('Unsupported wallet operation');
      state(id, 'SIGN_REQUEST_RECEIVED');
      const walletRequestId = randomUUID();
      event(id, 'wallet.signing-requested', 'wallet', { action: request.action, requestId: walletRequestId });
      const signed = signWithControlledWallet(request.transactionBase64, config.profile, wallet);
      capture = { requestId: walletRequestId, before: signed.before, after: signed.after };
      (notifySigned as (() => void) | null)?.();
      event(id, 'wallet.transaction-captured', 'wallet', { requestId: walletRequestId, phase: 'input', messageHash: signed.before.messageHash, size: Buffer.from(request.transactionBase64, 'base64').length });
      event(id, 'wallet.transaction-captured', 'wallet', { requestId: walletRequestId, phase: 'output', messageHash: signed.after.messageHash, size: Buffer.from(signed.outputBase64, 'base64').length });
      if (request.action === 'signAndSendTransaction') {
        if (!config.broadcastEnabled || request.chain !== 'solana:devnet') throw new Error('Devnet broadcast requires explicit opt-in');
        const response = await fetch('https://api.devnet.solana.com', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sendTransaction', params: [signed.outputBase64, { encoding: 'base64', skipPreflight: false }] }), signal: AbortSignal.timeout(12000) });
        const result = await response.json() as { result?: string; error?: { message: string } };
        if (!result.result) throw new Error(result.error?.message || 'Devnet rejected the transaction');
        event(id, 'network.submitted', 'rpc', { signature: result.result, network: 'devnet', confirmation: 'not checked' });
        return { signatureBase64: Buffer.from(bs58.decode(result.result)).toString('base64') };
      }
      return { outputBase64: signed.outputBase64 };
    });
    await context.addInitScript({ content: `if(window.top===window){window.__ERRLING_CONFIG__=${JSON.stringify(walletConfig)};\n${script}}` });
    const page = await context.newPage();
    await page.route('**/*', route => {
      if (route.request().isNavigationRequest() && route.request().frame() === page.mainFrame() && !isLoopbackUrl(route.request().url())) return route.abort();
      return route.continue();
    });
    page.on('pageerror', error => { observedError = error.message.slice(0, 300); event(id, 'app.page-error', 'browser', { message: observedError }); });
    page.on('console', message => { if (message.type() === 'error') event(id, 'app.console-error', 'browser', { message: message.text().slice(0, 300) }); });
    const target = new URL(config.targetUrl);
    if (target.port === '3001') { target.searchParams.set('mode', config.appMode); target.searchParams.set('profile', config.profile); }
    const response = await page.goto(target.toString(), { waitUntil: 'domcontentloaded', timeout: 15000 });
    if (!response?.ok()) throw new Error(`Target returned HTTP ${response?.status() ?? 'no response'}`);
    event(id, 'wallet.registered', 'runner', { name: 'Errling Controlled Wallet', profile: config.profile, features: walletConfig.broadcastEnabled && config.profile !== 'SIGN_ONLY_V1' ? ['solana:signTransaction','solana:signAndSendTransaction'] : ['solana:signTransaction'] });
    state(id, 'WAITING_FOR_INTERACTION');
    if (config.interactionMode === 'automated') {
      const plan = config.interactionPlan ?? [{ selector: '[data-testid="connect-wallet"]', action: 'click' as const }, { selector: '[data-testid="run-signing"]', action: 'click' as const }];
      for (const step of plan) { await page.locator(step.selector).click(); event(id, 'interaction.step', 'runner', { selector: step.selector, action: step.action, result: 'completed' }); }
      await page.locator('[data-testid="outcome"]').waitFor({ state: 'visible', timeout: 20000 });
      appOutcome = await page.locator('[data-testid="outcome"]').getAttribute('data-outcome') || 'inconclusive';
      const outcomeText = await page.locator('[data-testid="outcome"]').innerText();
      event(id, 'app.outcome', 'browser', { outcome: appOutcome, text: outcomeText.slice(0, 400) });
    } else {
      let timeout: NodeJS.Timeout | undefined;
      try { await Promise.race([signedObserved, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('No signing request was observed within 90 seconds of guided interaction')), 90000); })]); }
      finally { if (timeout) clearTimeout(timeout); }
      await page.waitForTimeout(1000);
      const observed = page.locator('[data-testid="outcome"]');
      if (await observed.count()) {
        appOutcome = await observed.getAttribute('data-outcome') || 'inconclusive';
        event(id, 'app.outcome', 'browser', { outcome: appOutcome, text: (await observed.innerText()).slice(0, 400) });
      } else {
        event(id, 'app.outcome-unavailable', 'runner', { reason: 'No application outcome selector was configured. Wallet transaction evidence was captured.' });
      }
    }
    state(id, 'ANALYZING');
    const captured = capture as { before: TransactionEvidence; after: TransactionEvidence } | null;
    const analysis = captured ? analyzeRoundTrip(captured.before, captured.after, config.appMode, appOutcome) : null;
    const capabilityFinding = config.profile === 'SIGN_ONLY_V1' && appOutcome === 'missing-capability-error' ? [{ ruleId: 'ERR-CAP-001', title: 'Unsupported wallet capability assumed', severity: 'warning', evidence: 'Observed', explanation: 'The wallet did not advertise solana:signAndSendTransaction, and the example application attempted to call it.', fix: 'Check both wallet and account features before invoking an optional signing method.' }] : [];
    const report = { schemaVersion: 1, id, createdAt: row(id)?.created_at, completedAt: iso(), targetUrl: config.targetUrl, profile: config.profile, appMode: config.appMode, interactionMode: config.interactionMode, interactionPlan: config.interactionPlan ?? null, network: 'devnet', broadcastEnabled: config.broadcastEnabled, broadcastStatus: 'not-submitted', outcome: appOutcome, observedError, durationMs: Date.now() - started, capture, analysis, findings: [...(analysis?.findings ?? []), ...capabilityFinding], applicationHandling: analysis?.applicationHandling ?? (appOutcome === 'capability-checked' ? 'handled-correctly' : appOutcome === 'missing-capability-error' ? 'unsafe-assumption' : 'inconclusive'), note: 'Controlled, disposable wallet behavior. Off-chain signing is not an on-chain confirmation.' };
    saveReport(id, report);
    state(id, 'COMPLETED');
  } catch (error) {
    if (!terminal.has(row(id)?.state ?? '')) {
      const message = error instanceof Error ? error.message : String(error);
      event(id, 'run.error', 'runner', { message: message.slice(0, 300) });
      saveReport(id, { schemaVersion: 1, id, createdAt: row(id)?.created_at, targetUrl: config.targetUrl, profile: config.profile, appMode: config.appMode, outcome: 'environment-failure', error: message.slice(0, 300), findings: [{ ruleId: 'ERR-ENV-001', title: 'Diagnostic environment could not complete the test', severity: 'info', evidence: 'Observed', explanation: message.slice(0, 300), fix: 'Check the local target, browser installation, and interaction selectors.' }] });
      state(id, 'FAILED', 'RUN_FAILED');
    }
  } finally { active.delete(id); reservedRuns.delete(id); await browser?.close().catch(() => {}); }
}

function send(res: ServerResponse, status: number, data: unknown, requestId: string) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ requestId, data })); }
function fail(res: ServerResponse, status: number, code: string, message: string, requestId: string) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ requestId, error: { code, message } })); }
async function body(req: IncomingMessage): Promise<unknown> {
  let text = '';
  for await (const chunk of req) { text += chunk; if (text.length > 10000) throw new Error('Request body too large'); }
  return text ? JSON.parse(text) as unknown : {};
}
function markdown(report: Record<string, unknown>) {
  const lines = [`# Errling report ${report.id}`, '', `- Profile: ${report.profile}`, `- Target: ${report.targetUrl}`, `- Application mode: ${report.appMode}`, `- Outcome: ${report.outcome}`, `- Broadcast: ${report.broadcastStatus ?? 'not-submitted'}`, ''];
  const capture = report.capture as { before?: TransactionEvidence; after?: TransactionEvidence } | null;
  if (capture?.before && capture.after) lines.push('## Message evidence', '', `- Original SHA-256: ${capture.before.messageHash}`, `- Returned SHA-256: ${capture.after.messageHash}`, '', '## Signature verification', '', ...capture.after.signatures.map(s => `- ${s.signer}: ${s.state}`), '');
  lines.push('## Findings', '');
  for (const f of report.findings as Array<{ruleId:string;title:string;explanation:string;fix:string}> ?? []) lines.push(`### ${f.ruleId} — ${f.title}`, '', f.explanation, '', `Fix: ${f.fix}`, '');
  lines.push('Evidence is from a controlled wallet test. No on-chain confirmation is implied.');
  return lines.join('\n');
}
const server = createServer(async (req, res) => {
  const requestId = randomUUID();
  const origin = req.headers.origin;
  if (origin && ['http://127.0.0.1:3000','http://localhost:3000','http://127.0.0.1:3001','http://localhost:3001'].includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (origin && !res.hasHeader('Access-Control-Allow-Origin')) { fail(res, 403, 'ORIGIN_DENIED', 'This local API only accepts the Errling web and reference app origins.', requestId); return; }
  const url = new URL(req.url ?? '/', 'http://127.0.0.1:3100');
  const path = url.pathname;
  try {
    if (path === '/api/v1/health' && req.method === 'GET') return send(res, 200, { status: 'ok', database: dbPath, browser: 'Chrome via Playwright' }, requestId);
    if (path === '/api/v1/profiles' && req.method === 'GET') return send(res, 200, profiles, requestId);
    if (path === '/api/v1/fixture' && req.method === 'GET') {
      const wallet = new PublicKey(url.searchParams.get('wallet') ?? '');
      return send(res, 200, createReferenceFixture(wallet), requestId);
    }
    if (path === '/api/v1/runs' && req.method === 'GET') {
      const runs = db.prepare('SELECT id,created_at,updated_at,target_url,profile,app_mode,interaction_mode,state,error_code FROM runs ORDER BY created_at DESC LIMIT 100').all() as Array<{id:string}>;
      return send(res, 200, runs.map(run => ({ ...run, report: reportFrom(run.id) ? { findings: reportFrom(run.id)?.findings } : null })), requestId);
    }
    if (path === '/api/v1/runs' && req.method === 'POST') {
      const parsed = runSchema.safeParse(await body(req));
      if (!parsed.success) return fail(res, 400, 'INVALID_CONFIGURATION', parsed.error.issues.map(i=>i.message).join('; '), requestId);
      const config = parsed.data;
      if (!isLoopbackUrl(config.targetUrl)) return fail(res, 400, 'TARGET_NOT_LOCAL', 'Only explicit loopback HTTP URLs with a port are supported.', requestId);
      if (config.broadcastEnabled && config.profile === 'WALLET_APPENDED_INSTRUCTION_V1') return fail(res, 400, 'UNSAFE_BROADCAST', 'Mutation tests cannot broadcast.', requestId);
      if (reservedRuns.size >= 1) return fail(res, 429, 'RUNNER_BUSY', 'One browser run can execute at a time.', requestId);
      const id = randomUUID(), now = iso();
      reservedRuns.add(id);
      db.prepare('INSERT INTO runs (id,created_at,updated_at,target_url,profile,app_mode,interaction_mode,state,error_code,report_json,configuration_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id, now, now, config.targetUrl, config.profile, config.appMode, config.interactionMode, 'CREATED', null, null, JSON.stringify(config));
      event(id, 'run.created', 'api', { profile: config.profile, appMode: config.appMode, targetUrl: config.targetUrl });
      void executeRun(id, config);
      return send(res, 201, { id, state: 'CREATED' }, requestId);
    }
    const runMatch = /^\/api\/v1\/runs\/([^/]+)(?:\/(events|report|export|cancel))?$/.exec(path);
    if (runMatch) {
      const id = runMatch[1], action = runMatch[2];
      const run = row(id);
      if (!run) return fail(res, 404, 'RUN_NOT_FOUND', 'No run has this identifier.', requestId);
      if (!action && req.method === 'GET') return send(res, 200, { ...run, report_json: undefined, report: reportFrom(id) }, requestId);
      if (action === 'report' && req.method === 'GET') return reportFrom(id) ? send(res, 200, reportFrom(id), requestId) : fail(res, 409, 'REPORT_NOT_READY', 'The report is not ready.', requestId);
      if (action === 'cancel' && req.method === 'POST') { if (!terminal.has(run.state)) { saveReport(id, { schemaVersion: 1, id, createdAt: run.created_at, targetUrl: run.target_url, profile: run.profile, appMode: run.app_mode, outcome: 'cancelled', findings: [], applicationHandling: 'inconclusive', note: 'The run was cancelled before a complete diagnosis could be made.' }); state(id, 'CANCELLED'); await active.get(id)?.close(); } return send(res, 200, { state: row(id)?.state }, requestId); }
      if (action === 'export' && req.method === 'GET') {
        const report = reportFrom(id);
        if (!report) return fail(res, 409, 'REPORT_NOT_READY', 'The report is not ready.', requestId);
        const format = url.searchParams.get('format');
        if (format !== 'json' && format !== 'markdown') return fail(res, 400, 'INVALID_FORMAT', 'Use json or markdown.', requestId);
        res.writeHead(200, { 'Content-Type': format === 'json' ? 'application/json' : 'text/markdown; charset=utf-8', 'Content-Disposition': `attachment; filename="errling-${id}.${format === 'json' ? 'json' : 'md'}"` });
        res.end(format === 'json' ? JSON.stringify(report, null, 2) : markdown(report)); return;
      }
      if (action === 'events' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        const events = db.prepare('SELECT id,run_id AS runId,sequence,timestamp,type,source,payload_json FROM events WHERE run_id=? ORDER BY sequence').all(id) as Array<{id:string;runId:string;sequence:number;timestamp:string;type:string;source:string;payload_json:string}>;
        for (const item of events) res.write(`data: ${JSON.stringify({ ...item, payload: JSON.parse(item.payload_json), payload_json: undefined })}\n\n`);
        if (terminal.has(run.state)) { res.end(); return; }
        const listener = (item: unknown) => { res.write(`data: ${JSON.stringify(item)}\n\n`); if (terminal.has(row(id)?.state ?? '')) { bus.off(id, listener); res.end(); } };
        bus.on(id, listener); req.on('close', () => bus.off(id, listener)); return;
      }
    }
    if (path === '/api/v1/transactions/inspect' && req.method === 'POST') {
      const parsed = z.object({ signature: z.string().min(40).max(100), network: z.enum(['devnet','mainnet']) }).safeParse(await body(req));
      if (!parsed.success) return fail(res, 400, 'INVALID_INPUT', 'Provide a Solana signature and supported network.', requestId);
      try { return send(res, 200, await inspectTransaction(parsed.data.signature, parsed.data.network), requestId); }
      catch (error) { if (error instanceof InspectionError) return fail(res, error.status, error.code, error.message, requestId); throw error; }
    }
    fail(res, 404, 'NOT_FOUND', 'No route exists here.', requestId);
  } catch (error) { fail(res, 500, 'SERVER_ERROR', error instanceof Error ? error.message : 'Unexpected server error', requestId); }
});
server.listen(Number(process.env.ERRLING_API_PORT || 3100), '127.0.0.1', () => console.log('Errling API listening on http://127.0.0.1:3100'));
