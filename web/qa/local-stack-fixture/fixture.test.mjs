import test from 'node:test';
import assert from 'node:assert/strict';
import {createFixture} from './vs-decide/fixture.mjs';

const gateway = 'http://genie-isolated-gateway:8000';
const jwt = (role,sub) => 'header.'+Buffer.from(JSON.stringify({role,sub})).toString('base64url')+'.signature';
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const recordID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const caller = jwt('authenticated','not-the-authoritative-owner');
const cfg = {GENIE_EDGE_NETGUARD:'docker-internal-verified',GENIE_EDGE_MODE:'isolated-genie-synthetic-only',GENIE_EDGE_ORIGIN:gateway,
  GENIE_EDGE_ANON_JWT:jwt('anon'),GENIE_EDGE_WRITER_JWT:jwt('service_role'),SUPABASE_URL:gateway};
const sample = {a:'QA 123a567b A',b:'QA 123a567b B',note:''};

function req({token=caller, key=cfg.GENIE_EDGE_ANON_JWT, body=sample, method='POST',
              path='/functions/v1/vs-decide',contentType='application/json'}={}){
  return new Request('http://127.0.0.1:55321'+path,{method,
    headers:{Authorization:'Bearer '+token,'Content-Type':contentType,...(key===null?{}:{apikey:key})},
    body:method==='POST'?(typeof body==='string'?body:JSON.stringify(body)):undefined});
}
function double(overrides={}){
  const calls=[];
  const run=createFixture(cfg, async(url,opt)=>{
    assert.equal(url.origin,gateway); assert.equal(opt.redirect,'error'); assert.ok(opt.signal);
    const name=url.pathname+url.search;
    calls.push([name,opt]);
    const fn=overrides[name];
    if(fn)return fn();
    switch(name){
      case '/auth/v1/user': return Response.json({id:owner,is_anonymous:true});
      case '/rest/v1/rpc/vs_claim': return new Response(null,{status:204});
      case '/rest/v1/vs_polls?select=id': return Response.json([{id:recordID}],{status:201});
      default: throw Error('Unexpected endpoint '+name);
    }
  });
  return {run,calls};
}

test('refuses hosted/unexpected origin, absent opt-in, and wrong key roles without a request',()=>{
  for(const p of [
    {GENIE_EDGE_NETGUARD:''},{GENIE_EDGE_NETGUARD:undefined},{GENIE_EDGE_MODE:''},{GENIE_EDGE_ORIGIN:'https://example.supabase.co'},
    {GENIE_EDGE_ORIGIN:gateway+'/'},{GENIE_EDGE_ORIGIN:'http://localhost:55321'},
    {GENIE_EDGE_ORIGIN:gateway+'@remote.invalid'},
    {SUPABASE_URL:'https://example.supabase.co'},
    {GENIE_EDGE_WRITER_JWT:cfg.GENIE_EDGE_ANON_JWT},
    {GENIE_EDGE_ANON_JWT:cfg.GENIE_EDGE_WRITER_JWT},
    {GENIE_EDGE_WRITER_JWT:''}
  ]) assert.throws(()=>createFixture({...cfg,...p},()=>assert.fail('no transport')));
});
test('claim and insert use only the verified anonymous user id and actual synthetic A/B',async()=>{
  const f=double();
  const res=await f.run(req());
  assert.equal(res.status,200);
  assert.deepEqual(await res.json(),{kind:'pick',id:recordID});
  assert.deepEqual(f.calls.map(([p])=>p),['/auth/v1/user','/rest/v1/rpc/vs_claim','/rest/v1/vs_polls?select=id']);
  const [[,u],[,q],[,s]]=f.calls;
  assert.equal(u.method,'GET');
  assert.equal(u.headers.apikey,cfg.GENIE_EDGE_ANON_JWT);
  assert.equal(u.headers.Authorization,'Bearer '+caller);
  assert.equal(q.method,'POST');
  assert.equal(q.headers.Authorization,'Bearer '+cfg.GENIE_EDGE_WRITER_JWT);
  assert.deepEqual(JSON.parse(q.body),{p_user:owner});
  assert.equal(s.method,'POST');
  assert.equal(s.headers.Prefer,'return=representation');
  assert.equal(s.headers.Authorization,'Bearer '+cfg.GENIE_EDGE_WRITER_JWT);
  assert.deepEqual(JSON.parse(s.body),{user_id:owner,option_a:sample.a,option_b:sample.b,note:null,pick:'a',
    reason:'Synthetic local QA: fixed side A.'});
});
test('gateway-rewritten route without apikey still uses actual caller check',async()=>{
  const f=double();assert.equal((await f.run(req({path:'/vs-decide',key:null}))).status,200);
  assert.equal(f.calls[0][0],'/auth/v1/user');
  assert.equal(f.calls[0][1].headers.Authorization,'Bearer '+caller);
});
test('rejects invalid, privileged, or wrong-key callers before dependencies',async()=>{
  for(const q of [{token:''},{token:'not.a.jwt'},{token:cfg.GENIE_EDGE_WRITER_JWT},
    {token:cfg.GENIE_EDGE_ANON_JWT},{key:'wrong'}]){
    const f=double();assert.equal((await f.run(req(q))).status,401);assert.equal(f.calls.length,0);
  }
});
test('rejects non-fixture payload, routes, unsupported methods or oversized input before dependencies',async()=>{
  const f=double();
  for(const q of [{body:{...sample,note:'not allowed'}},{body:{...sample,b:'QA deadbeef B'}},
    {body:{...sample,user_id:owner}},{body:'x'.repeat(257)},{body:'[1,2]'},{contentType:'text/plain'}]){
    assert.equal((await f.run(req(q))).status,400);
  }
  assert.equal((await f.run(req({path:'/rest/v1/rpc/vs_claim'}))).status,404);
  assert.equal((await f.run(req({path:'/vs-decide?host=evil'}))).status,404);
  assert.equal((await f.run(req({method:'GET'}))).status,405);
  assert.equal(f.calls.length,0);
});
test('rejected Auth, forged bearer response, non-anonymous user and backend transport errors never write',async()=>{
  for(const auth of [()=>new Response(null,{status:401}),
    ()=>Response.json({id:owner,is_anonymous:false}),
    ()=>Response.json({id:'fake',is_anonymous:true}),
    ()=>{throw Error('redirect blocked');}]) {
    const f=double({'/auth/v1/user':auth});
    const res=await f.run(req());assert.ok([401,502].includes(res.status));assert.equal(f.calls.length,1);
  }
});
test('quota failure does not insert, and save failure does not return a decision',async()=>{
  const failQuota=double({'/rest/v1/rpc/vs_claim':()=>new Response(null,{status:400})});
  assert.equal((await failQuota.run(req())).status,502);
  assert.equal(failQuota.calls.length,2);
  const failInsert=double({'/rest/v1/vs_polls?select=id':()=>Response.json([{id:'bad'}],{status:201})});
  const res=await failInsert.run(req());
  assert.equal(res.status,502);assert.deepEqual(await res.json(),{error:'LOCAL_SAVE_INVALID'});
});
