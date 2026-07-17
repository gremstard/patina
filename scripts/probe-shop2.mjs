import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const exe = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const url = pathToFileURL(join(process.cwd(),'dist','world.html')).href;
const browser = await chromium.launch({ executablePath: exe, args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport:{width:1280,height:760} });
const errors=[]; page.on('console',m=>{if(m.type()==='error')errors.push(m.text())}); page.on('pageerror',e=>errors.push('PE:'+e.message));
await page.goto(url,{waitUntil:'load'}); await page.waitForTimeout(800);
await page.mouse.click(640, 400); // focus the game
await page.evaluate(()=>{ window.__dbg.enterType('mixed'); window.__dbg.gotoShop(); window.__dbg.gainMoney(200); });
await page.waitForTimeout(300);
await page.keyboard.press('b');
await page.waitForTimeout(200);
const opened = await page.evaluate(()=>window.__dbg.shopOpen);
await page.screenshot({path:join('dist','shop.png')});
await browser.close();
console.log('shop opened via B (after focus):',opened);
console.log('errors:',errors.length?errors.slice(0,5):'none');
