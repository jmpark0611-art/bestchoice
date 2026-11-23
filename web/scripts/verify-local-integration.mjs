/**
 * Derived from the preserved approved-local-smoke/source/verify-loopback.mjs.
 * Original script SHA-256: 18914a0d609d7520c924f8955e464f8b035090dfa7edaf3f667dfb131b600b1d
 * Original archive SHA-256: df5df614b263e40ad67273d90348899693ee3099be28c874f03efa089d26387e
 *
 * The original README prerequisites still apply: a disposable, unlinked local
 * Supabase stack, verified listener ownership, local-only keys, the pinned vs_*
 * schema, and a deterministic local Edge runtime with external egress denied.
 * The key guard checks format; it cannot prove local provenance or server egress.
 * This is backend verification, not browser/device verification. Anonymous users
 * and logs remain until the disposable volume is discarded. Failed/uncertain
 * requests may leave a poll whose ID was never received; cleanup is best effort.
 *
 * Added checks match current web/src/lib/api.ts response requirements and require
 * safe visible vote counts. Original source and existing server files are intact.
 */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const ORIGIN='http://127.0.0.1:55321', CONFIRM='isolated-genie-synthetic-only';
const POST_PATHS=new Set([
  '/auth/v1/signup', '/functions/v1/vs-decide',
  ...['my_poll','share','shared_poll','vote','set_did','delete_poll'].map(name=>'/rest/v1/rpc/vs_'+name),
]);
export function guard(e,mode){
  if(mode!=='--run'||e.GENIE_CONFIRM!==CONFIRM||e.GENIE_SUPABASE_URL!==ORIGIN)
    throw Error('Refusing request: exact loopback origin and explicit local test opt-in required.');
  const k=e.GENIE_SUPABASE_PUBLIC_KEY??'';
  if(/^sb_publishable_[\w-]+$/.test(k))return k;
  let role; try{const p=k.split('.');if(p.length===3)role=JSON.parse(Buffer.from(p[1],'base64url')).role;}catch{}
  if(role!=='anon')throw Error('Only a local publishable key or anon JWT is accepted.');
  return k;
}
export function transport(key,send=fetch){
  return (method,p,body,token)=>{
    const endpoint=typeof p==='string'?p.split('?',1)[0]:null;
    if(typeof p!=='string'||p.includes('#')||!((method==='POST'&&POST_PATHS.has(endpoint))||
      ((method==='GET'||method==='PATCH')&&endpoint==='/rest/v1/vs_polls')))throw Error('Unexpected endpoint or method');
    const url=new URL(p,ORIGIN);
    if(url.origin!==ORIGIN)throw Error('External requests rejected');
    return send(url,{method,redirect:'error',signal:AbortSignal.timeout(15000),
      headers:{apikey:key,Authorization:'Bearer '+(token||key),'Content-Type':'application/json'},
      body:body===undefined?undefined:JSON.stringify(body)});
  };
}
function must(ok,label){if(!ok)throw Error(label);}
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const side=value=>value==='a'||value==='b';
const safeVotes=value=>record(value)&&Number.isSafeInteger(value.a)&&value.a>=0&&Number.isSafeInteger(value.b)&&value.b>=0;
const visibleResult=value=>side(value.pick)&&typeof value.reason==='string'&&safeVotes(value.votes);

export function assertOwnerResponse(value,id){
  must(record(value)&&typeof value.id==='string'&&value.id===id&&value.isOwner===true&&
    typeof value.a==='string'&&typeof value.b==='string'&&visibleResult(value),
    'Owner response is incompatible with the current app contract');
  return value;
}
export function assertSharedResponse(value){
  must(record(value)&&typeof value.a==='string'&&typeof value.b==='string'&&typeof value.isOwner==='boolean'&&
    (value.myVote===null||side(value.myVote))&&(!value.isOwner||(typeof value.id==='string'&&value.id.length>0)),
    'Shared response is incompatible with the current app contract');
  if(value.isOwner||value.myVote)must(visibleResult(value),'Visible result fields or vote counts are invalid');
  return value;
}
export function assertBeforeVoteResponse(value){
  assertSharedResponse(value);
  must(value.isOwner===false&&value.id===null&&value.shareCode===null&&value.myVote===null&&
    !('pick' in value)&&!('reason' in value)&&!('votes' in value),'Unexpected private fields before vote');
  return value;
}
export function assertVoteResponse(value){
  assertSharedResponse(value);
  must(side(value.myVote),'Vote response must contain the recorded choice');
  must(value.isOwner===false&&value.id===null&&value.shareCode===null,
    'Voter response must keep non-owner permissions and private identifiers hidden');
  return value;
}
function assertSameVisibleResult(value,expected){
  must(value.a===expected.a&&value.b===expected.b&&value.pick===expected.pick&&value.reason===expected.reason&&
    value.votes.a===expected.votes.a&&value.votes.b===expected.votes.b,
    'Shared or owner result changed unexpectedly');
}
function assertRecordedGuest(value,owner){
  assertVoteResponse(value);
  must(value.myVote==='a','Reloaded guest choice did not persist');
  assertSameVisibleResult(value,owner);
}

export async function deniesExpectedLocalError(r,message){
  if(r.status<400||r.status>500)return false;
  const body=await r.json().catch(()=>({}));
  if(!record(body))return false;
  // The preserved SQL raises NOT_FOUND with P0002. PostgREST maps P0* (except
  // P0001) to HTTP 500: https://docs.postgrest.org/en/stable/references/errors.html
  // Accept only that exact canonical tuple; other server failures remain failures.
  if(r.status===500)return message==='NOT_FOUND'&&body.code==='P0002'&&body.message==='NOT_FOUND';
  return body.code===message||body.message===message;
}

export async function verifyLocalIntegration(env,mode,{send=fetch,log=console.log,warn=console.error}={}){
  const req=transport(guard(env,mode),send);
  const json=async(r,label)=>{must(r.ok,label+' HTTP '+r.status);return r.json();};
  const denies=deniesExpectedLocalError;
  const signup=async()=>json(await req('POST','/auth/v1/signup',{data:{}}),'Anonymous Auth');
  const rpc=(name,body,t)=>req('POST','/rest/v1/rpc/vs_'+name,body,t);
  const read=async(name,body,t)=>json(await rpc(name,body,t),name);
  let id,ownerToken,removed=false,started=false;
  try{
    started=true;
    const a=await signup(),b=await signup();
    must(a.user?.is_anonymous===true&&b.user?.is_anonymous===true&&a.user.id&&b.user.id&&a.user.id!==b.user.id&&a.access_token&&b.access_token&&a.access_token!==b.access_token,'Distinct anonymous users required');
    const o=ownerToken=a.access_token,v=b.access_token,marker='QA '+randomUUID().slice(0,8);
    const d=await json(await req('POST','/functions/v1/vs-decide',{a:marker+' A',b:marker+' B',note:''},o),'Deterministic local Edge');
    must(d.kind==='pick'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(d.id??''),'Expected synthetic decision UUID');
    id=d.id;const p={p_id:id},table='/rest/v1/vs_polls?select=id,did&id=eq.'+id;
    const own=assertOwnerResponse(await read('my_poll',p,o),id);
    must(own.a===marker+' A'&&own.b===marker+' B','Owner result mismatch');
    const rows=async(t)=>json(await req('GET',table,undefined,t),'PostgREST owner visibility');
    must((await rows(o)).length===1&&(await rows(v)).length===0,'Direct table reads not isolated');
    must(await denies(await req('PATCH',table,{did:'b'},v),'42501'),'Direct voter write allowed');
    must(await denies(await rpc('my_poll',p,v),'NOT_FOUND')&&await denies(await rpc('set_did',{...p,p_did:'a'},v),'NOT_FOUND'),'Foreign owner RPC allowed');
    must(await denies(await rpc('share',p,v),'NOT_FOUND'),'Foreign share RPC allowed');
    const code=await read('share',p,o);
    must(typeof code==='string'&&/^[\w-]{1,128}$/.test(code)&&await read('share',p,o)===code,'Share was invalid or not idempotent');
    const s={p_code:code};
    assertBeforeVoteResponse(await read('shared_poll',s,v));
    must(await denies(await rpc('vote',{...s,p_choice:'b'},o),'OWNER_CANNOT_VOTE'),'Owner vote was allowed');
    const one=assertVoteResponse(await read('vote',{...s,p_choice:'a'},v));
    const again=assertVoteResponse(await read('vote',{...s,p_choice:'b'},v));
    const tally=assertOwnerResponse(await read('my_poll',p,o),id);
    must(one.myVote==='a'&&again.myVote==='a'&&tally.votes.a===1&&tally.votes.b===0,'Vote not idempotent or tally differs');
    assertSameVisibleResult(one,tally);assertSameVisibleResult(again,tally);
    assertRecordedGuest(await read('shared_poll',s,v),tally);
    must((await rpc('set_did',{...p,p_did:'a'},o)).ok,'Owner choice request failed');
    const recorded=assertOwnerResponse(await read('my_poll',p,o),id);
    must(recorded.did==='a'&&recorded.shareCode===code,'Owner choice or share did not persist');
    assertSameVisibleResult(recorded,tally);
    must((await rpc('delete_poll',p,v)).ok,'Foreign delete RPC should be a no-op');
    must((await rows(o)).length===1,'Voter removed owner record');
    const preserved=assertOwnerResponse(await read('my_poll',p,o),id);
    must(preserved.did===recorded.did&&preserved.shareCode===code,'Foreign delete changed owner choice or share');
    assertSameVisibleResult(preserved,recorded);
    assertRecordedGuest(await read('shared_poll',s,v),preserved);
    must((await rpc('delete_poll',p,o)).ok,'Owner delete unsuccessful');
    must((await rows(o)).length===0&&await denies(await rpc('shared_poll',s,v),'NOT_FOUND'),'Deleted record or invitation remained accessible');
    removed=true;
    log('PASS: local Auth, Edge, current app response contract, PostgREST visibility, owner policy, vote privacy, reload, tally, choice and API-level deletion. Discard the disposable volume for anonymous identities and logs.');
  }finally{
    if(started&&!removed){
      if(id&&ownerToken){
        let acknowledged=false;
        try{acknowledged=(await rpc('delete_poll',{p_id:id},ownerToken)).ok;}catch{}
        warn(acknowledged
          ? 'Best-effort synthetic cleanup received HTTP success only; removal is unverified. Discard the disposable volume, including anonymous identities and logs.'
          : 'Best-effort synthetic record cleanup unconfirmed. Discard the disposable volume, including anonymous identities and logs.');
      }else{
        warn('Synthetic cleanup unconfirmed: no validated poll identity was received. Discard the disposable volume; an uncertain request, anonymous identities or logs may remain.');
      }
    }
  }
}
async function selfTest(){
  const env={GENIE_CONFIRM:CONFIRM,GENIE_SUPABASE_URL:ORIGIN,GENIE_SUPABASE_PUBLIC_KEY:'sb_publishable_fake'};
  assert.equal(guard(env,'--run'),'sb_publishable_fake');
  const jwt=(role)=>'header.'+Buffer.from(JSON.stringify({role})).toString('base64url')+'.sig';
  assert.equal(guard({...env,GENIE_SUPABASE_PUBLIC_KEY:jwt('anon')},'--run'),jwt('anon'));
  for(const url of ['',ORIGIN+'/',ORIGIN+'@host.invalid','http://localhost:55321','http://127.1:55321','http://0.0.0.0:55321','https://prod.supabase.co','http://127.0.0.1:54321']) assert.throws(()=>guard({...env,GENIE_SUPABASE_URL:url},'--run'));
  for(const k of ['sb_secret_fake',jwt('service_role'),''])assert.throws(()=>guard({...env,GENIE_SUPABASE_PUBLIC_KEY:k},'--run'));
  assert.throws(()=>guard(env,undefined));assert.throws(()=>guard({...env,GENIE_CONFIRM:undefined},'--run'));
  let accepted=0;
  const send=transport('fake',async(u,opt)=>{assert.equal(u.origin,ORIGIN);assert.equal(opt.redirect,'error');accepted++;});
  for(const p of ['//external.invalid/rest/v1/vs_polls','/auth/v1/admin/users','/rest/v1/rpc/bc_reset','/rest/v1/vs_polls#fragment'])assert.throws(()=>send('GET',p));
  await send('GET','/rest/v1/vs_polls?select=id');assert.equal(accepted,1);
  console.log('PASS: exact loopback, opt-in, public-key-only, bounded endpoint and fail-on-redirect guards. No network.');
}
// Imports never run requests. Explicit execution retains the loopback/opt-in guard;
// tests inject a sender and do not enter the real network path.
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{
    const m=process.argv[2];
    if(m==='--self-test')await selfTest();
    else if(m==='--run')await verifyLocalIntegration(process.env,m);
    else if(!m)console.log('No requests made. Review the preserved local-stack README prerequisites or use --self-test.');
    else throw Error('Unknown mode.');
  }catch(e){console.error(e instanceof Error?e.message:'QA failed');process.exitCode=1;}
}
