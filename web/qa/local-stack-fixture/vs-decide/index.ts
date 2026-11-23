// DO NOT DEPLOY. Copy this repository-external fixture only into a disposable local stack.
import { createFixture } from './fixture.mjs';

const config = Object.fromEntries([
  'GENIE_EDGE_MODE', 'GENIE_EDGE_ORIGIN', 'GENIE_EDGE_ANON_JWT',
  'GENIE_EDGE_WRITER_JWT', 'GENIE_EDGE_NETGUARD', 'SUPABASE_URL',
].map((key) => [key, Deno.env.get(key)]));

Deno.serve(createFixture(config));
