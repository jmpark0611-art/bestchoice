import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertBeforeVoteResponse, assertOwnerResponse, assertSharedResponse, assertVoteResponse, guard, transport,
  verifyLocalIntegration, deniesExpectedLocalError,
} from './verify-local-integration.mjs';

const id='11111111-1111-4111-8111-111111111111';
const owner=()=>({id,a:'합성 A',b:'합성 B',isOwner:true,myVote:null,pick:'a',reason:'합성 이유',votes:{a:0,b:0}});
const before=()=>({id:null,a:'합성 A',b:'합성 B',isOwner:false,myVote:null,shareCode:null});
const voted=()=>({...before(),myVote:'a',pick:'a',reason:'합성 이유',votes:{a:1,b:0}});
const origin='http://127.0.0.1:55321';
const env=()=>({GENIE_CONFIRM:'isolated-genie-synthetic-only',GENIE_SUPABASE_URL:origin,GENIE_SUPABASE_PUBLIC_KEY:'sb_publishable_fake'});
const jwt=role=>'header.'+Buffer.from(JSON.stringify({role})).toString('base64url')+'.sig';

test('accepts complete synthetic owner, shared and vote responses without modifying them',()=>{
  const own=owner(),pending=before(),choice=voted();
  assert.equal(assertOwnerResponse(own,id),own);
  assert.equal(assertSharedResponse(own),own);
  assert.equal(assertBeforeVoteResponse(pending),pending);
  assert.equal(assertSharedResponse(choice),choice);
  assert.equal(assertVoteResponse(choice),choice);
});

test('owner response rejects missing current app fields and a mismatched decision identity',()=>{
  for(const field of ['id','a','b','isOwner','pick','reason','votes']){
    const value=owner();delete value[field];
    assert.throws(()=>assertOwnerResponse(value,id),undefined,field);
  }
  for(const value of [null,[],{...owner(),id:'another-id'},{...owner(),isOwner:false},{...owner(),pick:'c'},{...owner(),reason:null}]){
    assert.throws(()=>assertOwnerResponse(value,id));
  }
});

test('shared responses reject missing choices and invalid identity or vote types',()=>{
  for(const field of ['a','b','isOwner','myVote']){
    const value=before();delete value[field];
    assert.throws(()=>assertSharedResponse(value),undefined,field);
  }
  for(const value of [null,[],{...before(),a:null},{...before(),b:1},{...before(),isOwner:'false'},
    {...before(),myVote:'none'},{...owner(),id:null},{...owner(),id:''}]){
    assert.throws(()=>assertSharedResponse(value));
  }
});

test('visible shared and vote results reject omitted or malformed result fields',()=>{
  for(const field of ['pick','reason','votes']){
    const value=voted();delete value[field];
    assert.throws(()=>assertSharedResponse(value),undefined,field);
    assert.throws(()=>assertVoteResponse(value),undefined,field);
  }
  for(const value of [{...voted(),pick:'c'},{...voted(),reason:null}]){
    assert.throws(()=>assertSharedResponse(value));
    assert.throws(()=>assertVoteResponse(value));
  }
});

test('owner and voter result counts require both nonnegative safe integers',()=>{
  const invalidCounts=[null,[],{}, {a:1}, {b:0}, {a:-1,b:0}, {a:0,b:-1}, {a:0.5,b:0}, {a:0,b:1.5},
    {a:'1',b:0}, {a:1,b:'0'}, {a:NaN,b:0}, {a:Infinity,b:0}, {a:0,b:Infinity},
    {a:Number.MAX_SAFE_INTEGER+1,b:0},{a:0,b:Number.MAX_SAFE_INTEGER+1}];
  for(const counts of invalidCounts){
    assert.throws(()=>assertOwnerResponse({...owner(),votes:counts},id));
    assert.throws(()=>assertSharedResponse({...voted(),votes:counts}));
    assert.throws(()=>assertVoteResponse({...voted(),votes:counts}));
  }
  assert.doesNotThrow(()=>assertVoteResponse({...voted(),votes:{a:Number.MAX_SAFE_INTEGER,b:0}}));
});

test('pre-vote responses keep private identifiers, results and tallies hidden',()=>{
  for(const fields of [{id},{shareCode:'synthetic-share'},{pick:'a'},{reason:'private'},{votes:{a:0,b:0}},
    {pick:null},{reason:null},{votes:null},{myVote:'a'},{isOwner:true}]){
    assert.throws(()=>assertBeforeVoteResponse({...before(),...fields}));
  }
});

test('vote success requires a recorded choice and complete result, not an unvoted payload',()=>{
  assert.throws(()=>assertVoteResponse(before()));
  assert.throws(()=>assertVoteResponse({myVote:'a'}));
  assert.doesNotThrow(()=>assertVoteResponse({...voted(),myVote:'b'}));
});

test('voted guests never gain owner flags or private poll and share identifiers',()=>{
  for(const fields of [{isOwner:true,id},{id},{shareCode:'synthetic-share'},
    {id:undefined},{shareCode:undefined}]){
    assert.throws(()=>assertVoteResponse({...voted(),...fields}),/non-owner permissions/);
  }
});

test('guard requires exact approved loopback and explicit run consent before accepting a key',()=>{
  assert.equal(guard(env(),'--run'),'sb_publishable_fake');
  assert.equal(guard({...env(),GENIE_SUPABASE_PUBLIC_KEY:jwt('anon')},'--run'),jwt('anon'));
  for(const value of ['',origin+'/',origin+'@host.invalid','http://localhost:55321','http://127.1:55321',
    'http://0.0.0.0:55321','https://prod.supabase.co','http://127.0.0.1:54321']){
    assert.throws(()=>guard({...env(),GENIE_SUPABASE_URL:value},'--run'));
  }
  for(const mode of [undefined,'--self-test','--RUN'])assert.throws(()=>guard(env(),mode));
  assert.throws(()=>guard({...env(),GENIE_CONFIRM:undefined},'--run'));
  for(const key of ['',undefined,'sb_secret_fake',jwt('service_role')]){
    assert.throws(()=>guard({...env(),GENIE_SUPABASE_PUBLIC_KEY:key},'--run'));
  }
});

test('transport keeps fixed loopback, deadline, body and no-redirect policy using only an injected sender',async()=>{
  const calls=[];
  const send=transport('synthetic-public-key',async(url,options)=>{
    calls.push({url,options});return {ok:true};
  });
  const body={p_code:'synthetic-share',p_choice:'a'};
  await send('POST','/rest/v1/rpc/vs_vote',body,'synthetic-session-token');
  const {url,options}=calls[0];
  assert.equal(calls.length,1);
  assert.equal(url.origin,origin);
  assert.equal(url.pathname,'/rest/v1/rpc/vs_vote');
  assert.equal(options.method,'POST');
  assert.equal(options.redirect,'error');
  assert.ok(options.signal instanceof AbortSignal);
  assert.equal(options.signal.aborted,false);
  assert.equal(options.headers.apikey,'synthetic-public-key');
  assert.equal(options.headers.Authorization,'Bearer synthetic-session-token');
  assert.deepEqual(JSON.parse(options.body),body);
});

test('transport rejects external paths, extra RPCs and unrelated methods before the injected sender',()=>{
  let calls=0;
  const send=transport('synthetic-public-key',()=>{calls++;throw Error('Unexpected send');});
  for(const [method,url] of [
    ['GET','//external.invalid/rest/v1/vs_polls'],['POST','https://external.invalid/auth/v1/signup'],
    ['POST','/auth/v1/admin/users'],['POST','/rest/v1/rpc/bc_reset'],['POST','/rest/v1/rpc/vs_reset_all'],
    ['GET','/rest/v1/vs_polls#fragment'],['DELETE','/rest/v1/vs_polls'],['GET','/rest/v1/rpc/vs_vote'],
    ['PUT','/functions/v1/vs-decide'],['POST','/rest/v1/vs_polls'],
  ])assert.throws(()=>send(method,url));
  assert.equal(calls,0);
});

test('transport still permits every original smoke operation with a fake sender',async()=>{
  const calls=[];
  const send=transport('synthetic-public-key',async(url,options)=>{calls.push({url,options});return {ok:true};});
  for(const endpoint of ['/auth/v1/signup','/functions/v1/vs-decide',
    ...['my_poll','share','shared_poll','vote','set_did','delete_poll'].map(name=>'/rest/v1/rpc/vs_'+name)]){
    await send('POST',endpoint,{});
  }
  await send('GET','/rest/v1/vs_polls?select=id,did&id=eq.'+id);
  await send('PATCH','/rest/v1/vs_polls?select=id,did&id=eq.'+id,{did:'b'});
  assert.equal(calls.length,10);
  assert.ok(calls.every(call=>call.url.origin===origin&&call.options.redirect==='error'));
});

test('canonical NOT_FOUND accepts only P0002 with its exact message at HTTP 500, never arbitrary server failures',async()=>{
  const response=(body,status=500)=>Response.json(body,{status});
  assert.equal(await deniesExpectedLocalError(response({code:'P0002',message:'NOT_FOUND'}),'NOT_FOUND'),true);
  for(const [status,body,expected] of [
    [500,{code:'P0001',message:'NOT_FOUND'},'NOT_FOUND'],
    [500,{code:'P0002',message:'backend unavailable'},'NOT_FOUND'],
    [500,{code:'P0002'},'NOT_FOUND'],
    [500,{message:'NOT_FOUND'},'NOT_FOUND'],
    [500,{code:'XX000',message:'NOT_FOUND'},'NOT_FOUND'],
    [500,{code:'P0002',message:'NOT_FOUND'},'OWNER_CANNOT_VOTE'],
    [500,null,'NOT_FOUND'],
    [500,[],'NOT_FOUND'],
    [502,{code:'P0002',message:'NOT_FOUND'},'NOT_FOUND'],
    [503,{code:'P0002',message:'NOT_FOUND'},'NOT_FOUND'],
    [200,{code:'P0002',message:'NOT_FOUND'},'NOT_FOUND'],
  ])assert.equal(await deniesExpectedLocalError(response(body,status),expected),false);
  assert.equal(await deniesExpectedLocalError(new Response('not-json',{status:500}),'NOT_FOUND'),false);
  assert.equal(await deniesExpectedLocalError(response({code:'42501'},403),'42501'),true);
  assert.equal(await deniesExpectedLocalError(response({code:'P0001',message:'OWNER_CANNOT_VOTE'},400),'OWNER_CANNOT_VOTE'),true);
});

// This fixture implements only in-memory HTTP responses. No listener, Supabase
// service, external fetch, account, or database is used by these flow tests.
function flowFixture(fault={}){
  const ownerToken='synthetic-owner-session',guestToken='synthetic-guest-session';
  const code='synthetic-share-code';
  const calls=[],logs=[],warnings=[];
  const state={signups:0,created:false,deleted:false,shared:false,vote:null,did:null,a:'',b:''};
  const reply=(value,status=200)=>new Response(value===undefined?null:JSON.stringify(value),{
    status,headers:{'Content-Type':'application/json'},
  });
  const notFound=()=>reply({code:'P0002',message:'NOT_FOUND'},500);
  const ownerPayload=()=>({
    id,a:state.a,b:state.b,isOwner:true,myVote:null,pick:'a',reason:'합성 이유',
    votes:{a:state.vote==='a'?1:0,b:state.vote==='b'?1:0},
    shareCode:state.shared?code:null,did:state.did,
  });
  const guestPayload=()=>{
    const pending={id:null,a:state.a,b:state.b,isOwner:false,myVote:null,shareCode:null};
    return state.vote?{...pending,myVote:state.vote,pick:'a',reason:'합성 이유',votes:ownerPayload().votes}:pending;
  };
  const send=async(url,options)=>{
    assert.equal(url.origin,origin);
    assert.equal(options.redirect,'error');
    const body=options.body===undefined?undefined:JSON.parse(options.body);
    const token=options.headers.Authorization.slice('Bearer '.length);
    const endpoint=url.pathname;
    calls.push({endpoint,method:options.method,body,token});
    if(endpoint==='/auth/v1/signup'){
      assert.equal(options.method,'POST');
      state.signups++;
      assert.ok(state.signups<=2);
      return reply({user:{id:'synthetic-user-'+state.signups,is_anonymous:true},
        access_token:state.signups===1?ownerToken:guestToken});
    }
    assert.ok(token===ownerToken||token===guestToken,'Every data request uses a distinct synthetic session');
    const isOwner=token===ownerToken;
    if(endpoint==='/functions/v1/vs-decide'){
      assert.equal(isOwner,true);assert.equal(body.note,'');
      state.created=true;state.a=body.a;state.b=body.b;
      if(fault.uncertainDecision)throw Error('Synthetic uncertain decision response');
      return reply({kind:'pick',id});
    }
    if(endpoint==='/rest/v1/vs_polls'){
      assert.equal(url.searchParams.get('id'),'eq.'+id);
      if(options.method==='PATCH')return reply({code:'42501',message:'permission denied'},403);
      assert.equal(options.method,'GET');
      return reply(isOwner&&state.created&&!state.deleted?[{id,did:state.did}]:[]);
    }
    assert.equal(options.method,'POST');
    const name=endpoint.slice('/rest/v1/rpc/vs_'.length);
    if(['my_poll','share','set_did','delete_poll'].includes(name))assert.equal(body.p_id,id);
    if(['shared_poll','vote'].includes(name))assert.equal(body.p_code,code);
    switch(name){
      case 'my_poll': return isOwner&&!state.deleted?reply(ownerPayload()):notFound();
      case 'share':
        if(!isOwner)return fault.allowGuestShare?reply(code):notFound();
        state.shared=true;return reply(code);
      case 'shared_poll':{
        if(state.deleted||!state.shared)return notFound();
        const value=isOwner?ownerPayload():guestPayload();
        if(!isOwner&&state.vote){
          if(fault.reload==='owner')Object.assign(value,{isOwner:true,id,shareCode:code});
          if(fault.reload==='choice')value.myVote='b';
          if(fault.reload==='hidden')return reply({id:null,a:state.a,b:state.b,isOwner:false,myVote:null,shareCode:null});
          if(fault.reload==='tally')value.votes={a:2,b:0};
        }
        return reply(value);
      }
      case 'vote':
        if(isOwner)return reply({code:'P0001',message:'OWNER_CANNOT_VOTE'},400);
        state.vote??=body.p_choice;return reply(guestPayload());
      case 'set_did':
        if(!isOwner)return notFound();
        state.did=body.p_did;return reply(undefined,204);
      case 'delete_poll':
        if(!isOwner){
          if(fault.foreignDelete==='votes')state.vote=null;
          if(fault.foreignDelete==='did')state.did=null;
          if(fault.foreignDelete==='share')state.shared=false;
        }else if(!fault.ownerDeleteNoop)state.deleted=true;
        return reply(undefined,204);
      default: throw Error('Unexpected injected operation '+name);
    }
  };
  const options={send,log:value=>logs.push(value),warn:value=>warnings.push(value)};
  return {calls,logs,warnings,state,options,run:()=>verifyLocalIntegration(env(),'--run',options)};
}

test('explicit flow entry still refuses nonapproved origins before invoking the injected sender',async()=>{
  const fixture=flowFixture();
  await assert.rejects(verifyLocalIntegration({...env(),GENIE_SUPABASE_URL:'http://localhost:55321'},'--run',fixture.options),/exact loopback/);
  assert.equal(fixture.calls.length,0);assert.equal(fixture.logs.length,0);
});

test('injected two-session flow verifies guest share denial, voted reload and unchanged foreign deletion',async()=>{
  const fixture=flowFixture();
  await fixture.run();
  assert.equal(fixture.state.signups,2);assert.equal(fixture.state.deleted,true);
  assert.equal(fixture.logs.length,1);assert.match(fixture.logs[0],/^PASS:.*API-level deletion/);
  assert.match(fixture.logs[0],/Discard the disposable volume/);
  assert.equal(fixture.warnings.length,0);
  const guestCalls=fixture.calls.filter(call=>call.token==='synthetic-guest-session');
  assert.equal(guestCalls.filter(call=>call.endpoint==='/rest/v1/rpc/vs_share').length,1);
  assert.equal(guestCalls.filter(call=>call.endpoint==='/rest/v1/rpc/vs_shared_poll').length,4);
  assert.equal(guestCalls.filter(call=>call.endpoint==='/rest/v1/rpc/vs_delete_poll').length,1);
});

test('a guest share grant fails the flow and HTTP-only fallback cleanup never becomes a PASS',async()=>{
  const fixture=flowFixture({allowGuestShare:true});
  await assert.rejects(fixture.run(),/Foreign share RPC allowed/);
  assert.equal(fixture.logs.length,0);assert.equal(fixture.warnings.length,1);
  assert.match(fixture.warnings[0],/Best-effort.*HTTP success only; removal is unverified/);
  assert.equal(fixture.calls.filter(call=>call.endpoint==='/rest/v1/rpc/vs_delete_poll'&&call.token==='synthetic-owner-session').length,1);
});

for(const [reload,message] of [
  ['owner',/non-owner permissions/],['choice',/guest choice did not persist/],
  ['hidden',/recorded choice/],['tally',/result changed unexpectedly/],
]){
  test('voted shared_poll reload rejects '+reload+' regression before PASS',async()=>{
    const fixture=flowFixture({reload});
    await assert.rejects(fixture.run(),message);
    assert.equal(fixture.logs.length,0);assert.equal(fixture.warnings.length,1);
  });
}

for(const foreignDelete of ['votes','did','share']){
  test('foreign deletion cannot mutate '+foreignDelete+' while leaving the poll row visible',async()=>{
    const fixture=flowFixture({foreignDelete});
    await assert.rejects(fixture.run(),/changed unexpectedly|Foreign delete changed/);
    assert.equal(fixture.logs.length,0);assert.equal(fixture.warnings.length,1);
    assert.equal(fixture.calls.filter(call=>call.endpoint==='/rest/v1/rpc/vs_delete_poll'&&call.token==='synthetic-guest-session').length,1);
  });
}

test('owner deletion with HTTP success but a surviving row fails and marks cleanup unverified',async()=>{
  const fixture=flowFixture({ownerDeleteNoop:true});
  await assert.rejects(fixture.run(),/Deleted record or invitation remained accessible/);
  assert.equal(fixture.state.deleted,false);assert.equal(fixture.logs.length,0);
  assert.match(fixture.warnings[0],/HTTP success only; removal is unverified/);
});

test('an uncertain decision without an ID requires volume disposal rather than claiming cleanup',async()=>{
  const fixture=flowFixture({uncertainDecision:true});
  await assert.rejects(fixture.run(),/Synthetic uncertain decision response/);
  assert.equal(fixture.logs.length,0);assert.equal(fixture.warnings.length,1);
  assert.match(fixture.warnings[0],/no validated poll identity.*Discard the disposable volume/);
  assert.equal(fixture.calls.filter(call=>call.endpoint==='/rest/v1/rpc/vs_delete_poll').length,0);
});
