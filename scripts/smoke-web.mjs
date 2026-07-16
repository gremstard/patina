// Headless smoke test for the bundled world-map page. Renders dist/index.html
// in Chromium, asserts worldgen ran (digest matches), the canvas painted, the
// culture legend populated, and no console/page errors fired.
//
//   node scripts/bundle-web.js && node scripts/smoke-web.mjs
//
// CHROMIUM_PATH overrides the browser binary (defaults to the Playwright path).
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const exe = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const url = pathToFileURL(join(process.cwd(), 'dist', 'index.html')).href;
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 780 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);

const digest = await page.$eval('#digest', (e) => e.textContent);
const legendRows = await page.$$eval('#legend .cult', (els) => els.length);
const counts = await page.$$eval('#counts .tile', (els) => els.map((e) => `${e.querySelector('.n').textContent} ${e.querySelector('.k').textContent.trim()}`));
const painted = await page.evaluate(() => {
  const c = document.getElementById('map');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const first = `${d[0]},${d[1]},${d[2]}`;
  let diff = 0;
  for (let i = 0; i < d.length; i += 4000) if (`${d[i]},${d[i + 1]},${d[i + 2]}` !== first) diff++;
  return diff;
});
await browser.close();

const fail = [];
if (digest !== '88aa783f') fail.push(`digest ${digest} != 88aa783f (page worldgen drifted from the node test)`);
if (legendRows !== 4) fail.push(`legend rows ${legendRows} != 4`);
if (painted < 10) fail.push(`canvas looks blank (${painted} distinct pixels)`);
if (errors.length) fail.push(`console/page errors: ${errors.join(' | ')}`);

console.log('digest    :', digest);
console.log('legendRows:', legendRows);
console.log('counts    :', counts.join('  ·  '));
console.log('painted   :', painted, 'distinct sampled pixels');
console.log(fail.length ? `SMOKE FAILED:\n - ${fail.join('\n - ')}` : 'SMOKE OK');
process.exit(fail.length ? 1 : 0);
