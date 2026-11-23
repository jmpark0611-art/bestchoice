# Android 운영 CORS 관찰 — 2026-11-23

## 확인 결과

**Android의 `https://localhost` 출처는 운영 `vs-decide`에서 거부됐습니다.** 같은 검사에서 기존 웹 출처 `https://genie-web-rosy.vercel.app`는 허용됐습니다. 이전 운영 감사의 CORS 미확인 항목을 더 늦은 시각의 관찰로 보완하는 별도 기록이며, 이전 감사 원문은 변경하지 않았습니다.

| 관찰 항목 | Android | 기존 웹 |
|---|---|---|
| 요청 Origin | `https://localhost` | `https://genie-web-rosy.vercel.app` |
| HTTP 상태 | **403** | **204** |
| Access-Control-Allow-Origin | 없음 | 요청 Origin과 정확히 일치 |
| POST 허용 헤더 표시 | true | true |
| 요청한 헤더 3개 허용 표시 | true | true |
| 인식된 고정 오류 | `ORIGIN_DENIED` | 없음 |
| preflight 허용 판정 | **false** | **true** |

Android 응답에 POST와 헤더 이름을 허용하는 값이 있더라도, Origin을 허용하지 않고 403을 반환하므로 preflight는 통과하지 않습니다. 이는 현재 Android 요청 경로의 구체적인 서버 설정 차단입니다.

## 실행 근거

- [GitHub Actions run 45183387009](https://github.com/jmpark0611-art/bestchoice/actions/runs/45183387009)
- [job 137722656206](https://github.com/jmpark0611-art/bestchoice/actions/runs/45183387009/job/137722656206)
- 실행 소스: `d9ffb9ad80783e7cec01e6ff8b772e021f91e38d`
- workflow: `.github/workflows/genie-native-cors-read.yml`
- receipt marker: `GENIE_NATIVE_CORS_READ`
- 확인 시각: **2026-11-23T13:23:23.788Z**
- 운영 대상: `bestchoice` / `njrtcxohbkfgrgwhlvua`
- endpoint: `https://njrtcxohbkfgrgwhlvua.supabase.co/functions/v1/vs-decide`

위 결과는 root가 해당 실행에서 확인하여 전달한 정확한 receipt 값입니다. 이 문서 작업은 로컬 workflow의 요청·출력 필터 소스를 읽었고, 운영 요청을 반복하거나 원시 로그를 다시 수집하지 않았습니다. [기계 판독 JSON](native-cors-read-2026-11-23.json)에 실행 식별자, 요청 정의, receipt 필드와 해석 범위를 함께 보관했습니다.

## 보낸 요청과 관찰 범위

고정한 두 Origin으로 **OPTIONS 2건만** 보냈습니다. 요청은 `Access-Control-Request-Method: POST`와 `Access-Control-Request-Headers: authorization,apikey,content-type`를 사용했습니다. 여기에는 헤더 **이름만** 있으며 실제 Authorization·apikey 값은 보내지 않았습니다. 본문은 없고 redirect를 따라가지 않으며 각 요청 제한 시간은 15초였습니다.

출력은 상태, 요청 Origin과의 일치/미존재 여부, POST·필요 헤더 허용 여부, 고정 오류 `ORIGIN_DENIED`로 제한했습니다. 403 응답은 오류 판별을 위해 한 번 읽은 1,024bytes 이하 조각만 해석하고 원시 본문은 기록하지 않습니다.

앞서 읽은 배포 소스에서 Origin 거부는 104행, 허용된 OPTIONS 반환은 105행이며 DB client 생성·Auth 확인·quota RPC·모델 호출보다 먼저 종료됩니다. 이번 요청은 사용자나 결정을 생성하지 않았고 POST·DB 쓰기·모델 호출을 수행하지 않았습니다. 플랫폼의 일반 접근 로그까지 전혀 남지 않았다는 주장은 하지 않습니다.

## 이 결과로 확인하지 않은 것

- 실제 결정 POST, Auth 로그인, 모델 응답, 공유·투표·신고·삭제 성공.
- 실제 Android WebView나 물리 기기의 종단 간 요청 성공.
- 두 출처 외 모든 Origin 또는 요청한 세 개 외 SDK 헤더의 허용 여부.
- `VS_ALLOWED_ORIGINS`의 실제 전체 값, 기본값과 환경 override 중 어느 것이 적용됐는지.
- 사용자 행·질문·투표·신고·키값·환경값 또는 원시 요청 로그.

기존 웹의 204는 정확히 해당 preflight의 성공이며 웹 전체 정상 동작을 의미하지 않습니다. 이 결과는 관찰 시점 기준으로, 이후 설정·함수가 변경되면 그대로 연장할 수 없습니다.

## 다음 변경안

승인된 비공개 설정 경로에서 **현재 유효한 `VS_ALLOWED_ORIGINS` 항목을 먼저 확인**하고, 기존 항목을 모두 유지하면서 `https://localhost` 한 항목만 추가해야 합니다. 현재 값을 읽지 못하면 소스 기본값이나 이번 두 응답으로 전체 목록을 추정하여 덮어쓰지 않습니다.

구체적인 변경·적용 전 조건·웹/Android 호환·역순 복구 조건은 [ANDROID-SERVER-CHANGES-PENDING.md](../ANDROID-SERVER-CHANGES-PENDING.md)에 정리했습니다. 이번 작업에서는 운영 설정·함수·DB·기존 SQL·원격 commit을 변경하지 않았습니다.

기존 근거: [운영 읽기 감사](operational-readiness-2026-11-23.md), [운영 감사 JSON](operational-readiness-2026-11-23.json).
