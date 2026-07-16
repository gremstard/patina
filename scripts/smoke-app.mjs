// Headless WebGL smoke test for a bundled three.js app.
//
//   node scripts/bundle-app.js city  && node scripts/smoke-app.mjs city
//   node scripts/bundle-app.js drive && node scripts/smoke-app.mjs drive [keys]
//
// Loads dist/<name>.html, asserts no console/page errors and that the canvas
// actually painted, optionally holds some keys (e.g. "w" to drive), and writes
// dist/<name>-smoke.png. CHROMIUM_PATH overrides the browser binary.

import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const name = process.argv[2] || 'city';
const keys = (process.argv[3] || '').split('').filter(Boolean);
const exe = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const url = pathToFileURL(join(process.cwd(), 'dist', `${name}.html`)).href;

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

// hold keys for a bit (driving)
for (const k of keys) await page.keyboard.down(k);
await page.waitForTimeout(keys.length ? 1600 : 400);
for (const k of keys) await page.keyboard.up(k);
await page.waitForTimeout(300);

// A WebGL drawing buffer can't be read back after composite (no
// preserveDrawingBuffer), so success is judged on the live HUD instead: the
// renderer reports draw calls, and for a driving run the speed climbs. The
// screenshot is written for eyeballing regardless.
const hud = await page.evaluate(() => {
  const grab = (id) => (document.getElementById(id) ? document.getElementById(id).textContent : null);
  return { speed: grab('s-speed'), calls: grab('s-calls'), tris: grab('s-tris') };
});

await page.screenshot({ path: join('dist', `${name}-smoke.png`) });
await browser.close();

const calls = Number(hud.calls);
const drove = keys.includes('w') ? Number(hud.speed) > 0 : true;
const ok = errors.length === 0 && Number.isFinite(calls) && calls >= 1 && drove;

console.log(`app: ${name}`);
console.log('hud    :', JSON.stringify(hud));
console.log('errors :', errors.length ? errors.slice(0, 6) : 'none');
console.log(ok ? 'SMOKE OK' : 'SMOKE FAILED');
process.exit(ok ? 0 : 1);
