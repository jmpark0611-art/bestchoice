import path from 'node:path';
import { verifyAndroidRelease } from './android-release-manifest.mjs';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--android-dir' || !path.isAbsolute(args[1])) {
  console.error('출시 검증에는 명시적인 Android 준비 폴더가 필요합니다.');
  process.exitCode = 1;
} else {
  const result = verifyAndroidRelease({ androidDir: args[1], env: process.env });
  if (!result.ok) {
    for (const error of result.errors) console.error(`${error.field}: ${error.message}`);
    process.exitCode = 1;
  } else console.log('Android 출시 사본의 소스·설정·자산 일치 확인 완료. 서버·서명·실기기 검증은 별도입니다.');
}
