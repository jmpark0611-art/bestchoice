# Android CORS 운영 설정 반영 및 실제 검증

**결과: Android Origin 차단 해소.** 기존 허용 주소를 보존한 설정 저장과 Android·기존
웹의 고정 OPTIONS 두 건을 확인했습니다. 신고·차단 DB migration 적용, 인증·AI·투표
종단 간 검증, 실물 기기 확인 또는 스토어 출시 완료를 의미하지 않습니다.

## 1. 실제 설정 변경

| 항목 | 관측 결과 |
| --- | --- |
| 프로젝트 | `bestchoice` / `njrtcxohbkfgrgwhlvua` |
| 변경한 설정 | `VS_ALLOWED_ORIGINS` 한 키 신규 생성 |
| 저장 전 상태 | 관리 화면에서 해당 키 없음 확인. 배포 `vs-decide` v2는 이 키의 override 또는 아래 기존 fallback 네 주소 사용 |
| 저장 시각 | 2026-11-24 15:42:26 UTC / **2026-11-25 00:42:26 KST** |
| 추가 항목 | `https://localhost` 한 개 |
| 삭제·wildcard 추가 | 없음 |
| 저장 값 SHA-256 | `85855062cde9af3e59f07176d43f0111f325cf9f5e37f728f7f9f78db4992840` |
| 기존 설정 보존 | 기존 `ALLOWED_ORIGINS`의 digest·수정 시각 동일. 인증 비밀값 변경 없음 |
| 함수 배포 | 기존 `vs-decide` v2 유지, 재배포 없음 |

저장한 정확한 주소 목록은 다음과 같습니다. 앞의 네 주소는 배포 함수의 기존 fallback입니다.

```text
http://localhost:5173
http://localhost:4173
https://genie-web-rosy.vercel.app
https://genie-web-jmpark0611-1816s-projects.vercel.app
https://localhost
```

저장 문자열은 위 순서의 쉼표 구분 UTF-8이며 끝 개행이 없습니다. 입력값으로 계산한
SHA-256이 관리 화면에 표시된 저장 digest와 일치했습니다. 저장된 비밀값 원문을 다시
읽었다고 주장하지 않습니다. 첫 Save는 자동 검토에서 거절됐고, 사용자가 정확한 다섯
주소를 명시적으로 승인한 뒤 Save가 성공했습니다.

## 2. 적용 뒤 실제 고정 OPTIONS 검사

- 확인 시각: **2026-11-25 00:44:19.640 KST** / 2026-11-24T15:44:19.640Z.
- [실행 45183387009, attempt 2, job 138568566856](https://github.com/jmpark0611-art/bestchoice/actions/runs/45183387009/job/138568566856): success.
- endpoint: `https://njrtcxohbkfgrgwhlvua.supabase.co/functions/v1/vs-decide`.
- 기존 고정 검사 workflow를 재실행했습니다. 실행 소스는 `d9ffb9ad80783e7cec01e6ff8b772e021f91e38d`이며 workflow blob은 현재 문서 기준 커밋과 동일한 `258c07030d03f7b4fa0371b87972db07d4e5f532`입니다.

| 요청 Origin | HTTP | Access-Control-Allow-Origin | POST 허용 | 요청한 세 헤더 허용 | 결과 |
| --- | --- | --- | --- | --- | --- |
| `https://localhost` | 204 | `https://localhost` | 예 | 예 | 통과 |
| `https://genie-web-rosy.vercel.app` | 204 | `https://genie-web-rosy.vercel.app` | 예 | 예 | 통과 |

요청한 헤더 이름은 `authorization`, `apikey`, `content-type`입니다. 실제 인증 값이나
본문은 보내지 않았습니다. 요청은 두 OPTIONS뿐이며 전송 실패·실제 POST·운영 데이터
쓰기·모델 호출은 없었습니다. 다른 보존된 세 Origin은 이번에 개별 요청하지 않았습니다.

11월 23일 attempt 1의 Android 403 및 웹 204는 [원래 관측 기록](native-cors-read-2026-11-23.md)에
그대로 보존합니다. 이전 거부 응답을 현재 응답으로 표시하지 않습니다.

## 3. 여전히 남은 출시 조건

DB는 [재개 실행 기록](production-server-resume-2026-11-24.md) 이후 **11월 25일 00:46:39 KST**의
추가 읽기 진단에서도 기존 migration 7개와 두 신규 schema 부재를 확인했습니다.
이전 적용 완료 응답은 유실됐고 현재 catalog는 미적용입니다. 재개 승인은 이미 확보했고,
이번 CORS 작업에서 DB 적용을 새로 시도하지 않았습니다. 이 진단은 이전 요청의 취소
완료나 DB 쓰기 연결 복구를 입증하지 않습니다.

최신 AAB는 `5fbf088745564bbe32343a485a2b316f130ba9668c529a25a48f17f557256e78`,
소스는 `b8d9db66c249684842971410f2c7b80dd5bec395`로 유지됩니다. 앱/ZIP 재생성,
전체 테스트 반복, 실물 기기 설치, 공개 웹 배포, 스토어 제출 또는 유료 자원 생성은
수행하지 않았습니다. 신고 처리 절차와 공개 정책, 실제 운영 흐름과 정확한 후보의
기기 확인은 별도 조건입니다.

현재 CORS 상태는 이 기록과 `ANDROID-RELEASE-READINESS-2026-11-24.json`에 반영합니다.
`ANDROID-RELEASE-PROFILE.json`은 관련 없는 입력 검사·빌드가 다시 실행되지 않도록
이번 문서 변경에 포함하지 않았습니다. 그 파일의 CORS 항목은 이전 시점의 기록입니다.

구조화한 측정값은 [native-cors-applied-2026-11-25.json](native-cors-applied-2026-11-25.json)에 있습니다.
