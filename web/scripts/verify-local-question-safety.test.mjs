import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { verifyLocalQuestionSafety, questionSafetyAuditSql } from './verify-local-question-safety.mjs';

const origin = 'http://127.0.0.1:55321';
const env = () => ({ GENIE_SUPABASE_URL: origin, GENIE_CONFIRM: 'isolated-genie-synthetic-only',
  GENIE_SUPABASE_PUBLIC_KEY: 'sb_publishable_synthetic' });
const users = [0,1,2].map(n => `${n+1}1111111-1111-4111-8111-111111111111`);
const pollIds = ['44444444-4444-4444-8444-444444444444','55555555-5555-4555-8555-555555555555'];
const codes = ['synthetic-question-one','synthetic-question-two'];
const tokens = ['private-owner-token','private-viewer-token','private-other-token'];
const json = (value,status=200) => Response.json(value,{status});
const denied = (message,status=403,code='42501') => json({message,code},status);

function fixture(fault={}) {
  const requests=[],observed=[],reports=new Map(),blocks=new Set(),votes=new Set(),exists=new Set();
  const state={ signups:0, decisions:0, quota:0, ownershipChecks:0, parallelStarted:0, active:0,maxParallel:0,cleanup:false };
  let openParallel,notifyParallel;
  const gate=new Promise(resolve=>{openParallel=resolve;});
  const started=new Promise(resolve=>{notifyParallel=resolve;});
  const send=async(url,options)=>{
    assert.equal(url.origin,origin); assert.equal(options.redirect,'error'); assert.ok(options.signal instanceof AbortSignal);
    const body=options.body===undefined?undefined:JSON.parse(options.body),who=tokens.indexOf(options.headers.Authorization.slice(7));
    const route=url.pathname; requests.push({route,method:options.method});
    if(route==='/auth/v1/signup') { const i=state.signups++; return json({user:{id:users[i],is_anonymous:true},access_token:tokens[i]}); }
    if(route==='/functions/v1/vs-decide') {
      assert.equal(who,0); assert.match(body.a,/^QA [0-9a-f]{8} A$/); assert.equal(body.note,'');
      const i=state.decisions++; exists.add(i); return json({kind:'pick',id:pollIds[i]});
    }
    if(route==='/rest/v1/question_reports') {
      assert.equal(options.headers[options.method==='GET'?'Accept-Profile':'Content-Profile'],'genie_question_safety_private');
      return denied('Private schema not exposed',406,'PGRST106');
    }
    const rpc=route.replace('/rest/v1/rpc/vs_','');
    if(who<0) return denied('Permission denied',401);
    if(rpc==='share') return json(codes[pollIds.indexOf(body.p_id)]);
    if(rpc==='delete_poll') {
      state.cleanup=true; const i=pollIds.indexOf(body.p_id); exists.delete(i);
      if(!fault.missingCascade) for(const [k,r] of reports) if(r.poll===i) reports.delete(k);
      for(const value of [...votes]) if(value.endsWith(':'+i)) votes.delete(value);
      if(fault.refundQuota) state.quota=0;
      if(fault.lostBlockOnDelete) blocks.clear();
      return new Response(null,{status:204});
    }
    if(rpc==='set_question_author_block') {
      if(who===0) return denied('BLOCK_SELF_NOT_ALLOWED');
      assert.ok(exists.has(codes.indexOf(body.p_share_code)));
      if(body.p_blocked) blocks.add(who); else blocks.delete(who);
      return json({status:body.p_blocked?'blocked':'unblocked'});
    }
    if(rpc==='clear_question_author_blocks') {
      if(fault.clearOthers) blocks.clear(); else blocks.delete(who);
      return json({status:'cleared'});
    }
    if(rpc==='shared_poll_guarded'||rpc==='vote_guarded') {
      const i=codes.indexOf(body.p_code);
      if(blocks.has(who)) {
        if(rpc==='vote_guarded'&&fault.blockedVoteWrites) votes.add(who+':'+i);
        if(!fault.blockedReadBypass||rpc==='vote_guarded') return denied('AUTHOR_BLOCKED');
      }
      if(!exists.has(i)) return denied('NOT_FOUND',500,'P0002');
      if(rpc==='vote_guarded') votes.add(who+':'+i);
      const hasVote=votes.has(who+':'+i);
      return json({id:null,shareCode:null,a:'A',b:'B',note:null,isOwner:false,myVote:hasVote?'a':null,
        ...(hasVote?{pick:'a',reason:'Synthetic',votes:{a:1,b:0}}:{}),
        ...(fault.preVoteLeaks?{author_id:users[0]}:{})});
    }
    assert.equal(rpc,'report_question');
    const i=codes.indexOf(body.p_share_code);
    if(!body.p_consent) return denied('REPORT_INVALID',400,'22023');
    if(who===0||!exists.has(i)) return denied('REPORT_NOT_ALLOWED');
    if(state.parallelStarted<2) {
      const at=++state.parallelStarted; state.active++; state.maxParallel=Math.max(state.maxParallel,state.active);
      if(at===2) {openParallel();notifyParallel();} await gate;
      if(at===1&&fault.firstParallelFails) {state.active--; return json({},503);}
      if(at===2&&fault.secondGate) await fault.secondGate; state.active--;
    }
    const previous=reports.get(body.p_request_id);
    if(previous) {
      if(previous.details!==body.p_details) return denied('REPORT_REQUEST_CONFLICT',400,'22023');
      if(fault.doubleQuota) state.quota++;
      return json(previous.receipt);
    }
    if(state.quota>=10) return denied('REPORT_LIMIT',400,'P0001');
    const receipt={status:'received',receiptId:randomUUID(),requestId:body.p_request_id,receivedAt:'2026-11-23T14:00:00.000Z',
      ...(fault.receiptLeaks?{author_id:users[0]}:{})};
    reports.set(body.p_request_id,{poll:i,details:body.p_details,receipt}); state.quota++;
    return json(receipt);
  };
  const options={ send,observe:item=>observed.push(item),
    verifyOwnership:async()=>{state.ownershipChecks++; if(fault.ownership) throw Error('OWNERSHIP_UNCONFIRMED');},
    inspectState:async scope=>{
      assert.deepEqual([scope.ownerId,scope.viewerId,scope.otherViewerId],users);
      assert.deepEqual([scope.pollId,scope.otherPollId],pollIds);
      return {reportRows:reports.size,requestRows:Number(reports.has(scope.requestId)),ownerUsed:0,viewerUsed:state.quota,
        otherViewerUsed:0,globalUsed:state.quota,viewerBlocks:Number(blocks.has(1)),otherViewerBlocks:Number(blocks.has(2)),
        viewerVotes:[...votes].filter(x=>x.startsWith('1:')).length,otherViewerVotes:[...votes].filter(x=>x.startsWith('2:')).length};
    } };
  return {state,requests,observed,reports,blocks,options,started,run:()=>verifyLocalQuestionSafety(env(),'--run',options)};
}

test('question safety refuses hosted origins, missing opt-in and missing ownership before requests',async()=>{
  const f=fixture(); await assert.rejects(verifyLocalQuestionSafety({...env(),GENIE_SUPABASE_URL:'https://hosted.invalid'},'--run',f.options));
  await assert.rejects(verifyLocalQuestionSafety(env(),'--run',{send:f.options.send}),/OWNERSHIP_REQUIRED/);
  assert.equal(f.requests.length,0); const noOwner=fixture({ownership:true});
  await assert.rejects(noOwner.run(),/OWNERSHIP_UNCONFIRMED/); assert.equal(noOwner.requests.length,0);
});

test('question flow verifies pre-vote receipt, parallel idempotency, quota, block, unblock, cascade and own-only clear',async()=>{
  const f=fixture(),proof=await f.run();
  assert.equal(f.state.signups,3);assert.equal(f.state.decisions,2);assert.equal(f.state.maxParallel,2);
  assert.equal(proof.preVoteQuestionReportReceived,true);assert.equal(proof.userDailyLimitVerified,10);
  assert.equal(proof.clearAllLeavesOtherUsersBlocks,true);assert.equal(proof.authorBlockSurvivesSourceDeletion,true);
  assert.equal(f.state.quota,10);assert.equal(f.reports.size,0);assert.equal(f.blocks.size,0);
  assert.ok(f.state.ownershipChecks>=f.requests.length*2);
  const output=JSON.stringify({proof,observed:f.observed});
  for(const sensitive of [...users,...pollIds,...tokens,...codes,'Synthetic local question report.']) assert.equal(output.includes(sensitive),false);
  assert.equal(proof.globalQuotaBoundaryHttpTested,false);assert.equal(proof.allDatabaseSchedulesClaimed,false);
});

test('question reports never permit AI/author metadata leakage or duplicate quota',async()=>{
  for(const [fault,code] of [[{receiptLeaks:true},'RECEIPT_INVALID'],[{preVoteLeaks:true},'PREVOTE_PRIVACY_FAILED'],
    [{doubleQuota:true},'DUPLICATE_COUNT_OR_QUOTA']]) {
    const f=fixture(fault); await assert.rejects(f.run(),new RegExp(code));assert.equal(f.state.cleanup,true);
  }
});

test('blocked reads or writes and clearing another user blocks cannot silently pass',async()=>{
  for(const [fault,code] of [[{blockedReadBypass:true},'BLOCKED_READ_ALLOWED'],[{blockedVoteWrites:true},'STATE_MISMATCH'],
    [{clearOthers:true},'CLEAR_SCOPE_FAILED']]) {
    const f=fixture(fault); await assert.rejects(f.run(),new RegExp(code));
  }
});

test('deleting one source keeps daily quota and author blocks while cascading question reports',async()=>{
  for(const fault of [{missingCascade:true},{refundQuota:true},{lostBlockOnDelete:true}]) {
    const f=fixture(fault); await assert.rejects(f.run(),/CASCADE_OR_QUOTA_INVALID/);
  }
});

test('a failed parallel request waits for its peer before deleting synthetic sources',async()=>{
  let release;const secondGate=new Promise(resolve=>{release=resolve;});
  const f=fixture({firstParallelFails:true,secondGate}),pending=f.run();await f.started;
  assert.equal(f.state.cleanup,false);release();await assert.rejects(pending,/PARALLEL_REQUEST_FAILED/);assert.equal(f.state.cleanup,true);
});

test('count-only question audit rejects injected or ambiguous identifiers',()=>{
  const scope={pollId:pollIds[0],otherPollId:pollIds[1],ownerId:users[0],viewerId:users[1],otherViewerId:users[2],requestId:randomUUID()};
  const sql=questionSafetyAuditSql(scope);assert.match(sql,/^select json_build_object\(/);
  assert.equal(/\b(?:insert|update|delete|drop|alter|grant)\b/i.test(sql),false);
  for(const key of Object.keys(scope)) assert.throws(()=>questionSafetyAuditSql({...scope,[key]:"';delete from auth.users;--"}),/SCOPE_INVALID/);
  assert.throws(()=>questionSafetyAuditSql({...scope,otherViewerId:scope.viewerId}),/SCOPE_INVALID/);
  assert.throws(()=>questionSafetyAuditSql({...scope,otherPollId:scope.pollId}),/SCOPE_INVALID/);
});
