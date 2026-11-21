import {spawnSync} from 'node:child_process';
const r=spawnSync('npm',['run','build'],{stdio:'inherit',env:{...process.env,VITE_SUPABASE_URL:'https://genie-test.invalid',VITE_SUPABASE_PUBLISHABLE_KEY:'test-publishable',VITE_PUBLIC_APP_URL:''}});process.exit(r.status??1);
