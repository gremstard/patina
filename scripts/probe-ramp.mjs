import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const exe = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const url = pathToFileURL(join(process.cwd(),'dist','world.html')).href;
const browser = await chromium.launch({ executablePath: exe, args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport:{width:1280,height:760} });
const errors=[]; page.on('console',m=>{if(m.type()==='error')errors.push(m.text())}); page.on('pageerror',e=>errors.push('PE:'+e.message));
await page.goto(url,{waitUntil:'load'}); await page.waitForTimeout(900);
const r = await page.evaluate(()=>window.__dbg.gotoInterstate());
await page.waitForTimeout(500);
// pull the camera up a bit by looking around; just screenshot
await page.screenshot({path:join('dist','ramp.png')});
console.log('interstate exit at:',JSON.stringify(r));
console.log('errors:',errors.length?errors.slice(0,5):'none');
await browser.close();
