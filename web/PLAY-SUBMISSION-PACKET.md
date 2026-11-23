# 결정해지니 — Play Console 제출 항목과 심사 접근 패킷

갱신 기준: 2026-11-23 22:36 KST (13:36 UTC). **입력용 준비 자료이며 Play Console 등록·저장·제출을 수행한 기록이 아닙니다.**

앱 설명과 개인정보 초안은 `PLAY-STORE-PREPARATION.md`를 그대로 기준으로 사용합니다.
이 파일은 내용을 다시 포장하지 않고 Console 항목별 답변, 영문 심사 지침, 확인된
운영 근거와 제출 전 해결할 항목을 추가합니다. `PLAY-SUBMISSION-PACKET.json`은
같은 판단을 구조화한 내부 준비 자료이며 Google 공식 CSV/API 가져오기 형식이 아닙니다.
`null`은 미확정이며 `아니요`로 바꾸어 입력하면 안 됩니다.

## 1. 이 패킷에 연결된 후보

| 항목 | 값 |
| --- | --- |
| 앱 | 결정해지니 · `com.jmpark0611.genie` |
| 버전 | versionName `1.0.0` · versionCode `1` |
| 새 UGC 후보 소스 | `5efd0a4fe7f04b38087ecc3de07c1730ce4b0944` |
| 새 후보 진행 상태 | 실제 CI export 성공, 로컬 서명·서명 확인·원본 payload 불변 확인 완료 |
| 새 후보 파일 | `Genie-Android-1.0.0-1-ugc-candidate.aab` · 4,161,285 bytes |
| 새 후보 SHA-256 | `347b580ca3a3a86c50453e55adb31375b3124cdafe1cd6c790fca7ccb6a7b5c3` |
| 새 후보 검증 기록 | `Genie-Android-1.0.0-1-ugc-verification.json` |
| 실제 export 근거 | [run 45184417729](https://github.com/jmpark0611-art/bestchoice/actions/runs/45184417729) · job `137726190042` · success |
| 확정 준비본 | 소스 159개 · 웹 자산 184개 · native 69개. 준비 시각 2026-11-23 22:29:42 KST (`2026-11-23T13:29:42.225Z`) |
| 운영 주체 | 에스제이컴퍼니 · 대표 박지민 |
| 문의 | `jmpark0611@gmail.com` |
| 공유 웹 | `https://genie-web-rosy.vercel.app` |
| 현재 제출 가능 여부 | 미완료. Android 운영 Origin 거부 해소, 신고·차단 계약의 운영 적용, 공개 정책·삭제 안내, 새 서명 후보/공유 웹 확인 등이 필요 |

**이전 후보의 이력:** 소스 `959836f6a19bc4729d49b20237092384a2417728`,
`Genie-Android-1.0.0-1-candidate.aab`, 4,158,468 bytes,
SHA-256 `c737b458e8e606bd616ee5f5b8698ac6e2ca886d04c474e3a47a1a2fffddb56c`입니다.
JSON의 `previousCandidate`에 보존하며 새 UGC 후보의 파일·검증 결과로 사용하지 않습니다.

공유 전 정책 동의, 투표 전 질문 신고, 작성자 차단·해제 UI를 새 서명 후보에
포함했습니다. 아래 심사 안내는 이 보완을 포함하는 후보용 초안입니다. 새 서버
계약은 일회용 격리 환경의 실제 HTTP 검증을 통과했으며 운영에는 적용하지 않았습니다.
서버 QA나 기존 preview 가상기기 검증을 새 서명 AAB의 기기 검증으로 간주하지 않습니다.
새 후보는 기존과 같은 upload 인증서로 서명했습니다. QA용 APK 변환과 원본 내용·
AAB/APK Manifest·APK 서명 확인을 완료했습니다. 실제 기기 실행은 하지 않았습니다.
정확한 새 후보의 기기·운영 접근 확인 전에는
제출 준비 완료로 표시하지 않습니다.

## 2. Console에 옮길 항목

Console의 현재 화면에서는 앱 콘텐츠 항목이 `App access` 또는 `Sign-in details`로
표시될 수 있습니다. 이번 Play Console 읽기 접근은 자동 승인 검토에서 거절되어
실제 폼을 확인하지 못했습니다. 로그인·등록·저장·제출에 성공했다고 표시하지 않으며,
보이지 않은 체크박스 ID도 기록하지 않습니다. 접근이 가능한 후 실제 문항의 의미에
맞춰 아래 답변을 옮깁니다.[G1]

| Console 항목 | 입력/판단 | 상태와 근거 |
| --- | --- | --- |
| 앱 이름 | `결정해지니` | 준비됨 |
| 기본 언어 | 한국어 `ko-KR` | 현재 UI·설명 기준의 입력 초안 |
| 앱/게임 | 앱 | 두 선택지에 관한 결정 도구 |
| 카테고리 | 생산성 `Productivity` | 기능에 따른 분류 제안. 게임·의료·금융 서비스로 소개하지 않음 |
| 짧은 설명 | `두 선택지와 중요한 기준을 적고, AI 제안과 친구 투표를 참고해 내 선택을 정리하세요.` | 기존 설명과 동일한 입력값 |
| 자세한 설명 | `PLAY-STORE-PREPARATION.md`의 `상세 설명` 본문 | 이미 준비된 원문 사용. 미활성 운영 신고·무제한 사용을 홍보 문구에 추가하지 않음 |
| 지원 이메일 | `jmpark0611@gmail.com` | 기존 앱에 명시된 실제 연락처. 사용자 이메일 수집 필드가 있다는 뜻은 아님 |
| 지원 웹사이트 | `https://genie-web-rosy.vercel.app` | 공개 앱 주소. 개인정보처리방침 URL로 대체 사용하지 않음 |
| 개인정보처리방침 URL | 미입력 | 앱을 명시하는 공개 HTML 정책과 앱 내 접근 경로를 먼저 완성해야 함 |
| 광고 포함 | 아니요 | 현재 앱·Manifest·의존성에서 광고 SDK, 배너, 후원 노출·자체 광고 흐름 없음 |
| 인앱 상품/구독 | 없음 | 결제·구독 화면, Google Play Billing·결제 SDK/API 및 결제 권한 없음. 스토어의 다운로드 가격을 설정했다는 뜻은 아님 |
| 앱 접근 안내 | 아래 5개 영문 지침 | 이메일·비밀번호·OTP·기존 계정을 제공하는 구조가 아님. 자동 익명 세션과 작성자/투표자별 표시 조건 설명 |
| 대상 연령 | 사용자 결정 1건 남음 | 실제 의도한 대상 연령. 임의로 18세 이상이나 전 연령을 선택하지 않음 |
| 콘텐츠 등급 | 실제 설문 답변 후 산출 | 연령등급을 직접 지정하거나 `전체이용가`로 가정하지 않음. 공유 질문·투표·AI 생성 기능을 아래 사실대로 신고 |
| 데이터 보안 | 3절의 항목별 초안 | `수집 없음` 선택 불가. 공급자 공유 분류·로그·삭제 답변의 남은 확인을 해결한 뒤 제출 |
| 스토어 이미지 | 기존 512×512 아이콘, 1024×500 feature graphic | 이미지 파일 준비 완료. 폰 스크린샷은 실제 제출 화면으로 추가 확보 필요 |
| 국가/가격/출시 트랙 | 이 패킷에서 변경하지 않음 | Console 작업 시 기존 승인된 출시 설정과 계정의 실제 요구 사항에 맞춰 처리. 결제나 제출 동작을 수행하지 않음 |

출시 노트 입력 초안:

```text
결정해지니 첫 버전입니다.
두 선택지와 중요한 기준으로 AI 제안을 받고, 친구 투표와 함께 내 선택을 정리할 수 있어요.
실제 선택을 기록하고, 이 기기에 초안과 회고를 보관할 수 있어요.
```

콘텐츠 등급 설문에 사용할 기능 사실은 다음과 같습니다. 실제 설문 문항이 이
사실과 다른 범위를 묻는다면 문항 그대로 읽고 판단합니다.

- 사용자 작성 선택지·상황을 링크로 다른 사람이 볼 수 있음: **있음**.
- 친구의 투표 및 익명 식별자와 연결되는 투표 기록: **있음**.
- AI가 선택과 이유를 생성함: **있음**. 결과가 항상 특정 등급에 적합하다고 보증하지 않음.
- 공개 피드·사용자 검색·댓글·DM·음성/영상 채팅·친구 연락처 업로드: **현재 코드에 없음**.
- 광고·인앱 구매·도박/현금 보상·위치 기반 기능: **현재 코드에 없음**.
- 신고/차단·사용자 콘텐츠 관리 질문: AI 결과 신고 UI만으로 모든 UGC 관리가 완성됐다고 답하지 않음. 6절의 실제 범위 적용.

## 3. 데이터 보안: 항목별 답변 초안

### 3.1 앱 전체 질문

| 질문의 의미 | 준비한 답변 | 근거/남은 확인 |
| --- | --- | --- |
| 앱이 사용자 데이터를 수집 또는 공유하는가? | **예** | 익명 ID와 결정 입력·투표·선택 등을 서버로 보냄 |
| 전송 중 암호화하는가? | **예 — 확인한 후보의 코드 경로 기준** | 앱→Supabase는 HTTPS, 배포된 Edge→OpenAI도 HTTPS. 승인된 최종 배포 설정이 같은 경로인지 유지 확인 |
| 데이터가 일시적으로만 처리되는가? | 아래 수집 항목은 **아니요** | 결정·투표·사용량·Auth 세션 관련 서버 저장이 있음. `store:false` 하나로 전체 데이터를 임시 처리라고 선언하지 않음 |
| 사용자가 데이터 삭제를 요청할 방법이 있는가? | **현재 전체 범위 답변 미확정** | 작성자 결정 삭제는 구현. 투표자 자료·익명 Auth 정보·공급자/로그의 요청 처리 범위를 포함한 공개 삭제 안내와 실행 절차 확정 필요 |
| 앱에서 계정을 생성할 수 있는가? | **입력 초안: 아니요 — 현재 UI에 대한 해석** | 가입·비밀번호·계정 연결·기기 간 복원 기능이 없음. 내부 익명 Auth와 사용자에게 제공하는 계정 생성 기능을 구분. 아래 설명의 적용 범위를 함께 유지 |
| 독립 보안 평가를 받았는가? | **아니요** | 로컬/CI/격리 검증은 MASA 등 외부 공인 평가가 아님 |

Google의 분류를 현재 구현에 적용한 초안입니다. 익명 식별자를 완전 익명 데이터로
취급하지 않고, 핵심 기능에 필요한 같은 데이터 종류는 선택 입력도 포함해 필수로
분류했습니다. 기기 밖으로 보내지 않는 저장 항목은 수집 목록에서 제외했습니다.[G2]

계정 생성 답변과 User IDs 수집 답변은 별개입니다. 공식 FAQ의 app account 정의는
사용자에게 제공하는 계정 기능을 기준으로 합니다. 현재 앱에는 내부 익명 세션만
있으므로 `계정 생성 없음`을 입력 초안으로 제시하되, 모든 익명 ID가 정책상 자동
면제라는 공식 문구가 있다고 주장하지 않습니다. 이후 계정 연결·로그인·복구 기능을
추가하면 재판단합니다. 현재 앱에 회원가입·탈퇴 기능 개발이 반드시 필요하다고
단정하지 않으며, 개별 결정·로컬 자료 삭제와 익명 Auth ID 미삭제를 따로 알립니다.[G3]

### 3.2 현재 코드와 서버 구조로 수집이 확인된 종류

| Google 분류 | 구체 데이터 | 수집 | 필수/선택 | 일시 처리 | 수집 목적 입력 초안 |
| --- | --- | --- | --- | --- | --- |
| Personal info → User IDs | Supabase 익명 사용자 UUID, 인증·세션과 작성자/투표자 연결 | 예 | 필수 | 아니요 | App functionality, Account management, Fraud prevention/security/compliance |
| App activity → Other user-generated content | A/B, 기준이 합쳐진 상황, 신고 설명 | 예 | 필수 | 아니요 | App functionality. 신고/안전 검토 부분에는 Fraud prevention/security/compliance도 적용 |
| App activity → Other actions | 친구 투표, 작성자의 실제 선택, 공유·신고 선택. 후속 보완의 작성자 차단·해제 | 예 | 선택 | 아니요 | App functionality. 신고·차단 부분에는 Fraud prevention/security/compliance |
| App activity → App interactions | 사용자별 일일 결정 사용 횟수·사용일, 신고 한도 기록이 활성화되는 경우 해당 횟수 | 예 | 필수 | 아니요 | App functionality, Fraud prevention/security/compliance |

필수 여부는 화면의 개별 입력란이 아니라 데이터 종류 전체의 이용 방식에 맞췄습니다.
상황·신고 설명을 생략할 수 있어도 AI 결정의 A/B는 필요하므로 사용자 작성 콘텐츠를
통째로 선택 수집으로 표시하지 않습니다. 친구 투표·실제 선택·공유는 AI 결정만
받는 이용자가 생략할 수 있습니다. 사용량 카운터를 사용성 분석 서비스라고
추정하지 않았으며, 현재 근거 없이 Analytics·Advertising/marketing 목적을 추가하지
않습니다. 이 분류는 최종 폼의 구체 정의에 대조할 구현 기반 판단입니다.

### 3.3 공유 답변과 제외 항목

각 종류의 `Shared` 값은 **공급자 처리 조건 확인 전에는 미확정**입니다. 현재 구현에서
Supabase는 인증·저장을 처리하고, OpenAI에는 선택지·상황을 보냅니다. 공급자가
개발자의 지시만으로 처리하는지 확인되면 Google의 service-provider 예외 적용을
검토할 수 있습니다. 친구에게 링크를 보내는 명시적 사용자 동작도 별도 예외 검토
대상입니다. 해당 요건을 확인하지 않고 `공유 없음`을 일괄 선택하지 않습니다.[G2]

| 항목 | 현재 준비한 처리 |
| --- | --- |
| OpenAI로 보내는 값 | 배포된 `vs-decide`는 Responses API에 `{a,b,note}`를 포함한 요청을 보냄. 사용자 UUID·투표자 ID·JWT는 provider 요청에 포함하지 않음 |
| 모델/보관 | `store:false`, `max_output_tokens:400` 확인. 실제 모델은 서버 환경값이므로 미확인. 이 옵션으로 공급자 전체 보관·학습·남용 모니터링 조건이 확정되는 것은 아님 |
| 기본 기준·미전송 초안·회고/만족도 | 앱 내부 localStorage 전용이므로 그 저장 자체를 서버 수집 항목에 넣지 않음. 이후 결정 요청으로 전송한 A/B/기준/상황은 위 수집에 포함 |
| 공유 콘텐츠 정책 동의 | 후속 보완은 기기에 `shared-content-v1` 버전과 동의 여부만 저장. 이 기록에 질문·사용자 ID는 없고 별도 서버 전송도 없음. 저장 거부 시 해당 공유에 명시적으로 받은 동의만 적용 |
| 기록 검색어 | 현재 불러온 목록에서 로컬 필터링. 서버로 보내는 검색 API 없음 |
| 이름·이메일·전화번호 | 별도 가입/수집 필드 없음. 운영자 문의 이메일을 사용자 데이터로 분류하지 않음 |
| 위치·연락처·사진·오디오·파일·달력·건강·결제 정보 | 이 목적의 입력/접근 권한/업로드 흐름 없음. 자유 입력으로 개인정보를 적는 것을 권하지 않으며, 이를 근거로 모든 서버 내용이 무개인정보라고 주장하지 않음 |
| Device or other IDs / Crash logs / Diagnostics | 직접 수집 SDK나 코드 흐름은 확인되지 않음. Supabase·호스팅의 IP/UA/오류·성능 로그 보관과 목적을 확인한 뒤 추가 필요 여부 결정. IP가 있다는 이유만으로 위치 수집으로 단정하지 않음 |

### 3.4 삭제와 보관: 지금 확인된 범위

- 운영 VS 함수 계약과 원본이 일치합니다. 작성자 삭제는 결정과 연결된 투표를 정리하고, 앱은 관련 기기 회고·초안도 삭제하도록 구현되어 있습니다.
- `vs_purge_expired`는 2개월 경과 결정을 정리합니다. 일일 cron은 GMT 18:10, 즉 03:10 KST에 활성화되어 있으며 최근 5회 성공을 확인했습니다. 최신 확인 실행은 2026-11-23 03:10:00 KST입니다. 매일 수행되는 정리이므로 생성 시각의 정확히 두 달 뒤 즉시 삭제된다고 표현하지 않습니다.
- 사용자별·전체 결정 한도 기록은 같은 정리 함수에서 UTC 일자 기준 7일 초과분을 정리합니다.
- 이 함수가 익명 Auth 사용자, 플랫폼 로그·백업, OpenAI 측 자료를 함께 삭제하는 것은 아닙니다. 그 범위의 보관·삭제 절차는 별도 사실 확인이 필요합니다.
- 앱의 `삭제`는 개별 결정 삭제입니다. 계정 전체 삭제가 구현됐다고 입력하지 않습니다. 공개 삭제 경로는 앱명·요청 방법·삭제 대상·보관 예외·처리 절차를 실제 운영에 맞춰 완성해야 합니다.[G3]

## 4. 심사 접근 안내 — 영문 입력용 5세트

심사자에게 제공할 로그인 이름·비밀번호·OTP는 없습니다. 앱이 필요한 순간 익명
세션을 만듭니다. 작성자 전용 기록과 투표 후 결과 표시 조건을 설명하기 위해 아래
지침을 준비했습니다. 제한 접근 여부를 묻는 화면에서는 이 조건을 설명하고 안내를
등록하며, 존재하지 않는 심사 계정이나 비밀번호를 만들지 않습니다. Google은 영문
접근 정보와 재사용 가능한 전체 기능 접근을 요구합니다.[G1][G4]

**사용 조건:** 아래 안내는 운영 AI·신고 RPC, 공개 투표 웹과 후보 호환, 접근 제한이
해결된 제출 후보에 붙입니다. 현재 운영 신고 RPC 부재를 안내문으로 대신 해결했다고
표시하지 않습니다. 제출 시 새 UI가 추가되면 버튼 이름도 갱신합니다.

### 1 — Start and create a decision

```text
No username, password, OTP or payment is required. The app creates an anonymous session. Keep this app's data until review is complete. Enter Tea in A and Coffee in B, then tap 딱 정해줘 (Decide). If 빠른 결정 (Quick mode) is enabled, tap 빠르게 결정하기. The result shows an AI choice and reason. Do not use personal information in test inputs.
```

### 2 — Share and vote with a separate session

```text
In the owner app, tap 친구한테 물어보기. If prompted, read the policy, check 공유 콘텐츠 이용정책을 확인했고 동의해요., and tap 동의하고 공유하기. Copy the link (링크 복사). Open it in a separate browser/private session. Before voting only the question is shown; tap an option to see AI results and totals. Return to the owner app and tap 새로 고침. The owner cannot vote on this decision.
```

### 3 — Report the AI result

```text
Before voting, tap 질문 신고 to report the question; AI 답변 신고 is available after voting or to the owner. Select 다른 문제가 있어요, enter Google Play review - synthetic report, tap 보낼 내용 확인, review, consent and tap 신고 보내기. Confirm the receipt ID. If the result is uncertain, use 같은 신고 다시 보내기. The preview only shows information available in that screen.
```

### 4 — Actual choice and local reflection

```text
In the owner app, select an option under 그래서, 뭘로 했어요? (Actual choice). After saving, the local reflection form appears. Select 만족, 보통 or 아쉬움, enter an optional note, and tap 회고 저장. The actual choice is sent to the server; the reflection stays on this device. Open 결정 기록 보기 to see the record. The guest session cannot access the owner's reflection.
```

### 5 — Drafts, blocks and cleanup

```text
Home drafts restore via 초안 이어쓰기. 안내 보기 / 초안 저장 설정 opens local-data controls. On a shared question, 이 작성자 차단 asks for confirmation and hides that author's questions; 차단 해제하고 보기 restores access after confirmation. About has 작성자 차단 모두 해제. After review, delete only your test decision from 결정 기록 전체 보기 in the owner session. Keep the owner session until cleanup. Contact jmpark0611@gmail.com.
```

### 심사 전 확인할 예상 결과와 실패 구분

| 지점 | 정상 확인 | 정상으로 취급하지 않을 상태 |
| --- | --- | --- |
| 결정 | 서버의 새 결정과 AI 선택·이유가 표시됨 | CORS/서버/인증 오류, `오늘은 여기까지예요`, 전체 사용량 한도 |
| 두 세션 | A는 작성자, B는 별도 브라우저의 투표자. B는 투표 전 AI/집계를 보지 못함 | 같은 웹 저장 공간의 탭 2개만 열어 같은 사용자를 두 명으로 간주 |
| 투표 후 | B에 결과·집계가 보이고 A의 새로 고침에 1표 반영 | 정해 둔 AI 결과나 표 수를 안내문에 보장. AI 선택은 달라질 수 있음 |
| 신고 | 일치하는 서버 접수 번호가 표시됨 | 기능 unavailable 안내, 전송 버튼만 작동, 접수 미확인을 성공으로 판단 |
| 질문 신고·차단 | 투표 전 질문만 미리보기. 차단 중/상태 미확정 때 내용을 숨기고 읽기 재확인 제공 | AI 이유·집계를 미리 노출하거나 차단 응답 미확인을 성공으로 표시 |
| 회고 | A의 실제 선택 저장 후 표시. B에게 보이지 않음 | 회고가 서버/AI/친구에게 동기화된다고 안내 |
| 정리 | 심사자가 만든 결정만 작성자 세션에서 삭제 | 기존 운영 사용자나 다른 결정의 데이터 삭제 |

운영 코드의 사용자별 30회/일·전체 300회/일 결정 한도와 가용성은 심사 접근에도
영향을 줍니다. 심사 중 모든 기능이 접근 가능하도록 운영 준비를 먼저 확인해야
하며, 앱 데이터를 계속 지워 새 익명 사용자를 만드는 우회 방법은 안내하지 않습니다.
이 문서를 만드는 동안 운영 결정을 생성하거나 신고하지 않았습니다.

미확정 신고 중에는 이 화면의 링크·새로고침·투표·차단을 막고, 질문 신고와 AI 신고의
미확정 상태를 각각 유지합니다. OS/브라우저 뒤로가기를 항상 취소하거나 앱 강제종료
후 재시도 정보를 복원하는 기능까지 제공한다고 안내하지 않습니다.

## 5. 운영 읽기 확인과 정확히 남은 실행

2026-11-23 22:01 KST (13:01 UTC) 읽기 감사의 근거는
`qa/operational-readiness-2026-11-23.md/.json`에 기록합니다. 사용자 행·내용 로그를
읽거나 운영 요청을 전송한 검증과 구분합니다.

| 확인 결과 | 제출 준비에 미치는 영향 | 필요한 다음 결과 |
| --- | --- | --- |
| 운영 기본 VS 4개 테이블·9개 함수 계약이 원본과 일치 | 기존 API 계약의 구조 근거 확보 | Android `https://localhost` 원점 허용과 실제 후보/공유 웹 호환 확인 |
| 운영 신고 RPC와 private schema 부재 | 현재 제출 후보의 신고 성공 절차가 운영에서 완성되지 않음 | 검증된 신고 반영안과 운영 확인·처리 절차의 승인된 적용 |
| 배포 Edge의 HTTPS Responses 요청·`store:false`·필드 확인 | 공급자 전송 내용을 구체화 가능 | 계약/설정에 따른 공유 예외, 보관·삭제, 로그 항목 확정 |
| purge cron 활성·최근 성공 확인 | 정기 결정 삭제 실행 미확인 항목은 해소 | Auth·로그·백업 등 다른 데이터의 정책까지 확대하지 않음 |
| 익명 Auth 설정 조회 기능 미제공 | 현재 설정 전체를 확인했다고 표시 불가 | 자동 익명 세션 가용성, 연결 계정 없는 구조와 삭제 범위 확인 |
| 실제 운영 OPTIONS: Android `https://localhost`는 403 / `ORIGIN_DENIED`, 허용 Origin 헤더 없음 | Android의 결정 API 접근이 현재 Origin 단계에서 거절됨 | 승인된 설정 변경으로 기존 허용 원점을 유지하며 `https://localhost` 추가 후 확인 |
| 같은 시각의 기존 웹 Origin은 204 / 정확한 허용 Origin 헤더 | 해당 웹 Origin의 사전 요청 허용만 확인 | POST·익명 세션·AI·공유 투표 성공으로 확대 해석하지 않음 |
| 새 질문 안전 계약: 49개 guard 및 일회용 서버의 실제 HTTP 검증 통과 | 투표 전/후 질문 신고, 중복 요청, 작성자 차단·해제와 권한 경계의 실행 근거 확보 | 운영 적용·신고 검토 절차는 별도 승인 후 진행 |
| Play Console 읽기 접근의 자동 승인 거절 | 실제 Console 항목·계정 요구 사항을 확인하지 못함 | 접근 가능한 승인 경로에서 실제 폼을 확인. 로그인·앱 등록·제출 성공으로 기록하지 않음 |

CORS 근거는 `qa/native-cors-read-2026-11-23.json/.md`,
[run 45183387009](https://github.com/jmpark0611-art/bestchoice/actions/runs/45183387009),
소스 `d9ffb9ad80783e7cec01e6ff8b772e021f91e38d`입니다. 확인 시각은
2026-11-23 22:23:23 KST (13:23:23.788 UTC)이며 고정 OPTIONS 2건만 수행했습니다.
실제 `VS_ALLOWED_ORIGINS` 값 자체는 읽지 않았지만 Android 거부 결과는 확인됐습니다.

새 서버 QA 근거는 `qa/question-safety-http-2026-11-23.json`,
[run 45183793270](https://github.com/jmpark0611-art/bestchoice/actions/runs/45183793270),
소스 `eeb87ed8dd5a05800aba5eb4c49fdc701b64151d`입니다. 2026-11-23 22:26:37 KST
(13:26:37.477 UTC)에 성공 기록을 확인했습니다. 합성 세션 3개·질문 2개로 질문 신고,
AI 비공개 유지, 동시 동일 요청의 단일 접수·한도, 작성자 차단 후 조회·투표 차단,
다른 사용자 비영향, 링크 삭제 후 자기 차단 전체 해제와 private schema/직접 DB 권한
거부를 확인했습니다. 격리 자원·proxy 정리도 확인됐으며 운영·실제 모델은 호출하지
않았습니다. 전체 신고 한도와 차단 수 상한의 경계 HTTP 검사는 이 실행 범위가
아닙니다. 구 API를 쓰는 기존 클라이언트까지 차단 설정이 강제된다고 주장하지
않으며, 새 후보와 공유 웹이 guarded 계약을 함께 사용하도록 맞춰야 합니다.

공개 정책 URL, 데이터 삭제 안내, 신고 운영, 실제 후보의 기기·공유 흐름 및 폰
스크린샷이 준비되면 이 패킷의 미확정 필드만 갱신합니다. 그때에도 Console 저장·
업로드·제출과 운영 변경은 각각 실제 실행한 범위로 기록합니다.

## 6. 사용자 작성 콘텐츠와 AI 신고의 구분

공유된 A/B/상황은 `VoteScreen`에서 다른 사용자에게 표시되므로 Google UGC 정의에
해당하는 것으로 판단합니다. 공개 피드·검색·DM은 없고 링크 소지자에게 열립니다.
이 링크형 서비스가 정책의 `publicly accessible UGC` 세부 사례로 분류되는지는
공식 문서에 직접 설명되어 있지 않습니다. 학교/회사처럼 신원이 확인된 특정 사용자
집단으로 취급할 근거도 없습니다. 따라서 모든 사용자 차단 조건이 이미 확정됐다고
단정하지 않습니다.[G5]

기존 서명 후보의 공백과 이번 후속 로컬 보완:

| 기존 서명 후보의 공백 | 후속 로컬 상태와 남은 실행 |
| --- | --- |
| 공유 전 콘텐츠 이용정책의 명시적 동의 흐름 없음 | `/content-policy`와 첫 공유 전 명시적 동의를 추가. 동의 전 공유 요청을 보내지 않으며, 버전·동의 여부는 기기 저장. 새 서명 후보에 포함 완료 |
| `AI 답변 신고`는 작성자/투표 후 결과에서만 제공 | `질문 신고`와 별도 `vs_report_question` 5인자 호출을 추가. 투표 전/후 제공하고 질문만 미리보기. 기존 AI 신고와 접수증·동일 요청 재시도 유지. 새 RPC의 실제 격리 HTTP 검증 통과, 운영 적용 대기 |
| 다른 작성자의 콘텐츠 숨기기/차단 없음 | 확인 후 차단/해제, 차단 상태 불확실 시 내용 숨김·읽기 복구, About의 전체 해제 UI를 추가. guarded 조회/투표만 사용하며 구 API로 fallback하지 않음. 실제 격리 HTTP 검증 통과, 운영·공유 웹 적용과 새 후보 확인 대기 |
| 신고 운영 RPC·검토 절차가 운영에 없음 | 실제 접수·검토·조치 경로를 활성화한 뒤 완료로 표시. AI 정책상 신고 UI만으로 충분하다고 설명하지 않음 |

위 항목은 후속 로컬 구현과 아직 적용하지 않은 운영 계약을 구분한 기록입니다.
로컬 UI가 있다는 사실만으로 이전 AAB나 운영 서버가 갱신되지는 않습니다. UGC
관리와 AI 생성 결과 신고는 관련되지만 같은 기능으로 자동 충족되는 것은 아닙니다.[G5][G6]

## 7. 사용자에게 남길 결정 한 가지

**누구를 위한 앱으로 출시할지, 실제 목표 연령대를 정해야 합니다.**

사용자가 선택한 대상 연령은 아직 없습니다. 성인만을 위한 앱인지, 청소년도
의도한 대상인지에 따라 표시와 필요한 보호 조치를 맞춰야 합니다. 심사를 쉽게
하려고 연령을 임의로 올리거나, 더 넓게 노출하려고 모든 연령을 고르지 않습니다.[G7]
JSON의 `targetAgeGroups`는 결정 전까지 `null`로 둡니다. 계약·보관·운영 상태는
사용자에게 추측을 요구하는 선택지가 아니라 실제 근거로 확인해 해결할 항목입니다.

## 8. 근거와 갱신 규칙

Google 공식 문서는 2026-11-23에 확인했습니다. 소스 코드에 대한 판단과 Google
정책 문구를 구분했으며, 최종 Console 질문이 달라지면 현재 문항에 다시 대조합니다.

- [G1 — 앱 심사 준비/접근 안내](https://support.google.com/googleplay/android-developer/answer/9859455?hl=en): 공개 정책·광고·접근 안내·최대 5개 지침·등급 항목.
- [G2 — Data safety 작성 기준](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en): 수집/공유, 공급자 예외, 데이터 종류·목적·필수 여부. 표의 선택은 현재 코드에 적용한 판단.
- [G3 — 앱 계정 삭제 요구](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en): 계정 정의와 앱/웹 삭제 경로의 적용 범위.
- [G4 — 심사 로그인 정보 요구](https://support.google.com/googleplay/android-developer/answer/15748846?hl=en): 영문으로 전체 기능 접근을 설명할 기준.
- [G5 — User Generated Content](https://support.google.com/googleplay/android-developer/answer/9876937?hl=en): 부분 사용자에게 보이는 콘텐츠도 포함하는 정의와 동의·관리 요구.
- [G6 — AI-Generated Content](https://support.google.com/googleplay/android-developer/answer/13985936?hl=en): 앱 내부 신고와 신고를 반영한 관리.
- [G7 — 대상 연령 설정](https://support.google.com/googleplay/android-developer/answer/9867159?hl=en): 실제로 설계한 대상에 맞춘 선택.

구현 근거는 `src/lib/api.ts`, `src/lib/supabase.ts`, `src/lib/shareUrl.ts`,
`src/lib/decisionReports.ts`, `src/lib/decisionDrafts.ts`, `src/lib/decisionReflections.ts`,
`src/lib/contentPolicy.ts`, `src/screens/ContentPolicyScreen.tsx`,
`src/screens/{HomeScreen,PollScreen,VoteScreen,HistoryScreen,AboutScreen}.tsx`,
`src/components/{DecisionReport,DecisionReflection}.tsx`, `package.json`, `package-lock.json`,
`android/app/src/main/AndroidManifest.xml`입니다. 이전 후보 식별은
`ANDROID-RELEASE-PROFILE.json`과 전달 확인 기록에 보존하며, 새 후보는 위 확정 소스의
실제 export 결과와 `Genie-Android-1.0.0-1-ugc-verification.json`의 서명 확인 결과에
따라 파일과 해시를 기록합니다.

이 패킷은 새 두 파일의 준비 자료입니다. 이후 승인된 질문 신고·차단 UI 보완에는
관련 50개 집중 검사와 질문 권한 안내 1개 추가 검사를 실행했습니다. 기존 전체
앱 검사 83개를 반복하지 않았습니다. 이 문서는 별도로 완료된 서버 QA·CORS 확인과
새 후보의 빌드·서명 결과를 기록하며, 문서 갱신만을 위해 검증·서명을 반복하지
않았습니다. Console 입력·제출과 운영 설정·데이터 변경은 수행하지 않았습니다.

### 최신 후보의 설치 검증용 파일

새 signed AAB `347b580ca3a3a86c50453e55adb31375b3124cdafe1cd6c790fca7ccb6a7b5c3`에서 QA 서명 APK `8fafa2908355ac1fed1c024ff2908c85e8cd721c9a28667ecf170807874f5cf8`를 생성했습니다. 앱 자산 185개, DEX 1개, baseline profile 2개의 원본 payload 일치와 AAB/APK Manifest·APK v2/v3 서명을 확인했습니다. QA 임시 키는 삭제됐습니다. 업로드키 또는 Play 서명 APK가 아니며 실제 설치·실행·공유·클립보드·스크린샷·운영 검증은 수행하지 않았습니다. 원본 local-signing receipt의 `binaryManifestReparsed:false`는 그대로 보존하고, 이 별도 변환의 재파싱 결과와 구분합니다.
