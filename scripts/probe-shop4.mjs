import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const exe = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const url = pathToFileURL(join(process.cwd(),'dist','world.html')).href;
const browser = await chromium.launch({ executablePath: exe, args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport:{width:1280,height:760} });
await page.goto(url,{waitUntil:'load'}); await page.waitForTimeout(800);
const entered = await page.evaluate(()=>{ const r=window.__dbg.enterType('mixed'); return {r, mode: window.__dbg.mode}; });
const g = await page.evaluate(()=>window.__dbg.gotoShop());
const samples=[];
for (let i=0;i<6;i++){ await page.waitForTimeout(60); samples.push(await page.evaluate(()=>{
  const ps=window.__dbg.promptShop; const it=window.__dbg.player; 
  return { ps: !!ps, mode: window.__dbg.mode };
})); }
await browser.close();
console.log('entered:',JSON.stringify(entered));
console.log('gotoShop stock:', g?g.length+' items':'null');
console.log('promptShop samples:',JSON.stringify(samples.map(s=>s.ps)));
console.log('mode samples:',JSON.stringify(samples.map(s=>s.mode)));
