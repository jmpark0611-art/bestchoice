> **2026-11-25 00:44 KST 업데이트:** 기존 네 Origin을 보존한 Android 접속 설정을 저장했고, Android와 기존 웹의 고정 OPTIONS 두 건이 모두 204·정확한 허용 Origin으로 통과했습니다. 신고·차단 DB migration 두 건은 실행 연결 문제로 여전히 미적용입니다. [실제 저장·검증 기록](qa/native-cors-applied-2026-11-25.md).

# 결정해지니 Android — 내부 테스트 준비 상태

기준일: **2026-11-24 KST**. 서명 AAB 생성과 검증을 마쳤습니다. Play Console은
Google 로그인 화면까지만 접근했으며, 앱 목록 확인·업로드·내부 테스트 배포·심사 제출은
아직 수행하지 않았습니다. 현재 후보의 운영 서버 기능과 실물 기기 동작도 미검증입니다.

## 1. 이번에 완성한 후보

| 항목 | 확인 값 |
| --- | --- |
| 앱 / 패키지 | 결정해지니 / `com.jmpark0611.genie` |
| 버전 | `1.0.0` / versionCode `1` — Console에서 사용 가능 여부 확인 필요 |
| 파일 | `Genie-Android-1.0.0-1-20261124-candidate.aab` |
| 크기 | 4,161,320 bytes |
| SHA-256 | `5fbf088745564bbe32343a485a2b316f130ba9668c529a25a48f17f557256e78` |
| 실제 export 소스 | `b8d9db66c249684842971410f2c7b80dd5bec395` |
| CI 근거 | [실행 45289031213](https://github.com/jmpark0611-art/bestchoice/actions/runs/45289031213), attempt 1, job `138092733186`, success |
| export artifact | `14871979624`, ZIP SHA-256 `303f9755dd205e31d572158a7e901a6c38f191e44090f7c672f1b50fd762e81c` |
| 업로드 인증서 SHA-256 | `1f9dace46345078bcd9089be6c38b6259b83a4e2040611558c9e108eea22ea71` — 기존 키와 동일 |

GitHub에서 별도로 조회한 실행·artifact 메타데이터로 ZIP 해시와 출처를 확인했습니다.
서명 전 159개 소스, 공개 설정, 184개 웹 자산, 69개 native 파일의 준비 기록과
unsigned AAB를 대조했습니다. 기존 업로드 키로 별도 파일에 서명한 뒤 서명·인증서와
서명 메타데이터 외 모든 payload 바이트의 불변을 확인했습니다.

CI는 최종 binary manifest identity를 검증했습니다. 로컬 서명 과정은 그 검증 기록과
manifest 바이트를 보존했으며 manifest를 다시 파싱한 것으로 기록하지 않습니다.
이 후보로 QA APK를 새로 생성하거나 기기에 설치하지는 않았습니다.

## 2. Android 실패 수정과의 연결

기기 검증 소스는 `eaf89c29c2bd06e3123e7c822a453d1a23b2153c`입니다.
이번 export 커밋은 workflow의 설명 주석만 변경했습니다. 두 소스의 빌드 입력 159개는
바이트 단위로 같고, 목록 SHA-256은
`949f135553920a3d8aaff7b0318893f11eebbcae48cfb99d6b3343f3828645b7`입니다.
Unsigned AAB 해시도 해당 검증 소스의 [release build 45278517310](https://github.com/jmpark0611-art/bestchoice/actions/runs/45278517310)과
같은 `df2819562154f4dc833a69ae5b7d3e47c8e31a6e7ab94f0a41e5aee7245f46d3`입니다.

[기기 실행 45278517165](https://github.com/jmpark0611-art/bestchoice/actions/runs/45278517165)의
attempt **1·3·4**는 각각 실행, About 실제 터치와 native Back, 좁은 화면,
host force-stop 뒤 초안 복원 등 네 케이스를 통과했습니다. Attempt 2는 Maven
HTTP 429로 APK 빌드에서 멈춰 계측을 실행하지 않았습니다. 따라서 실제 계측 3회가
모두 성공했으며, 전체 workflow가 세 번 연속 성공했다는 뜻은 아닙니다.

이 근거는 격리된 preview 에뮬레이터 검사입니다. 출시 서명 AAB 설치, 실물 기기,
운영 AI·공유·신고 흐름을 통과했다는 의미로 확대하지 않습니다.

## 3. 운영 서버의 현재 상태

### Android CORS — 저장 및 고정 사전 요청 확인 완료

**2026-11-25 00:42:26 KST**에 `bestchoice` 프로젝트의 `VS_ALLOWED_ORIGINS`를
저장했습니다. 저장 전 이 키가 없음을 관리 화면에서 확인했고, 새로 조회한 배포
`vs-decide` v2의 fallback 네 주소를 모두 유지하면서 `https://localhost`만 추가했습니다.
정확한 다섯 주소에 대한 사용자 승인 후 저장됐으며, 입력값의 SHA-256과 관리 화면의
저장 digest가 일치했습니다. 기존 `ALLOWED_ORIGINS`의 digest·수정 시각은 그대로입니다.

**2026-11-25 00:44:19 KST**의 [고정 검사 실행](https://github.com/jmpark0611-art/bestchoice/actions/runs/45183387009/job/138568566856)에서
Android `https://localhost`와 기존 웹 `https://genie-web-rosy.vercel.app`가 각각
HTTP 204, 요청과 정확히 같은 허용 Origin, POST 및 요청한 세 헤더 허용을 확인했습니다.
두 OPTIONS에는 본문·인증 값을 보내지 않았고 실제 POST·모델 호출·운영 데이터 쓰기는
없었습니다. [저장 값·시각·검사 범위](qa/native-cors-applied-2026-11-25.md)에 기록합니다.

11월 23일의 Android 403 관측은 과거 이력으로 보존합니다. 이번 결과로 Android
Origin 차단은 해소됐지만 인증·AI 응답·공유·신고의 종단 간 성공을 의미하지 않습니다.

### 신고·질문 안전성·작성자 차단 DB — 미적용

앞선 신규 DB 객체 확인 기록은 **2026-11-24 23:06:42 KST**입니다. 기존 migration 7개만 있고,
두 신규 private schema, 공개 RPC 6개·내부 함수 7개·private table 7개는 없습니다.
사용자 재개 승인은 확보했으나 두 적용 요청이 실행 환경 교체로 완료 응답을 받지
못했으며, 이후 조회에서 신규 객체 부재를 확인했습니다. 이번 CORS 변경 중에는
새 DB 적용을 시도하지 않았습니다. [재개 실행 기록](qa/production-server-resume-2026-11-24.md).

**11월 25일 00:46:39 KST**의 추가 읽기 진단에서도 기존 이력 7개와 두 신규 schema의
부재를 확인했습니다. 프로젝트는 정상 상태이지만, 이전 적용 요청의 취소 완료나
쓰기 연결 복구까지 입증한 결과는 아닙니다.

남은 DB 단계는 이미 준비된 정확한 migration 두 건을 안정적인 실행 경로로 적용한 뒤,
실제 기록된 version과 신규 함수·권한·RLS 및 기존 기능 보존을 확인하는 것입니다.
같은 사업적 승인을 다시 기다리는 상태로 표시하지 않습니다.

## 4. 다음 진행 순서

1. 기존 Google Play 개발자 계정에 로그인하고 정확히 `com.jmpark0611.genie` 앱을 확인합니다.
   앱이 존재하는지, versionCode `1` 사용 여부와 업로드 인증서를 확인한 뒤 후보를 선택합니다.
2. 이 AAB로 내부 테스트 초안을 준비합니다. Console의 실제 요구 사항을 확인하며,
   업로드나 초안 저장을 공개 출시 또는 내부 배포 완료로 기록하지 않습니다.
3. 승인된 운영 migration 두 건의 실행 연결 문제를 해결하고 실제 이력·권한·RLS를 확인합니다.
   Android CORS는 저장 및 고정 사전 요청 확인을 마쳤습니다. 이후 인증·AI 응답·공유/투표·
   신고·차단·삭제의 기능 검증은 명시적으로 승인된 별도 격리 환경에서 합성 데이터와
   정리 절차를 사용해 진행합니다. 운영 서버를 테스트 환경으로 간주하지 않습니다.
4. Play에서 전달한 빌드를 실제 Android 기기에 설치해 About/뒤로가기, 작은 화면,
   초안 강제 종료 복원 및 운영 기능을 재확인합니다.
5. 실제 앱 스크린샷, 공개 개인정보·삭제 요청 경로, Data safety 미확정 값과 콘텐츠 등급
   설문을 완성한 뒤 검토·출시를 진행합니다. 사용자 결정인 대상 연령 `18+`와 콘텐츠 등급은
   별개로 기록합니다.

`PLAY-SUBMISSION-PACKET.md/.json`은 항목별 준비 자료입니다. `null`인 값은 미확정이며
`아니요`로 대신 입력하지 않습니다. 기존 후보와 QA APK 증거는 각 후보의 이력에 보존합니다.

구조화한 현재 상태는 `ANDROID-RELEASE-READINESS-2026-11-24.json`, 후보 기본 정보는
`ANDROID-RELEASE-PROFILE.json`, 전달 파일의 상세 검증 기록은
`Genie-Android-1.0.0-1-20261124-verification.json`입니다.
