import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const exe = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const url = pathToFileURL(join(process.cwd(),'dist','world.html')).href;
const browser = await chromium.launch({ executablePath: exe, args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport:{width:1280,height:760} });
await page.goto(url,{waitUntil:'load'}); await page.waitForTimeout(1200);
for(let i=0;i<4;i++){ await page.evaluate(()=>window.__dbg.gotoPed()); await page.waitForTimeout(80); await page.evaluate(()=>window.__dbg.rob()); await page.waitForTimeout(120); }
await page.waitForTimeout(1500); // let the cruiser close in
await page.screenshot({path:join('dist','chase.png')});
const st=await page.evaluate(()=>({wanted:window.__dbg.wanted, cop:window.__dbg.cop.active, dist: Math.hypot(window.__dbg.cop.x-window.__dbg.ped_x||0)}));
await browser.close();
console.log('wanted:',st.wanted,'cop:',st.cop);
