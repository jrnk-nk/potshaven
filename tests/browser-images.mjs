// Real-browser image preparation checks. No live API, paid service or company data.
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const vite=await createServer({configFile:false,root,plugins:[react()],logLevel:'error',server:{host:'127.0.0.1',port:0}});
await vite.listen();
const browserPath=process.env.CHROMIUM_PATH||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined);
const browser=await chromium.launch({executablePath:browserPath,headless:true,args:['--no-sandbox']});
try {
 const page=await browser.newPage();
 page.on('pageerror',error=>console.error('Browser runtime:',error.message));
 await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}`,{waitUntil:'domcontentloaded'});
 const result=await page.evaluate(async()=>{
  const {prepareImage,dataUrlByteLength}=await import('/src/images.ts');
  const blob=canvas=>new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  const decode=source=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=reject;image.src=source;});
  const canvas=document.createElement('canvas');canvas.width=2300;canvas.height=1700;
  const context=canvas.getContext('2d');const pixels=context.createImageData(canvas.width,canvas.height);let value=10831;
  for(let i=0;i<pixels.data.length;i+=4){value^=value<<13;value^=value>>>17;value^=value<<5;pixels.data[i]=value&255;pixels.data[i+1]=(value>>>8)&255;pixels.data[i+2]=(value>>>16)&255;pixels.data[i+3]=255;}
  context.putImageData(pixels,0,0);
  const original=await blob(canvas);const prepared=await prepareImage(new File([original],'large-photo.png',{type:'image/png'}));const output=await decode(prepared);
  const tiny=document.createElement('canvas');tiny.width=12;tiny.height=12;tiny.getContext('2d').fillRect(0,0,12,12);const tinyFile=new File([await blob(tiny)],'small.png',{type:'image/png'});const small=await prepareImage(tinyFile);
  const logo=document.createElement('canvas');logo.width=2000;logo.height=1200;logo.getContext('2d').fillRect(500,300,1000,600);const logoFile=new File([await blob(logo)],'logo.png',{type:'image/png'});const logoResult=await prepareImage(logoFile,{maxDimension:800,maxBytes:500*1024,preserveTransparency:true});const logoImage=await decode(logoResult);const check=document.createElement('canvas');check.width=logoImage.naturalWidth;check.height=logoImage.naturalHeight;check.getContext('2d').drawImage(logoImage,0,0);
  const failures=[];
  for(const file of [new File(['<svg/>'],'bad.svg',{type:'image/svg+xml'}),new File([new Uint8Array(20*1024*1024+1)],'huge.png',{type:'image/png'}),new File(['not a photo'],'broken.png',{type:'image/png'})]){try{await prepareImage(file);failures.push('accepted');}catch(error){failures.push(error.message);}}
  return {originalBytes:original.size,photoBytes:dataUrlByteLength(prepared),photoWidth:output.naturalWidth,photoHeight:output.naturalHeight,photoType:prepared.slice(0,22),smallPreserved:small===await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(tinyFile);}),logoBytes:dataUrlByteLength(logoResult),logoWidth:logoImage.naturalWidth,logoHeight:logoImage.naturalHeight,transparent:check.getContext('2d').getImageData(0,0,1,1).data[3]===0,failures};
 });
 assert.ok(result.originalBytes>3*1024*1024);
 assert.ok(result.photoBytes<=600*1024);
 assert.ok(Math.max(result.photoWidth,result.photoHeight)<=1600);
 assert.match(result.photoType,/data:image\/jpeg/);
 assert.equal(result.smallPreserved,true);
 assert.ok(result.logoBytes<=500*1024);
 assert.ok(Math.max(result.logoWidth,result.logoHeight)<=800);
 assert.equal(result.transparent,true);
 assert.equal(result.failures.length,3);assert.ok(result.failures.every(value=>value!=='accepted'));
 console.log(`PASS large photo reduced ${result.originalBytes}→${result.photoBytes} bytes, within1600px/600KB limits`);
 console.log('PASS small PNG preserved, logo transparency retained within800px/500KB, invalid/oversized/unreadable images rejected');
 const fixture=await page.evaluate(()=>{
  const png=(width,height,colour)=>{const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const context=canvas.getContext('2d');context.fillStyle=colour;context.fillRect(0,0,width,height);return canvas.toDataURL('image/png').split(',')[1];};
  return {photo:png(600,400,'#d8e6ce'),logo:png(400,100,'#285442')};
 });
 const collections=['places','jobs','inventory','stockMovements','workers','vehicles','contracts','payments','expenses','purchaseRequests','equipment','issues','careGuides','designs'];
 const state=Object.fromEntries(collections.map(name=>[name,[]]));
 Object.assign(state,{settings:{companyName:'Image test company',logo:'/test-wide-logo.png',currency:'GHS',watermark:'Image test'},role:'owner',demoMode:true,imageGenerationConfigured:false});
 state.designs=[{id:'image-test',title:'Brand export test',image:'/test-photo.png',published:true,source:'Portfolio upload'}];
 await page.route('**/api/activity?*',route=>route.fulfill({json:{items:[],unreadCount:0}}));
 await page.route('**/api/state',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(state)}));
 await page.route('**/test-wide-logo.png',route=>route.fulfill({status:200,contentType:'image/png',body:Buffer.from(fixture.logo,'base64')}));
 await page.route('**/test-photo.png',route=>route.fulfill({status:200,contentType:'image/png',body:Buffer.from(fixture.photo,'base64')}));
 await page.addInitScript(()=>{
  const original=CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage=function(...args){
   if(args[0] instanceof HTMLImageElement&&args[0].src.endsWith('/test-wide-logo.png'))window.__logoDraw={naturalWidth:args[0].naturalWidth,naturalHeight:args[0].naturalHeight,width:args[3],height:args[4],canvasWidth:this.canvas.width};
   return original.apply(this,args);
  };
 });
 await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/#portfolio`);
 await page.reload();
 await page.getByRole('button',{name:'Branded download',exact:true}).waitFor();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Branded download',exact:true}).click();await download;
 const drawn=await page.evaluate(()=>window.__logoDraw);
 assert.ok(drawn,'Same-origin logo was not included in the downloaded image');assert.equal(drawn.width/drawn.height,4);assert.ok(Math.abs(drawn.width-drawn.canvasWidth*.18)<.01);
 console.log('PASS same-origin wide logo stays legible, proportional and uncropped in branded PNG downloads');
 await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/#overview`);
 await page.getByRole('button',{name:'Schedule a visit',exact:true}).click();
 await page.getByText('More job details',{exact:true}).click();
 const upload=page.getByLabel('Add completion photo from WhatsApp or camera',{exact:true});
 const file={name:'completion.png',mimeType:'image/png',buffer:Buffer.from(fixture.photo,'base64')};
 for(let number=1;number<=4;number++){await upload.setInputFiles(file);await page.getByAltText(`Completion photo ${number}`,{exact:true}).waitFor();}
 await upload.setInputFiles(file);await page.getByRole('alert').filter({hasText:'Save these photos before adding more'}).waitFor();
 assert.equal(await page.locator('.ops-photo-tile').count(),4);
 console.log('PASS completion-photo batch rejects a fifth pending image and keeps the first four intact');

} finally {await browser.close();await vite.close();}
