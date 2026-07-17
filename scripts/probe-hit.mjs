// Get in a car, drive into the crowd, confirm agents get knocked and the car
// keeps rolling (doesn't dead-stop on them).
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

await page.keyboard.press('e'); // get in the parked car right there
await page.waitForTimeout(200);
await page.keyboard.down('ArrowUp'); // floor it into traffic/peds
let maxKnock = 0;
let hits = 0;
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(60);
  const s = await page.evaluate(() => {
    const a = window.__dbg.ambient;
    let mk = 0, h = 0;
    for (const p of a.peds) { const k = Math.hypot(p.kx, p.kz); if (k > 0.1) { h++; mk = Math.max(mk, k); } }
    for (const c of a.cars) { const k = Math.hypot(c.kx, c.kz); if (k > 0.1) { h++; mk = Math.max(mk, k); } }
    return { mk, h, speed: window.__dbg.car.speed, mode: window.__dbg.mode };
  });
  maxKnock = Math.max(maxKnock, s.mk);
  hits = Math.max(hits, s.h);
  if (i === 39) console.log('final:', JSON.stringify(s));
}
await page.keyboard.up('ArrowUp');
await page.screenshot({ path: join('dist', 'hit.png') });
await browser.close();
console.log('max knockback impulse:', maxKnock.toFixed(2), '  agents hit:', hits);
console.log('errors:', errors.length ? errors.slice(0, 6) : 'none');
