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

## 3. 운영 서버의 현재 제약

**2026-11-24 08:34:04 KST**에 운영 프로젝트 `njrtcxohbkfgrgwhlvua`의 migration
이력과 시스템 카탈로그를 읽기 전용으로 확인했습니다. 기존 migration 7개만 있고,
`genie_reporting_private`·`genie_question_safety_private`, 신규 public RPC 6개,
내부 함수 7개, private table 7개가 모두 없습니다. 신고·질문 안전성·작성자 차단
백엔드는 아직 미적용입니다. 실제 사용자 데이터 조회나 운영 쓰기는 수행하지 않았습니다.

Android CORS의 마지막 관측은 **2026-11-23 22:23:23 KST**입니다.
웹 origin은 HTTP 204, Android `https://localhost`는 HTTP 403 `ORIGIN_DENIED`였습니다.
이번 환경에서는 Edge URL에 대한 새 OPTIONS 요청을 실행하지 못했으므로 이를 현재
응답으로 표시하지 않습니다. 현재 허용 origin 목록을 읽고 기존 값을 유지한 상태로
Android origin 추가 여부를 확인해야 합니다.

이전 migration 적용은 사용자 취소로 끝났으며 이번에는 재시도하지 않았습니다.
취소된 운영 변경의 재개 의사를 확인한 뒤, 이미 준비된 migration 원본·사전 조건·해시를
대조하고 적용 및 권한·기능 검증을 이어가야 합니다.

## 4. 다음 진행 순서

1. 기존 Google Play 개발자 계정에 로그인하고 정확히 `com.jmpark0611.genie` 앱을 확인합니다.
   앱이 존재하는지, versionCode `1` 사용 여부와 업로드 인증서를 확인한 뒤 후보를 선택합니다.
2. 이 AAB로 내부 테스트 초안을 준비합니다. Console의 실제 요구 사항을 확인하며,
   업로드나 초안 저장을 공개 출시 또는 내부 배포 완료로 기록하지 않습니다.
3. 미적용 운영 migration과 Android CORS를 해결하고 인증·AI 응답·공유/투표·신고·차단·삭제를
   합성 테스트 데이터와 정리 절차로 검증합니다. 기존 운영 사용자 자료에는 손대지 않습니다.
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
