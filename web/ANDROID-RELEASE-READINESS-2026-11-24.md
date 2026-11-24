> **2026-11-25 01:39 KST 업데이트:** Android CORS는 기존 완료 상태입니다. 신고·차단 migration은 첫 적용 요청의 응답을 확보하지 못했고 이후 이력·catalog에서 미적용을 확인했습니다. 개인정보·삭제 HTML 검토본과 Play 입력 자료를 준비했으며, 현재 AAB에 정식 정책 접근이 없어 앱 연결과 새 후보가 추가로 필요합니다. [이번 준비와 실제 차단점](qa/release-finalization-2026-11-25.md).

# 결정해지니 Android — 내부 테스트 준비 상태

기준일: **2026-11-24 KST**. 서명 AAB 생성과 검증을 마쳤습니다. Play Console은
Google 로그인 화면까지만 접근했으며, 앱 목록 확인·업로드·내부 테스트 배포·심사 제출은
아직 수행하지 않았습니다. 현재 후보의 운영 서버 기능과 실물 기기 동작도 미검증입니다.

## 1. 검증을 마친 기존 후보

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

**2026-11-25 01:04:57 KST** 적용 전 검사에서 기존 함수 9개·주요 테이블 4개와 검토 기준이 일치했고 13개 조건을 통과했습니다. 정확한 첫 migration을 정상 실행 경로로 요청했으나 실행 환경 교체 후 완료 응답을 확보하지 못했습니다. 이력은 **01:35 KST**에도 기존 7건이며, **01:39:25 KST**의 정확한 이름 조회에서 두 신규 schema와 공개 함수 6개 이름의 모든 overload가 없습니다.

두 번째 migration은 요청하지 않았습니다. SQL 오류·자동 승인 거절·사용자 취소로 확인된 상황이 아니며, 이전 외부 요청이 완전히 취소됐다는 증거도 없습니다. 같은 요청을 반복하지 않고 정상 실행 연결과 미완료 요청 상태를 확인한 뒤 이미 승인된 두 파일로 이어가야 합니다. 성공하면 실제 migration version·함수·권한·RLS·기존 계약 및 Advisors를 확인합니다.
[이번 실행 기록](qa/release-finalization-2026-11-25.md) · [이전 실행 이력](qa/production-server-resume-2026-11-24.md).

### 개인정보 안내 — HTML 검토본 준비, 앱 연결 필요

[개인정보처리방침](release-assets/legal/privacy.html)과 [삭제 안내](release-assets/legal/delete-data.html)를 준비했습니다. 실제 공개 URL·시행일·미확정 운영 사실은 아직 확정하지 않았습니다.
현재 후보의 `AboutScreen.tsx`는 시험용 이용 안내이며 최종 정책 전문/연결과 외부 삭제 안내 연결이 없습니다. 정확한 후보 소스와 현재 소스의 해당 파일 blob이 동일함을 확인했습니다.

정식 안내와 실제 URL을 확정하고 앱 내 접근을 추가한 뒤 새 후보를 만들어 필요한 검증을 해야 합니다. 문서 준비가 기존 AAB의 정책 연결까지 바꾼 것은 아닙니다.
[정확한 운영 확인 항목](release-assets/legal/PRIVACY-RELEASE-REVIEW.md).

## 4. 다음 진행 순서

1. 이미 확정된 상호·대표·문의 이메일·18+는 유지하고, 실제 공급자 보관 설정·삭제 문의·신고 검토 등 남은 사실을 확인해 공개 안내를 최종화합니다.
2. 승인된 공개 경로에 정책·삭제 안내를 게시하고 실제 URL을 확인한 뒤 앱 내 접근을 연결합니다. 그 변경을 포함한 새 후보를 만들고 정책 열기·뒤로가기·좁은 화면 및 빌드에 필요한 확인을 수행합니다.
3. 승인된 신고·차단 migration 두 건은 정상 실행 연결과 미완료 요청 상태를 확인한 후 정확한 파일로 이어가고 실제 이력·권한·RLS를 확인합니다. CORS 사전 요청은 이미 확인했습니다.
4. 기존 Play 계정에서 정확한 패키지·버전·인증서를 확인하고 새 후보를 선택합니다. 실제 계정에 제시된 조건을 확인하며 내부 배포·심사 제출은 별도 승인 범위로 둡니다.
5. 명시적으로 승인된 격리 환경에서 합성 데이터와 정리 절차로 인증·AI·공유/투표·신고·차단·삭제를 확인합니다. 운영 서버를 시험 환경으로 간주하지 않습니다. 실제 Android 설치·스크린샷·Console 입력을 마친 뒤 승인된 출시 단계로 진행하고 iOS를 이어갑니다.

`PLAY-SUBMISSION-PACKET.md/.json`은 항목별 준비 자료입니다. `null`인 값은 미확정이며
`아니요`로 대신 입력하지 않습니다. 기존 후보와 QA APK 증거는 각 후보의 이력에 보존합니다.

구조화한 현재 상태는 `ANDROID-RELEASE-READINESS-2026-11-24.json`, 후보 기본 정보는
`ANDROID-RELEASE-PROFILE.json`, 전달 파일의 상세 검증 기록은
`Genie-Android-1.0.0-1-20261124-verification.json`입니다.
