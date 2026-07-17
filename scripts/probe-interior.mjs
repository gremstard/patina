// Verify multi-floor, building-sized interiors. Enters the largest nearby
// building, checks the interior state, rides the elevator, screenshots each floor.
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

// Find the tallest building's door in the loaded metro, enter it.
const info = await page.evaluate(() => {
  const dbg = window.__dbg;
  const it = dbg.enterNearestTall ? dbg.enterNearestTall() : dbg.enterNearest();
  const i = window.__interior && window.__interior();
  return { entered: it, interior: i };
});
await page.waitForTimeout(500);
await page.screenshot({ path: join('dist', 'interior-floor0.png') });

// ride elevator up a floor
const before = await page.evaluate(() => window.__interior());
await page.evaluate(() => window.__dbg.gotoLift && window.__dbg.gotoLift());
await page.waitForTimeout(100);
await page.keyboard.press('e');
await page.waitForTimeout(400);
const after = await page.evaluate(() => window.__interior());
await page.screenshot({ path: join('dist', 'interior-floor1.png') });

await browser.close();
console.log('entered   :', JSON.stringify(info.entered));
console.log('interior  :', JSON.stringify(info.interior));
console.log('floor pre :', JSON.stringify(before));
console.log('floor post:', JSON.stringify(after));
console.log('errors    :', errors.length ? errors.slice(0, 6) : 'none');
