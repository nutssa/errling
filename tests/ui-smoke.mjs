import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const id = process.argv[2];
const out = resolve(import.meta.dirname, '../data/qa');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await desktop.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
  await desktop.screenshot({ path: resolve(out, 'overview-desktop.png'), fullPage: true });
  await desktop.getByRole('button', { name: 'Switch to light theme' }).click();
  await desktop.screenshot({ path: resolve(out, 'overview-light-desktop.png'), fullPage: true });
  await desktop.getByRole('button', { name: 'Switch to dark theme' }).click();
  await desktop.goto('http://127.0.0.1:3000/#/new', { waitUntil: 'networkidle' });
  await desktop.screenshot({ path: resolve(out, 'new-trace-desktop.png'), fullPage: true });
  if (id) {
    await desktop.goto(`http://127.0.0.1:3000/#/runs/${id}`, { waitUntil: 'networkidle' });
    await desktop.getByText('Required signatures').waitFor();
    await desktop.screenshot({ path: resolve(out, 'report-desktop.png'), fullPage: true });
  }
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await mobile.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
  await mobile.screenshot({ path: resolve(out, 'overview-mobile.png'), fullPage: true });
  await mobile.getByRole('button', { name: 'Open navigation' }).click();
  await mobile.getByRole('navigation').getByRole('link', { name: 'New Trace' }).click();
  await mobile.getByText('Configure a trace').waitFor();
  await mobile.waitForTimeout(300);
  if (await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Mobile page overflows horizontally');
  await mobile.screenshot({ path: resolve(out, 'new-trace-mobile.png'), fullPage: true });
  const example = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  await example.goto('http://127.0.0.1:3001/?mode=protected', { waitUntil: 'networkidle' });
  await example.screenshot({ path: resolve(out, 'reference-app.png'), fullPage: true });
  console.log(`UI smoke passed. Screenshots: ${out}`);
} finally { await browser.close(); }
