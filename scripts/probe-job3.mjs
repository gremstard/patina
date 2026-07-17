import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const exe = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const url = pathToFileURL(join(process.cwd(),'dist','world.html')).href;
const browser = await chromium.launch({ executablePath: exe, args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport:{width:1280,height:760} });
const errors=[]; page.on('console',m=>{if(m.type()==='error')errors.push(m.text())}); page.on('pageerror',e=>errors.push('PE:'+e.message));
await page.goto(url,{waitUntil:'load'}); await page.waitForTimeout(800);
await page.evaluate(()=>{ window.__dbg.enterType('bank'); }); // bank teller, best pay
// bank ground floor is a bank; walk to teller
await page.evaluate(()=>window.__dbg.gotoJob());
await page.waitForTimeout(300);
const before = await page.evaluate(()=>window.__dbg.player.money);
await page.keyboard.press('e'); // clock in via keyboard
await page.waitForTimeout(300);
const clockedIn = await page.evaluate(()=>!!window.__dbg.working);
await page.waitForTimeout(11000); // several shifts of sim time
await page.screenshot({path:join('dist','job.png')});
const after = await page.evaluate(()=>window.__dbg.player.money);
await browser.close();
console.log('keyboard clock-in worked:',clockedIn);
console.log('bank teller money before:',before,' after ~11s:',after,' earned:',after-before);
console.log('errors:',errors.length?errors.slice(0,5):'none');
