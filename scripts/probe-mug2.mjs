import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const exe = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const url = pathToFileURL(join(process.cwd(),'dist','world.html')).href;
const browser = await chromium.launch({ executablePath: exe, args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport:{width:1280,height:760} });
await page.goto(url,{waitUntil:'load'}); await page.waitForTimeout(1200);
let paid=0;
for(let i=0;i<5;i++){
  await page.evaluate(()=>window.__dbg.gotoPed());
  await page.waitForTimeout(80);
  const ok = await page.evaluate(()=>{ const b=window.__dbg.player.money; window.__dbg.rob(); return window.__dbg.player.money-b; });
  if(ok>0)paid++;
  await page.waitForTimeout(120);
}
const st=await page.evaluate(()=>({money:window.__dbg.player.money, wanted:window.__dbg.wanted, cop:window.__dbg.cop.active}));
await browser.close();
console.log('successful mugs:',paid,' state:',JSON.stringify(st));
