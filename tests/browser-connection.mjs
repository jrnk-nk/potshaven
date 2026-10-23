// Full-stack startup and connection recovery checks. Uses the real development
// launcher with an isolated database and a working directory outside the repo.
// Run: node tests/browser-connection.mjs (CHROMIUM_PATH may select a browser).
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {existsSync, mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import {createServer as createNetServer} from 'node:net';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium, expect} from '@playwright/test';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const temporary=mkdtempSync(join(tmpdir(),'potshaven-connection-'));
const artifacts=process.env.CONNECTION_ARTIFACT_DIR||join(tmpdir(),'potshaven-connection-artifacts');
mkdirSync(artifacts,{recursive:true});
const foreignCwd=join(temporary,'outside-checkout');
mkdirSync(foreignCwd,{recursive:true});
const probe=createNetServer();
probe.listen(0,'127.0.0.1');
await once(probe,'listening');
const port=probe.address().port;
await new Promise(resolve=>probe.close(resolve));
const origin=`http://127.0.0.1:${port}`;
let child,browser,page;
let output='';
const errors=[];

try {
  assert.ok(existsSync(join(root,'server/dev.js')),'The full-stack server/dev.js launcher must exist.');
  child=spawn(process.execPath,[join(root,'server/dev.js')],{
    cwd:foreignCwd,
    env:{...process.env,PORT:String(port),DATA_DIR:join(temporary,'data'),DATA_SEED:'true',APP_OWNER_PASSWORD:'',APP_MANAGER_PASSWORD:'',POTSHAVEN_OPENAI_KEY:'',OPENAI_API_KEY:''},
    stdio:['ignore','pipe','pipe'],
  });
  for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{output=(output+chunk.toString()).slice(-12000);});
  const startupError=new Promise((_,reject)=>child.once('error',reject));
  const readiness=(async()=>{
    const deadline=Date.now()+60000;
    while(Date.now()<deadline){
      if(child.exitCode!==null)throw new Error(`Development server exited with code ${child.exitCode}.\n${output}`);
      try{const response=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1500)});if(response.ok&&(await response.json()).ok)return;}catch{}
      await delay(150);
    }
    throw new Error(`Development server did not become ready.\n${output}`);
  })();
  await Promise.race([readiness,startupError]);
  const stateResponse=await fetch(origin+'/api/state');
  assert.equal(stateResponse.status,200);
  const state=await stateResponse.json();
  assert.ok(state.places.length>0&&state.jobs.length>0,'The isolated database should contain its own sample records.');
  const documentResponse=await fetch(origin+'/');
  assert.equal(documentResponse.status,200);
  assert.match(await documentResponse.text(),/<div id="root">/);
  console.log('PASS real single-port launcher serves page, health and state from outside the checkout');

  const executablePath=process.env.CHROMIUM_PATH||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined);
  browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']});
  page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'});
  page.on('pageerror',error=>errors.push(error.message));
  let mode='initial',stateRequests=0;
  await page.route('**/api/state',async route=>{
    stateRequests++;
    if((mode==='initial'&&stateRequests<=2)||mode==='offline')return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Temporary connection interruption.'})});
    return route.continue();
  });
  await page.goto(origin);
  const home=page.getByRole('heading',{name:'Your business at a glance',exact:true});
  await expect(home).toBeVisible({timeout:25000});
  assert.ok(stateRequests>=3,'The initial failed state request must be retried automatically.');
  assert.ok(stateRequests<10,'Initial recovery must not loop indefinitely.');
  await expect(page.locator('.error-panel')).toHaveCount(0);
  await expect(page.getByText(state.jobs.find(job=>job.type==='Project'&&job.status!=='Completed').title,{exact:true}).first()).toBeVisible();
  console.log('PASS two initial API failures recover automatically without leaving a stuck error screen');

  mode='offline';
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  const connectionNotice=page.locator('.connection-banner,[data-testid="connection-status"]');
  await expect(connectionNotice).toBeVisible({timeout:25000});
  await expect(home).toBeVisible();
  await expect(page.getByText(state.jobs.find(job=>job.type==='Project'&&job.status!=='Completed').title,{exact:true}).first()).toBeVisible();
  await page.screenshot({path:join(artifacts,'connection-interrupted.png'),fullPage:true});
  console.log('PASS later API interruption keeps the last loaded workspace visible with a connection notice');

  mode='healthy';
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await expect(connectionNotice).toHaveCount(0,{timeout:20000});
  await expect(home).toBeVisible();
  console.log('PASS returning online refreshes the workspace and clears the connection notice');

  mode='offline';
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await expect(connectionNotice).toBeVisible({timeout:25000});
  mode='healthy';
  await connectionNotice.getByRole('button',{name:/try again|retry|reconnect/i}).click();
  await expect(connectionNotice).toHaveCount(0,{timeout:20000});
  console.log('PASS manual retry reconnects without reloading the page');

  const malformed=await browser.newPage({viewport:{width:1100,height:800},reducedMotion:'reduce'});
  malformed.on('pageerror',error=>errors.push(error.message));
  await malformed.route('**/api/state',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html><body>This is a website page, not a workspace API.</body></html>'}));
  await malformed.goto(origin);
  const malformedError=malformed.locator('.error-panel');
  await expect(malformedError).toBeVisible({timeout:25000});
  await expect(malformedError).toContainText(/server|response|JSON|connect|workspace/i);
  await expect(malformed.getByRole('heading',{name:'Your business at a glance',exact:true})).toHaveCount(0);
  await malformed.screenshot({path:join(artifacts,'invalid-api-response.png'),fullPage:true});
  console.log('PASS an HTML response with status200 is rejected instead of silently showing an empty workspace');
  await malformed.close();
  assert.deepEqual(errors,[],'Connection recovery must not create browser runtime errors.');
  console.log('PASS no browser runtime errors');
}catch(error){
  console.error(error);
  if(page)await page.screenshot({path:join(artifacts,'failure.png'),fullPage:true}).catch(()=>{});
  if(output)console.error('Development server output:\n'+output);
  process.exitCode=1;
}finally{
  await browser?.close();
  if(child&&child.exitCode===null&&child.signalCode===null){
    child.kill('SIGTERM');
    const exited=await Promise.race([once(child,'exit').then(()=>true),delay(6000).then(()=>false)]);
    if(!exited){child.kill('SIGKILL');await once(child,'exit').catch(()=>{});}
  }
  rmSync(temporary,{recursive:true,force:true});
}
