import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const exe = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const url = pathToFileURL(join(process.cwd(),'dist','world.html')).href;
const browser = await chromium.launch({ executablePath: exe, args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport:{width:1280,height:760} });
const errors=[]; page.on('console',m=>{if(m.type()==='error')errors.push(m.text())}); page.on('pageerror',e=>errors.push('PE:'+e.message));
await page.goto(url,{waitUntil:'load'}); await page.waitForTimeout(900);
await page.keyboard.press('m'); await page.waitForTimeout(250); // world map (blue interstates)
await page.screenshot({path:join('dist','map-world2.png')});
await page.keyboard.press('m'); await page.waitForTimeout(250); // city road map (clean + blue exits)
await page.screenshot({path:join('dist','map-city3.png')});
await browser.close();
console.log('errors:',errors.length?errors.slice(0,5):'none');
