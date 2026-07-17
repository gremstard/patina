import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const exe = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const url = pathToFileURL(join(process.cwd(),'dist','world.html')).href;
const browser = await chromium.launch({ executablePath: exe, args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport:{width:1280,height:760} });
const errors=[]; page.on('console',m=>{if(m.type()==='error')errors.push(m.text())}); page.on('pageerror',e=>errors.push('PE:'+e.message));
await page.goto(url,{waitUntil:'load'}); await page.waitForTimeout(800);
// enter an office building and walk to the job station
const info = await page.evaluate(()=>{ const r=window.__dbg.enterType('office'); const j=window.__dbg.gotoJob(); return {r,j}; });
await page.waitForTimeout(200);
const money0 = await page.evaluate(()=>window.__dbg.player.money);
await page.keyboard.press('e'); // clock in
await page.waitForTimeout(200);
const working = await page.evaluate(()=>!!window.__dbg.working);
await page.waitForTimeout(4000); // ~1 shift+
await page.screenshot({path:join('dist','job.png')});
const money1 = await page.evaluate(()=>window.__dbg.player.money);
await browser.close();
console.log('entered/job:',JSON.stringify(info));
console.log('money before:',money0,' working:',working,' money after ~4s:',money1);
console.log('errors:',errors.length?errors.slice(0,5):'none');
