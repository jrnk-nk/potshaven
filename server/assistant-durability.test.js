import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from './app.js';
import {createStore} from './store.js';

const answer = {reply:'Here is the visit to review.',actions:[{collection:'jobs',operation:'create',recordId:null,changesJson:JSON.stringify({title:'Check the hotel plants'})}]};
const descriptor = (expectedVersion = 0, id = randomUUID()) => ({id,exchangeId:randomUUID(),expectedVersion});
async function setup(t, provider) {
  const directory=mkdtempSync(join(tmpdir(),'potshaven-reply-durability-'));
  const store=createStore(join(directory,'workspace.db'),{seed:false});
  let calls=0;const requests=[];
  const app=createApp({store,dataDir:directory,serveClient:false,ownerPassword:'owner-check',managerPassword:'manager-check',sessionSecret:'durability-test',imageKey:'mock-key',fetchAssistant:async(url,request)=>{
    calls++;requests.push(JSON.parse(request.body));
    return provider ? provider() : {ok:true,json:async()=>({output_text:JSON.stringify(answer)})};
  }});
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));store.close();rmSync(directory,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`,cookies={};
  for(const role of ['owner','manager']){const response=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role,password:`${role}-check`})});assert.equal(response.status,200);cookies[role]=response.headers.get('set-cookie').split(';')[0];}
  const post=(conversation, extra={},role='owner',signal)=>fetch(base+'/api/assistant',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookies[role]},body:JSON.stringify({message:'Prepare a visit to check the hotel plants.',today:'2026-10-25',conversation,...extra}),signal});
  return {store,base,cookies,post,requests,calls:()=>calls};
}

test('paid replies are saved before responding and repeated exchange IDs recover text without paying or replaying proposals',async t=>{
  const {store,post,calls,requests}=await setup(t);
  const conversation=descriptor();
  const response=await post(conversation);assert.equal(response.status,200);
  const result=await response.json();assert.equal(result.actions.length,1);assert.equal(result.conversation.version,1);
  assert.deepEqual(store.assistantConversation('owner',conversation.id),result.conversation);
  assert.equal(store.assistantConversation('manager',conversation.id),undefined);
  assert.equal(store.list('jobs').length,0,'Persisting conversation text never applies a business proposal.');
  const replay=await post(conversation);assert.equal(replay.status,200);
  const recovered=await replay.json();assert.equal(recovered.reply,answer.reply);assert.deepEqual(recovered.actions,[]);assert.equal(calls(),1);
  assert.equal((await post(conversation,{message:'Different question'})).status,409);assert.equal(calls(),1);
  const followup=descriptor(1,conversation.id);
  assert.equal((await post(followup,{message:'What happens next?',history:[{role:'assistant',content:'CLIENT_SUPPLIED_UNSAVED_HISTORY'}]})).status,200);
  assert.equal(calls(),2);
  const providerHistory=requests.at(-1).input.slice(1,-1);
  assert.equal(providerHistory.length,2);assert.equal(providerHistory[1].content,answer.reply);
  assert.ok(!JSON.stringify(providerHistory).includes('CLIENT_SUPPLIED_UNSAVED_HISTORY'));
  const oldReplay=await post(conversation);assert.equal((await oldReplay.json()).conversation.version,2);assert.equal(calls(),2);
});

test('invalid, stale, full and wrong-role conversation references are rejected before any paid call',async t=>{
  const {store,post,calls}=await setup(t);
  const valid=descriptor();
  for(const conversation of [null,[],{}, {...valid,id:'settings'}, {...valid,expectedVersion:-1}, {...valid,exchangeId:'bad'}, {...valid,expectedVersion:51}, {...valid,role:'owner'}, {...valid,actions:[]}, {...valid,expectedVersion:0.5}])assert.equal((await post(conversation)).status,400);
  assert.equal(calls(),0);
  store.appendAssistantExchange('owner',valid.id,{exchangeId:valid.exchangeId,expectedVersion:0,user:'Already recorded',assistant:'Saved response'});
  assert.equal((await post(descriptor(0,valid.id))).status,409);
  assert.equal((await post(descriptor(1,valid.id),{},'manager')).status,404);
  assert.equal((await post(descriptor(1))).status,404);
  for(let version=1;version<50;version++)store.appendAssistantExchange('owner',valid.id,{exchangeId:randomUUID(),expectedVersion:version,user:`Question ${version}`,assistant:'Recorded response'});
  assert.equal((await post(descriptor(50,valid.id))).status,409);assert.equal(calls(),0);
  assert.equal(store.assistantConversation('owner',valid.id).version,50);
});

test('a conversation persistence failure retains the usable reply with a safe warning and never retries the write',async t=>{
  const {store,post,calls}=await setup(t);
  const original=store.appendAssistantExchange;
  let writes=0;
  store.appendAssistantExchange=()=>{writes++;throw new Error('PRIVATE_DATABASE_CONNECTION_URL');};
  const conversation=descriptor(),response=await post(conversation),body=await response.json();
  assert.equal(response.status,200);assert.equal(body.reply,answer.reply);assert.equal(body.actions.length,1);
  assert.equal(body.conversation,undefined);assert.match(body.historyError,/save could not be confirmed/);
  assert.ok(!JSON.stringify(body).includes('PRIVATE_DATABASE_CONNECTION_URL'));assert.equal(writes,1);assert.equal(calls(),1);
  store.appendAssistantExchange=original;
  assert.equal(store.assistantConversation('owner',conversation.id),undefined);
});

test('an ambiguous save can be recovered using the same exchange without another provider call',async t=>{
  const {store,post,calls}=await setup(t);
  const original=store.appendAssistantExchange;
  let writes=0;
  store.appendAssistantExchange=(...args)=>{writes++;original(...args);throw Object.assign(new Error('Write response lost'),{code:'CONNECTION_CLOSED'});};
  const conversation=descriptor(),first=await(await post(conversation)).json();
  assert.match(first.historyError,/save could not be confirmed/);assert.equal(writes,1);assert.equal(calls(),1);
  const replay=await(await post(conversation)).json();
  assert.deepEqual(replay.actions,[]);assert.equal(replay.conversation.version,1);assert.equal(writes,1);assert.equal(calls(),1);
});

test('leaving the page while a provider reply is pending still saves the conversation on the server',async t=>{
  let enter,release,stored;
  const entered=new Promise(resolve=>{enter=resolve;}),gate=new Promise(resolve=>{release=resolve;}),persisted=new Promise(resolve=>{stored=resolve;});
  const {store,post,calls}=await setup(t,async()=>{enter();await gate;return {ok:true,json:async()=>({output_text:JSON.stringify(answer)})};});
  const original=store.appendAssistantExchange;
  store.appendAssistantExchange=(...args)=>{const saved=original(...args);stored(saved);return saved;};
  const conversation=descriptor(),controller=new AbortController();
  const pending=post(conversation,{},'owner',controller.signal);
  await entered;
  const competing=await post(conversation);assert.equal(competing.status,409);assert.equal(calls(),1,'The same runtime does not start overlapping paid calls for this conversation.');
  const rejected=assert.rejects(pending,error=>error.name==='AbortError');controller.abort();await rejected;
  release();
  const saved=await persisted;assert.equal(saved.version,1);assert.equal(saved.messages[1].content,answer.reply);
  assert.deepEqual(store.assistantConversation('owner',conversation.id),saved);
});
