import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const exe = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const url = pathToFileURL(join(process.cwd(),'dist','world.html')).href;
const browser = await chromium.launch({ executablePath: exe, args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport:{width:1280,height:760} });
const errors=[]; page.on('console',m=>{if(m.type()==='error')errors.push(m.text())}); page.on('pageerror',e=>errors.push('PE:'+e.message));
await page.goto(url,{waitUntil:'load'}); await page.waitForTimeout(800);
// rob a bank
const tgt = await page.evaluate(()=>{ window.__dbg.enterType('bank'); return window.__dbg.gotoRob(); });
await page.waitForTimeout(300);
const m0 = await page.evaluate(()=>window.__dbg.player.money);
await page.evaluate(()=>window.__dbg.rob()); // start hold-up
await page.waitForTimeout(200);
const midWanted = await page.evaluate(()=>window.__dbg.wanted);
await page.waitForTimeout(6000); // finish the ~3.6s heist (sim ~0.8x)
const m1 = await page.evaluate(()=>window.__dbg.player.money);
await page.screenshot({path:join('dist','rob.png')});
// leave the bank → cop should be chasing (wanted>=2)
await page.evaluate(()=>window.__dbg.exitBuilding());
await page.waitForTimeout(1500);
const copState = await page.evaluate(()=>({active:window.__dbg.cop.active, wanted:window.__dbg.wanted}));
await browser.close();
console.log('bank robbery target:',JSON.stringify(tgt));
console.log('money before:',m0,' wanted after starting:',midWanted,' money after heist:',m1,' haul:',m1-m0);
console.log('after leaving — cop:',JSON.stringify(copState));
console.log('errors:',errors.length?errors.slice(0,5):'none');
