import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const exe = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const url = pathToFileURL(join(process.cwd(),'dist','world.html')).href;
const browser = await chromium.launch({ executablePath: exe, args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport:{width:1280,height:760} });
const errors=[]; page.on('console',m=>{if(m.type()==='error')errors.push(m.text())}); page.on('pageerror',e=>errors.push('PE:'+e.message));
await page.goto(url,{waitUntil:'load'}); await page.waitForTimeout(1200);
const r = await page.evaluate(()=>{
  const d = window.__dbg;
  // step onto a live pedestrian
  const p = d.ambient.peds.find(x=>x.live);
  if (!p) return {err:'no live ped'};
  // move the player next to that ped via the internal ped — use teleport is car-only; nudge via foot: set through mug range by faking positions
  return {found:true};
});
// The player ped isn't directly teleportable; instead raise wanted via repeated rob near crowd by driving into center then walking. Simpler: assert mug logic by checking a nearby ped exists and money changes when we call rob repeatedly while walking.
await page.keyboard.down('ArrowUp'); await page.waitForTimeout(600); await page.keyboard.up('ArrowUp'); // walk forward into crowd
let paid=0, m0=await page.evaluate(()=>window.__dbg.player.money);
for(let i=0;i<20;i++){ await page.keyboard.down('ArrowUp'); await page.waitForTimeout(120); await page.keyboard.up('ArrowUp'); const ok=await page.evaluate(()=>{const b=window.__dbg.player.money; window.__dbg.rob(); return window.__dbg.player.money>b;}); if(ok)paid++; }
const m1=await page.evaluate(()=>({money:window.__dbg.player.money, wanted:window.__dbg.wanted}));
await browser.close();
console.log('setup:',JSON.stringify(r));
console.log('successful mugs:',paid,' money',m0,'->',m1.money,' wanted:',m1.wanted);
console.log('errors:',errors.length?errors.slice(0,5):'none');
