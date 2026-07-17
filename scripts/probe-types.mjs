// Enter one building of each type and screenshot the ground floor.
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const exe = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const url = pathToFileURL(join(process.cwd(), 'dist', 'world.html')).href;
const browser = await chromium.launch({
  executablePath: exe,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(900);

for (const btype of ['hotel', 'apartment', 'mixed', 'store']) {
  const r = await page.evaluate((t) => {
    if (window.__dbg.mode === 'interior') window.__dbg.exitBuilding();
    return window.__dbg.enterType(t);
  }, btype);
  await page.waitForTimeout(400);
  const it = await page.evaluate(() => window.__interior());
  await page.screenshot({ path: join('dist', `type-${btype}.png`) });
  console.log(`${btype.padEnd(10)} entered:`, JSON.stringify(r), 'interior:', JSON.stringify(it));
}
await browser.close();
console.log('errors:', errors.length ? errors.slice(0, 6) : 'none');
