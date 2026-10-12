import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:3000/';
const API = 'http://127.0.0.1:3100/api/v1';
const SIGNATURE = '43UL9vSzwqwjKVf6qLQAWo2bBnebp78nTCBsPsNjcAobwY3UYbjSPhR5Spr3RBULWhTNJuW5UhkdSzosKhZyW1ux';
const output = resolve(import.meta.dirname, '../data/qa/audit-results.json');
mkdirSync(resolve(import.meta.dirname, '../data/qa'), { recursive: true });
const evidence = { timestamp: new Date().toISOString(), scenarios: [], ui: [], consoleErrors: [], pageErrors: [] };

async function api(path, init) {
  const response = await fetch(`${API}${path}`, init);
  const body = await response.json();
  return { status: response.status, ...body };
}
async function terminal(id) {
  for (let i = 0; i < 90; i++) {
    const result = await api(`/runs/${id}`);
    if (['COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT'].includes(result.data?.state)) return result.data;
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  throw new Error(`Run ${id} did not reach a terminal state`);
}
function assertCaptured(report) {
  assert.ok(report.capture?.before?.serializedBase64?.length > 100);
  assert.ok(report.capture?.after?.serializedBase64?.length > 100);
  assert.ok(report.capture.before.messageBase64);
  assert.ok(report.capture.after.messageBase64);
  assert.equal(report.broadcastStatus, 'not-submitted');
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage();
page.on('console', message => { if (message.type() === 'error') evidence.consoleErrors.push(message.text()); });
page.on('pageerror', error => evidence.pageErrors.push(error.message));

async function start(profile, mode) {
  await page.goto(`${BASE}#/new`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Try Example App/i }).click();
  await page.locator('.profile-card').filter({ hasText: profile }).click();
  await page.locator('.segmented.wide').getByRole('button', { name: `${mode} Flow` }).click();
  await page.getByRole('button', { name: 'Start Trace' }).click();
  await page.waitForURL(/#\/runs\/[a-f0-9-]+$/);
  const id = new URL(page.url()).hash.split('/')[2];
  const run = await terminal(id);
  assert.equal(run.state, 'COMPLETED', `${profile}/${mode}: ${run.report?.error || run.error_code}`);
  assert.equal(run.report?.id, id);
  const events = await fetch(`${API}/runs/${id}/events`).then(r => r.text());
  evidence.scenarios.push({ id, profile, mode, outcome: run.report?.outcome, handling: run.report?.applicationHandling, findings: run.report?.findings?.map(f => f.ruleId), eventTypes: [...events.matchAll(/"type":"([^"]+)"/g)].map(m => m[1]) });
  return { id, report: run.report, events };
}

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await page.locator('.hero-primary').click();
  await page.getByRole('heading', { name: 'Configure a trace' }).waitFor();
  evidence.ui.push('Overview and theme toggle');

  await page.getByRole('link', { name: 'Overview' }).click();
  await page.getByRole('button', { name: /Inspect an existing transaction/i }).click();
  await page.getByRole('heading', { name: 'Inspect a transaction' }).waitFor();
  assert.equal(await page.evaluate(() => scrollY), 0, 'New route should open at the top');
  await page.getByLabel('Transaction signature').fill('not-a-signature');
  await page.getByRole('button', { name: 'Inspect', exact: true }).click();
  await page.getByRole('alert').waitFor();
  await page.getByLabel('Transaction signature').fill(SIGNATURE);
  await page.getByLabel('Network').selectOption('mainnet');
  assert.equal(await page.getByLabel('Network').inputValue(), 'mainnet');
  await page.getByLabel('Network').selectOption('devnet');
  await page.getByRole('button', { name: 'Inspect', exact: true }).click();
  await page.locator('.rpc-banner').waitFor({ timeout: 25000 });
  assert.match(await page.locator('.inspector-grid').innerText(), /510,234,379/);
  assert.match(await page.locator('.inspector-grid').innerText(), /0\.000105000 SOL/);
  evidence.ui.push('Inspector: invalid input and live Devnet transaction, slot 510234379');

  await page.getByRole('link', { name: 'Documentation' }).click();
  await page.getByRole('heading', { name: 'How Errling works' }).waitFor();
  await page.getByRole('button', { name: 'New Trace' }).click();
  await page.getByRole('heading', { name: 'Configure a trace' }).waitFor();
  await page.getByRole('button', { name: /Test Local dApp/i }).click();
  await page.getByRole('button', { name: 'Configured selectors' }).click();
  assert.equal(await page.getByLabel('Connect button selector').inputValue(), '[data-testid="connect-wallet"]');
  await page.getByLabel('Local application URL').fill('https://example.com');
  await page.getByRole('button', { name: 'Start Trace' }).click();
  await page.getByRole('alert').getByText(/loopback/i).waitFor();
  evidence.ui.push('Documentation CTA, local dApp fields, selector controls, nonlocal URL rejection');

  const baseline = await start('Baseline Wallet', 'Protected');
  assertCaptured(baseline.report);
  assert.equal(baseline.report.analysis.messageChanged, false);
  assert.equal(baseline.report.capture.before.messageHash, baseline.report.capture.after.messageHash);
  assert.equal(baseline.report.capture.after.signatures.filter(s => s.state === 'valid').length, 2);
  assert.match(baseline.events, /wallet\.connected/);
  assert.match(baseline.events, /wallet\.signing-requested/);
  assert.match(baseline.events, /wallet\.transaction-captured/);
  assert.match(baseline.events, /app\.outcome/);
  assert.equal(baseline.report.outcome, 'accepted');

  const vulnerable = await start('Wallet-Appended Instruction', 'Vulnerable');
  assertCaptured(vulnerable.report);
  assert.equal(vulnerable.report.analysis.messageChanged, true);
  assert.equal(vulnerable.report.analysis.earlierSignatureAgainstReturnedMessage, false);
  assert.equal(vulnerable.report.analysis.instructionDiff.length, 1);
  assert.equal(vulnerable.report.analysis.instructionDiff[0].instruction.programId, 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
  assert.ok(vulnerable.report.capture.after.signatures.some(s => s.state === 'invalid'));
  assert.ok(vulnerable.report.capture.after.signatures.some(s => s.state === 'valid'));
  assert.deepEqual(vulnerable.report.findings.map(f => f.ruleId).sort(), ['ERR-MSG-001', 'ERR-SIG-001']);
  assert.equal(vulnerable.report.applicationHandling, 'unsafe-assumption');
  await page.getByRole('heading', { name: 'Before / after' }).waitFor();
  await page.getByRole('heading', { name: 'Required signatures' }).waitFor();
  await page.getByText('Freeze the message before collecting signatures. If any instruction changes, rebuild the transaction and collect fresh signatures.').waitFor();
  await page.locator('.raw-evidence summary').click();
  assert.ok((await page.locator('.raw-line').first().innerText()).length > 100);
  await page.getByRole('button', { name: 'Copy to clipboard' }).first().click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), vulnerable.report.capture.before.messageHash);
  await page.getByRole('button', { name: 'Copy suggested fix to clipboard' }).first().click();
  assert.ok((await page.evaluate(() => navigator.clipboard.readText())).length > 20);

  const protectedRun = await start('Wallet-Appended Instruction', 'Protected');
  assertCaptured(protectedRun.report);
  assert.equal(protectedRun.report.analysis.messageChanged, true);
  assert.equal(protectedRun.report.analysis.earlierSignatureAgainstReturnedMessage, false);
  assert.equal(protectedRun.report.applicationHandling, 'handled-correctly');
  assert.equal(protectedRun.report.outcome, 'rejected-integrity-change');

  const signOnlyUnsafe = await start('Sign-Only Wallet', 'Vulnerable');
  assert.equal(signOnlyUnsafe.report.outcome, 'missing-capability-error');
  assert.equal(signOnlyUnsafe.report.applicationHandling, 'unsafe-assumption');
  assert.ok(signOnlyUnsafe.report.findings.some(f => f.ruleId === 'ERR-CAP-001'));
  const signOnlySafe = await start('Sign-Only Wallet', 'Protected');
  assert.equal(signOnlySafe.report.outcome, 'capability-checked');
  assert.equal(signOnlySafe.report.applicationHandling, 'handled-correctly');

  await page.goto(`${BASE}#/runs/${vulnerable.id}`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Message changed at the wallet boundary', exact: true }).waitFor();
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Message changed at the wallet boundary', exact: true }).waitFor();
  const jsonResponse = page.waitForResponse(response => response.url().includes(`/runs/${vulnerable.id}/export?format=json`));
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const json = await jsonResponse;
  assert.equal(json.status(), 200);
  const exported = await fetch(`${API}/runs/${vulnerable.id}/export?format=json`).then(response => response.json());
  assert.equal(exported.id, vulnerable.id);
  assert.equal(exported.capture.after.messageHash, vulnerable.report.capture.after.messageHash);
  const mdResponse = page.waitForResponse(response => response.url().includes(`/runs/${vulnerable.id}/export?format=markdown`));
  await page.getByRole('button', { name: 'Export Markdown' }).click();
  const markdownResult = await mdResponse;
  assert.equal(markdownResult.status(), 200);
  const markdown = await fetch(`${API}/runs/${vulnerable.id}/export?format=markdown`).then(response => response.text());
  assert.match(markdown, /ERR-SIG-001/);
  assert.match(markdown, /Original SHA-256/);
  await page.getByRole('link', { name: 'Runs / History' }).click();
  await page.getByRole('heading', { name: 'Runs & reports' }).waitFor();
  await page.locator('.run-row').first().waitFor();
  assert.ok(await page.locator('.run-row').count() >= 5);
  await page.locator('.run-row').first().click();
  await page.locator('.report-heading').waitFor();
  evidence.ui.push('Saved report reopen, refresh, JSON and Markdown export responses, history row');

  await page.goto(`${BASE}#/new`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Test Local dApp/i }).click();
  await page.getByLabel('Local application URL').fill('http://127.0.0.1:3999');
  await page.getByRole('button', { name: 'Configured selectors' }).click();
  await page.getByRole('button', { name: 'Start Trace' }).click();
  await page.waitForURL(/#\/runs\/[a-f0-9-]+$/);
  const failedId = new URL(page.url()).hash.split('/')[2];
  const failed = await terminal(failedId);
  assert.equal(failed.state, 'FAILED');
  assert.equal(failed.report?.outcome, 'environment-failure');
  await page.getByText('Diagnostic environment could not complete the test').waitFor();
  evidence.ui.push(`Unreachable local dApp produces failed report (${failedId})`);

  await page.goto(`${BASE}#/new`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Test Local dApp/i }).click();
  await page.getByRole('button', { name: 'Configured selectors' }).click();
  await page.getByLabel('Sign button selector').fill('[data-testid="audit-never-click"]');
  await page.getByRole('button', { name: 'Start Trace' }).click();
  await page.waitForURL(/#\/runs\/[a-f0-9-]+$/);
  const cancelId = new URL(page.url()).hash.split('/')[2];
  await page.getByRole('button', { name: 'Cancel run' }).click();
  const cancelled = await terminal(cancelId);
  assert.equal(cancelled.state, 'CANCELLED');
  evidence.ui.push(`Cancel run from progress page (${cancelId})`);

  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Settings' }).waitFor();
  await page.getByText('Available').waitFor();
  evidence.ui.push('Settings health');

  const uiState = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const statePage = await uiState.newPage();
  await statePage.route(`${API}/runs`, async route => {
    await new Promise(resolve => setTimeout(resolve, 650));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ requestId: 'ui-state-check', data: [] }) });
  });
  await statePage.goto(BASE, { waitUntil: 'domcontentloaded' });
  await statePage.getByText('Loading local run history…').waitFor();
  await statePage.getByText('Your first trace starts here').waitFor();
  assert.equal(await statePage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await statePage.getByRole('button', { name: 'Open navigation' }).click();
  await statePage.getByRole('navigation').getByRole('link', { name: 'Documentation' }).click();
  await statePage.getByRole('heading', { name: 'How Errling works' }).waitFor();
  await uiState.close();
  evidence.ui.push('Loading and empty states, mobile width and drawer navigation');

  const sweep = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const sweepPage = await sweep.newPage();
  for (const route of ['/', '/new', '/runs', `/runs/${vulnerable.id}`, '/inspect', '/docs', '/settings']) {
    await sweepPage.goto(`${BASE}#${route}`, { waitUntil: 'networkidle' });
    assert.ok(await sweepPage.locator('main').count(), `${route}: main missing`);
    assert.equal(await sweepPage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${route}: horizontal overflow`);
  }
  await sweepPage.goto(BASE, { waitUntil: 'networkidle' });
  const duration = await sweepPage.locator('.firefly-sculpture').evaluate(element => getComputedStyle(element).animationDuration);
  assert.ok(duration.split(',').every(value => Number.parseFloat(value) <= .01), `Reduced motion duration ${duration}`);
  await sweep.close();
  evidence.ui.push('All seven routes at phone width; reduced-motion preference');

  assert.deepEqual(evidence.pageErrors, [], 'Uncaught browser page errors');
  assert.deepEqual(evidence.consoleErrors.filter(message => !message.includes('status of 400')), [], 'Unexpected browser console errors');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  writeFileSync(output, JSON.stringify(evidence, null, 2));
  await context.close();
  await browser.close();
}
