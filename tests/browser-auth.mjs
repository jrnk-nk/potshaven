// Browser session/loading regressions with isolated API fixtures; no live credentials.
import assert from 'node:assert/strict';
import {chromium, expect} from '@playwright/test';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {existsSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const vite=await createServer({configFile:false,root,plugins:[react()],logLevel:'error',server:{host:'127.0.0.1',port:0}});
await vite.listen();
const origin=`http://127.0.0.1:${vite.httpServer.address().port}`;
const executablePath=process.env.CHROMIUM_PATH||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined);
const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']});
const errors=[];
const collections=['places','jobs','inventory','stockMovements','workers','vehicles','contracts','payments','expenses','purchaseRequests','equipment','issues','careGuides','designs'];
const fixture=role=>({...Object.fromEntries(collections.map(key=>[key,[]])),places:[{id:'private-hotel',name:'Private hotel',client:'Private client',address:'Accra',type:'Hotel'}],settings:{companyName:'Auth test company',currency:'GHS'},role,demoMode:false,imageGenerationConfigured:false});

async function sessionPage() {
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
 const session={signedIn:false,role:'owner',failState:false,loginCalls:0,stateCalls:0,pendingStale:null};
 await page.route('**/api/**',async route=>{
  const request=route.request();const path=new URL(request.url()).pathname;
  const reply=(status,body)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  if(path==='/api/auth/login') {
   session.loginCalls++;const body=request.postDataJSON();
   if(body.password!=='fixture-password')return reply(401,{error:'Incorrect password or role is not configured.'});
   session.signedIn=true;session.role=body.role;return reply(200,{role:body.role,demoMode:false});
  }
  if(path==='/api/state') {
   session.stateCalls++;
   if(session.pendingStale){const pending=session.pendingStale;session.pendingStale=null;await pending.promise;return reply(401,{error:'Please sign in to continue.'});}
   if(!session.signedIn)return reply(401,{error:'Please sign in to continue.'});
   if(session.failState)return reply(503,{error:'The saved company records could not be loaded. Please retry.',code:'DATABASE_UNAVAILABLE'});
   return reply(200,fixture(session.role));
  }
  throw Error(`Unexpected auth test API route: ${path}`);
 });
 await page.goto(origin+'/#places');
 await expect(page.getByRole('heading',{name:'Welcome back.'})).toBeVisible();
 return {page,session};
}
async function login(page,role='owner',password='fixture-password') {
 await page.getByRole('combobox').selectOption(role);
 await page.getByLabel('Password',{exact:true}).fill(password);
 await page.getByRole('button',{name:'Enter your workspace'}).click();
}

try {
 const normal=await sessionPage();
 await login(normal.page,'owner','wrong-fixture-password');
 await expect(normal.page.getByRole('alert')).toContainText('Incorrect password');
 await expect(normal.page.getByRole('heading',{name:'Welcome back.'})).toBeVisible();
 console.log('PASS wrong passwords stay on sign-in and show the authentication error');
 await login(normal.page);
 await expect(normal.page.getByRole('heading',{name:'Places & clients',exact:true})).toBeVisible();
 await expect(normal.page.getByText('Private hotel',{exact:true})).toBeVisible();
 await expect(normal.page.locator('.sidebar-account')).toContainText('Business owner');
 await normal.page.reload();
 await expect(normal.page.getByRole('heading',{name:'Places & clients',exact:true})).toBeVisible();
 assert.equal(normal.session.loginCalls,2,'A retained session must not submit another sign-in.');
 console.log('PASS an accepted owner login opens saved records and the session survives reload');
 normal.session.signedIn=false;
 await normal.page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await expect(normal.page.getByRole('heading',{name:'Welcome back.'})).toBeVisible();
 await expect(normal.page.getByText('Private hotel',{exact:true})).toHaveCount(0);
 await login(normal.page,'manager');
 await expect(normal.page.getByRole('heading',{name:'Places & clients',exact:true})).toBeVisible();
 await expect(normal.page.locator('.sidebar-account')).toContainText('Manager');
 console.log('PASS an expired session removes private records and manager sign-in opens the workspace');
 await normal.page.close();

 const outage=await sessionPage();outage.session.failState=true;
 await login(outage.page);
 await expect(outage.page.getByRole('heading',{name:'Your workspace isn’t connected yet'})).toBeVisible({timeout:15000});
 await expect(outage.page.getByText('The saved company records could not be loaded. Please retry.',{exact:true})).toBeVisible();
 await expect(outage.page.getByRole('heading',{name:'Places & clients',exact:true})).toHaveCount(0);
 assert.equal(outage.session.loginCalls,1);
 outage.session.failState=false;
 await outage.page.getByRole('button',{name:'Try again',exact:true}).click();
 await expect(outage.page.getByRole('heading',{name:'Places & clients',exact:true})).toBeVisible();
 assert.equal(outage.session.loginCalls,1,'Opening the workspace after a database outage must not resubmit the password.');
 console.log('PASS an accepted sign-in with unavailable company data shows the actual error and retries without another password');
 await outage.page.close();

 const stale=await sessionPage();let release;
 const promise=new Promise(resolve=>{release=resolve;});stale.session.pendingStale={promise};
 const staleStarted=stale.page.waitForRequest(request=>new URL(request.url()).pathname==='/api/state');
 await stale.page.evaluate(()=>window.dispatchEvent(new Event('online')));await staleStarted;
 const loggedIn=stale.page.waitForResponse(response=>new URL(response.url()).pathname==='/api/auth/login'&&response.status()===200);
 await login(stale.page);await loggedIn;release();
 await expect(stale.page.getByRole('heading',{name:'Places & clients',exact:true})).toBeVisible();
 await expect(stale.page.getByText('Private hotel',{exact:true})).toBeVisible();
 assert.equal(stale.session.loginCalls,1);
 console.log('PASS an earlier unauthorized request cannot discard a newly accepted session');
 await stale.page.close();
 assert.deepEqual(errors,[]);
 console.log('PASS no browser runtime errors during sign-in, expiry or recovery');
} finally {
 await browser.close();await vite.close();
}
