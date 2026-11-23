// Synthetic fixture only. Not production code. No dependencies or model calls.
const mode = 'isolated-genie-synthetic-only';
const origins = new Set(['http://127.0.0.1:55321', 'http://kong:8000', 'http://genie-isolated-gateway:8000']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tokenRE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const decisionRoute = new Set(['/vs-decide','/functions/v1/vs-decide']);
const reason = 'Synthetic local QA: fixed side A.';

function role(key) {
  if (typeof key !== 'string' || key.length > 8192 || !tokenRE.test(key)) return null;
  try {
    const p = key.split('.')[1].replaceAll('-', '+').replaceAll('_', '/');
    return JSON.parse(atob(p)).role ?? null;
  } catch { return null; }
}

function assertConfig(e) {
  if (e.GENIE_EDGE_NETGUARD !== 'docker-internal-verified' ||
      e.GENIE_EDGE_MODE !== mode || !origins.has(e.GENIE_EDGE_ORIGIN) ||
      role(e.GENIE_EDGE_ANON_JWT) !== 'anon' || role(e.GENIE_EDGE_WRITER_JWT) !== 'service_role' ||
      e.GENIE_EDGE_ANON_JWT === e.GENIE_EDGE_WRITER_JWT) {
    throw Error('Refusing to start synthetic Genie fixture: isolated local origin, mode and local keys required.');
  }
  // Reject an exposed hosted Supabase runtime, even when fixture settings are
  // present; the operator must separately prove local DNS and network isolation.
  if (e.SUPABASE_URL && !origins.has(e.SUPABASE_URL)) {
    throw Error('Refusing runtime with an unexpected Supabase origin.');
  }
}

function reply(status, body) {
  return Response.json(body, {status, headers:{'Cache-Control':'no-store'}});
}

async function inputOf(req) {
  if (req.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json' || !req.body) return null;
  const pending = req.body.getReader();
  const data = new Uint8Array(256);
  let size = 0;
  try {
    for (;;) {
      const {done,value} = await pending.read();
      if (done) break;
      if (size + value.byteLength > data.length) {
        // Do not await cancellation of a malicious or ill-behaved input stream.
        void pending.cancel().catch(() => {});
        return null;
      }
      data.set(value,size); size += value.byteLength;
    }
    const input = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(data.subarray(0,size)));
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        Object.keys(input).sort().join(',') !== 'a,b,note' || typeof input.a !== 'string' ||
        !/^QA [0-9a-f]{8} A$/.test(input.a) || input.b !== input.a.slice(0,-1)+'B' || input.note !== '') return null;
    return input;
  } catch { return null; }
}

export function createFixture(e, transport = fetch) {
  assertConfig(e);
  const origin = e.GENIE_EDGE_ORIGIN;
  const anon = e.GENIE_EDGE_ANON_JWT, writer = e.GENIE_EDGE_WRITER_JWT;
  const endpoints = Object.freeze({
    user: ['GET','/auth/v1/user'],
    claim: ['POST','/rest/v1/rpc/vs_claim'],
    insert: ['POST','/rest/v1/vs_polls?select=id'],
  });
  async function local(which, apikey, bearer, body) {
    const [method,path] = endpoints[which];
    const url = new URL(path, origin);
    if (url.origin !== origin) throw Error('External backend blocked.');
    return transport(url,{
      method, redirect:'error', cache:'no-store', signal:AbortSignal.timeout(8000),
      headers:{apikey, Authorization:'Bearer '+bearer, 'Content-Type':'application/json',
        ...(which === 'insert' ? {Prefer:'return=representation'}:{})},
      body:body===undefined?undefined:JSON.stringify(body),
    });
  }
  return async (req) => {
    const url = new URL(req.url);
    if (!decisionRoute.has(url.pathname) || url.search) return reply(404,{error:'NOT_FOUND'});
    if (req.method !== 'POST') return reply(405,{error:'METHOD_NOT_ALLOWED'});
    const inboundKey = req.headers.get('apikey');
    // A local gateway may remove a validated apikey header before forwarding.
    // If present, refuse a wrong key; in both cases Auth must verify the JWT.
    if (inboundKey !== null && inboundKey !== anon) return reply(401,{error:'AUTH_REQUIRED'});
    const authorization = req.headers.get('Authorization') || '';
    const caller = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (caller === writer || caller === anon || role(caller) !== 'authenticated') return reply(401,{error:'AUTH_REQUIRED'});
    const input = await inputOf(req);
    if (!input) return reply(400,{error:'SYNTHETIC_INPUT_REQUIRED'});
    try {
      // The JWT role test above is only an early reject; only real local Auth
      // validates the signature and provides the authoritative owner UUID.
      const result = await local('user',anon,caller);
      if (result.status===401 || result.status===403) return reply(401,{error:'AUTH_REQUIRED'});
      if (!result.ok) return reply(502,{error:'LOCAL_AUTH_UNAVAILABLE'});
      const user = await result.json();
      if (typeof user.id !== 'string' || !uuid.test(user.id) || user.is_anonymous !== true) {
        return reply(401,{error:'ANONYMOUS_FIXTURE_USER_REQUIRED'});
      }
      const quota = await local('claim',writer,writer,{p_user:user.id});
      if (!quota.ok) return reply(502,{error:'LOCAL_CLAIM_FAILED'});
      const saved = await local('insert',writer,writer,{
        user_id:user.id,option_a:input.a,option_b:input.b,note:null,pick:'a',reason,
      });
      if (!saved.ok) return reply(502,{error:'LOCAL_WRITE_FAILED'});
      const rows = await saved.json();
      if (!Array.isArray(rows) || rows.length!==1 || typeof rows[0]?.id !== 'string' || !uuid.test(rows[0].id)) {
        return reply(502,{error:'LOCAL_SAVE_INVALID'});
      }
      return reply(200,{kind:'pick',id:rows[0].id});
    } catch { return reply(502,{error:'LOCAL_BACKEND_UNAVAILABLE'}); }
  };
}
