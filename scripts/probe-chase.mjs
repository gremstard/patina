import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const exe = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const url = pathToFileURL(join(process.cwd(),'dist','world.html')).href;
const browser = await chromium.launch({ executablePath: exe, args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport:{width:1280,height:760} });
const errors=[]; page.on('console',m=>{if(m.type()==='error')errors.push(m.text())}); page.on('pageerror',e=>errors.push('PE:'+e.message));
await page.goto(url,{waitUntil:'load'}); await page.waitForTimeout(800);
// mug pedestrians on the street to raise wanted, watch the cop
await page.evaluate(()=>{ window.__dbg.gainMoney(200); });
let mugged=0;
for (let i=0;i<8;i++){ const ok = await page.evaluate(()=>{ const before=window.__dbg.player.money; window.__dbg.rob(); return window.__dbg.player.money>before; }); if(ok)mugged++; await page.waitForTimeout(400); }
await page.waitForTimeout(1200);
const st = await page.evaluate(()=>({wanted:window.__dbg.wanted, cop:window.__dbg.cop.active}));
await page.screenshot({path:join('dist','chase.png')});
// now let heat cool with no crime
await page.waitForTimeout(1000);
await browser.close();
console.log('mugs that paid:',mugged,' wanted:',st.wanted,' cop active:',st.cop);
console.log('errors:',errors.length?errors.slice(0,5):'none');
