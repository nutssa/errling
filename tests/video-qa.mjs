import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const videoPath = resolve(process.argv[2] || resolve(root, '../errling-demo.webm'));
const qa = resolve(root, 'data/qa');
mkdirSync(qa, { recursive: true });
const browser = await chromium.launch({ channel:'chrome', headless:true });
try {
  const page = await browser.newPage({ viewport:{width:1280,height:720} });
  await page.goto(pathToFileURL(videoPath).href);
  const video = page.locator('video');
  await video.waitFor();
  const duration = await video.evaluate(async element => {
    const media = element;
    if (media.readyState < 1) await new Promise(resolve => media.addEventListener('loadedmetadata', resolve, {once:true}));
    return media.duration;
  });
  for (const at of [2, 55, 105, Math.max(0, duration - 4)]) {
    await video.evaluate(async (element, second) => {
      const media = element;
      media.currentTime = second;
      await new Promise(resolve => media.addEventListener('seeked', resolve, {once:true}));
    }, at);
    await page.screenshot({ path:resolve(qa, `video-${Math.round(at)}.png`) });
  }
  console.log(`Video duration: ${duration.toFixed(1)} seconds`);
} finally { await browser.close(); }
