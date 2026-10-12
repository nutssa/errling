import { chromium } from 'playwright';
import { mkdirSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const temp = resolve(root, 'data/demo-video');
const output = resolve(root, 'errling-demo.webm');
mkdirSync(temp, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, recordVideo: { dir: temp, size: { width: 1280, height: 720 } } });
const page = await context.newPage();
const pause = ms => page.waitForTimeout(ms);
const panTo = (to, duration) => page.evaluate(({to,duration}) => new Promise(resolve => {
  const from = scrollY;
  let started;
  const tick = now => {
    started ??= now;
    const t = Math.min(1, (now - started) / duration);
    const eased = t*t*(3-2*t);
    scrollTo({ top: from + (to - from)*eased, behavior:'instant' });
    if (t < 1) requestAnimationFrame(tick); else resolve();
  };
  requestAnimationFrame(tick);
}), {to,duration});
const caption = async text => page.evaluate(value => {
  let element = document.getElementById('errling-video-caption');
  if (!element) {
    element = document.createElement('div');
    element.id = 'errling-video-caption';
    Object.assign(element.style, { position:'fixed', bottom:'19px', left:'50%', transform:'translateX(-50%)', zIndex:'9999', maxWidth:'90%', padding:'12px 19px', borderRadius:'2px', borderLeft:'2px solid #f3604e', background:'rgba(10,16,18,.94)', color:'#f2efe8', font:'600 16px Instrument Sans, sans-serif', textAlign:'center', boxShadow:'0 8px 25px #0007', pointerEvents:'none' });
    document.body.appendChild(element);
  }
  element.textContent = value;
}, text);
const newTrace = async () => { await page.getByRole('link', { name: 'New Trace' }).click(); await page.getByText('Configure a trace').waitFor(); };
const run = async () => { await page.getByRole('button', { name: 'Start Trace' }).click(); await page.locator('.report-heading .badge.success').waitFor({ timeout: 30000 }); };
try {
  await page.goto('http://127.0.0.1:3000/', { waitUntil:'networkidle' });
  await caption('Errling · A transaction round-trip debugger for Solana dApps');
  await pause(4200);
  const story = await page.locator('.motion-story').evaluate(element => ({ top: element.getBoundingClientRect().top + scrollY, height: element.offsetHeight, view: innerHeight }));
  await caption('Follow the exact bytes: capture → compare → verify');
  await panTo(story.top - 73, 1800);
  await panTo(story.top - 73 + story.height - story.view + 73, 8000);
  await pause(600);

  await newTrace();
  await caption('1 · Baseline wallet preserves the transaction message');
  await page.locator('.profile-card').filter({hasText:'Baseline Wallet'}).click();
  await page.locator('.segmented.wide').getByRole('button', { name:'Protected Flow' }).click();
  await pause(6000); await run();
  await caption('Baseline: message hashes match; both required signatures verify');
  await pause(16000);
  await page.getByRole('heading', { name: 'Required signatures' }).scrollIntoViewIfNeeded(); await pause(11000);

  await newTrace();
  await page.locator('.profile-card').filter({hasText:'Wallet-Appended Instruction'}).click();
  await page.locator('.segmented.wide').getByRole('button', { name:'Vulnerable Flow' }).click();
  await caption('2 · The controlled wallet appends one real Memo instruction');
  await pause(5000); await run();
  await caption('The original co-signer signature fails over the returned message');
  await pause(16000);
  await page.getByRole('heading', { name: 'Before / after' }).scrollIntoViewIfNeeded(); await pause(13000);
  await page.getByRole('heading', { name: 'Required signatures' }).scrollIntoViewIfNeeded(); await pause(12000);

  await newTrace();
  await page.locator('.profile-card').filter({hasText:'Wallet-Appended Instruction'}).click();
  await page.locator('.segmented.wide').getByRole('button', { name:'Protected Flow' }).click();
  await caption('3 · Same hazard, different application handling');
  await pause(5000); await run();
  await caption('Protected Flow rejects the unexpected message change correctly');
  await pause(18000);

  await page.getByRole('link', { name:'Overview' }).click();
  await caption('Controlled wallet · exact byte and signature evidence · safe application response');
  await pause(9000);
} finally {
  await context.close();
  const video = await page.video()?.path();
  await browser.close();
  if (video) { copyFileSync(video, output); console.log(`Recorded: ${output}`); }
}
