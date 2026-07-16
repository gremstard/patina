import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const exe = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const url = pathToFileURL(join(process.cwd(), 'dist', 'city.html')).href;
const browser = await chromium.launch({
  executablePath: exe,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 780 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(1200);
const stat = async (id) => (await page.$eval('#' + id, e => e.textContent).catch(() => '?'));
async function shot(tier, file) {
  await page.click('#t-' + tier);
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'dist/' + file });
  return { tier, tris: await stat('s-tris'), bldg: await stat('s-bldg'), calls: await stat('s-calls'), digest: await stat('s-digest'), maxh: await stat('s-maxh'), zones: await stat('s-zones') };
}
const m = await shot('metro', 'city-metro.png');
const c = await shot('city', 'city-city.png');
const t = await shot('town', 'city-town.png');
console.log('metro:', JSON.stringify(m));
console.log('city :', JSON.stringify(c));
console.log('town :', JSON.stringify(t));
console.log('errors:', errors.length ? errors.slice(0,5) : 'none');
await browser.close();
process.exit(errors.length ? 1 : 0);
