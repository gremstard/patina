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

await page.keyboard.press('m'); // open → world
await page.waitForTimeout(250);
await page.screenshot({ path: join('dist', 'map-world.png') });
await page.keyboard.press('m'); // → city roads
await page.waitForTimeout(250);
await page.screenshot({ path: join('dist', 'map-city.png') });
await page.keyboard.press('m'); // close
await page.waitForTimeout(150);

// drive a while; confirm no ambient agent is off-road and no errors
await page.keyboard.press('e');
await page.keyboard.down('ArrowUp');
let offRoad = 0;
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(80);
  offRoad = await page.evaluate(() => {
    const a = window.__dbg.ambient;
    let bad = 0;
    for (const c of a.cars) if (c.live && a._carRoad(c.x, c.z, c.dir) === false) bad++;
    for (const p of a.peds) if (p.live && !p.cross && a._pedWalk(p.x, p.z, p.dir) === false) bad++;
    return bad;
  });
}
await page.keyboard.up('ArrowUp');
await page.screenshot({ path: join('dist', 'map-drive.png') });
await browser.close();
console.log('off-road agents while driving:', offRoad);
console.log('errors:', errors.length ? errors.slice(0, 6) : 'none');
