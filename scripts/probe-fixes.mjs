import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const exe = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const url = pathToFileURL(join(process.cwd(),'dist','world.html')).href;
const browser = await chromium.launch({ executablePath: exe, args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport:{width:1280,height:760} });
const errors=[]; page.on('console',m=>{if(m.type()==='error')errors.push(m.text())}); page.on('pageerror',e=>errors.push('PE:'+e.message));
await page.goto(url,{waitUntil:'load'}); await page.waitForTimeout(900);
// city road-line map
await page.keyboard.press('m'); await page.waitForTimeout(150);
await page.keyboard.press('m'); await page.waitForTimeout(250);
await page.screenshot({path:join('dist','map-city2.png')});
await page.keyboard.press('m'); await page.waitForTimeout(120);
// manager job: enter a bank, go to manager, confirm work works
const info = await page.evaluate(()=>{ window.__dbg.enterType('bank'); const j=window.__dbg.gotoJob(); return {j}; });
await page.waitForTimeout(300);
await page.screenshot({path:join('dist','manager.png')});
const m0 = await page.evaluate(()=>window.__dbg.player.money);
await page.keyboard.press('e'); await page.waitForTimeout(9000);
const m1 = await page.evaluate(()=>window.__dbg.player.money);
await browser.close();
console.log('job (manager) spot:',JSON.stringify(info.j));
console.log('money before/after working:',m0,'->',m1,' earned:',m1-m0);
console.log('errors:',errors.length?errors.slice(0,5):'none');
