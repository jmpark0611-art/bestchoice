# 결정해지니 운영 읽기 전용 확인 — 2026-11-23

## 결론

운영 **bestchoice** 프로젝트의 기존 결정·공유·투표 DB 계약은 검사한 범위에서 보관된 원본과 차이가 없었습니다. **함수 9개의 본문 MD5와 문자 수가 모두 일치**하고, 4개 테이블의 열·제약·인덱스·RLS·클라이언트 권한이 원본 선언과 맞습니다. **2개월 정리 cron은 활성 상태이며 최근 5회가 성공**했습니다.

운영의 **`public.vs_report_result`와 `genie_reporting_private`는 존재하지 않습니다.** 일회용 격리 서버에서 통과한 신고 제안과 운영 배포 상태는 다릅니다. Android의 `https://localhost` 출처가 실제 CORS 환경 설정에 포함되는지, 실제 모델 이름과 익명 Auth 설정은 이번 읽기로 확인되지 않았습니다.

이 기록은 운영 요청의 종단 간 성공이나 출시 승인을 의미하지 않습니다. 운영 앱 요청·OPTIONS·계정 생성·모델 호출·쓰기·설정 변경을 하지 않았습니다.

## 확인 대상과 근거

| 항목 | 실제 관찰 |
|---|---|
| 프로젝트 | `bestchoice` / `njrtcxohbkfgrgwhlvua` — 운영, 테스트 대상 아님 |
| 프로젝트 상태 | `ACTIVE_HEALTHY`, `ap-northeast-2` |
| DB | PostgreSQL `17.6`, 프로젝트 메타데이터 `17.6.1.166` |
| 관찰 시각 | inventory 2026-11-23 12:58:44 UTC, cron 13:01:03 UTC |
| 기록 준비 시각 | 2026-11-23 13:11:05 UTC |
| 비교한 원본 | `supabase/migrations/20261115000000_vs_polls_and_votes.sql` |
| 원본 Git blob | `c2a91f8f3dfc69598907faf1109fae41be0c638a` |
| 원본 SHA-256 | `a11c228c811cf8f04030a6507755863a4a3c6a771f86caa5268db59c77a136f1` |
| 로컬 HEAD | `8ced932e5454b61b1ff1e17989218e31e4936fbf` |

[같은 이름의 JSON](operational-readiness-2026-11-23.json)에 **실제로 사용한 tool 이름·입력 SQL·안전한 catalog 결과**를 보관했습니다. 질문·선택지·투표·신고·사용자 행 및 행 개수는 조회하지 않았습니다. 키값, 환경변수 값, 원시 Edge 소스, 요청 로그는 파일에 넣지 않았습니다.

## 1. 기존 DB/API 계약

검사한 항목은 4개 테이블, 19개 열, 16개 제약, 7개 인덱스, 1개 RLS 정책, 9개 함수입니다.

| 함수 | 운영 본문 MD5 | 문자 수 | 원본과 비교 |
|---|---|---:|---|
| `vs_claim` | `3e527d77cdd07e6e762c6b629f712dec` | 875 | 일치 |
| `vs_poll_json` | `2c2e689d88599f3103b52955ffdef59e` | 858 | 일치 |
| `vs_my_poll` | `d87800080660ccba2ea8aec692b25820` | 373 | 일치 |
| `vs_share` | `632772f742d01131f718d23d742c705f` | 683 | 일치 |
| `vs_shared_poll` | `5a9cbf86abff3e172d5bad3664fccd1e` | 380 | 일치 |
| `vs_vote` | `af4c5e177c35ad17289a30101ff09d9f` | 909 | 일치 |
| `vs_set_did` | `858627d6a0c120ed2fe7a4d1d8d428b1` | 414 | 일치 |
| `vs_delete_poll` | `62896e04aced60587a083faf82936aa7` | 202 | 일치 |
| `vs_purge_expired` | `ffabf01d1ef16f17ed9b1b19e343a4df` | 258 | 일치 |

원본의 `$function$` 사이 본문을 로컬에서 추출하여 `pg_proc.prosrc`의 MD5 및 문자 수와 비교했습니다. 일치 결과는 이 비교 방법에 대한 증거이며 모든 배포 파일의 독립적인 바이트 동일성 증명은 아닙니다. 함수 인자·반환형·언어·volatility·security-definer·빈 search_path 및 실행 권한도 함께 확인했습니다.

- 4개 테이블 모두 RLS가 켜져 있습니다.
- `authenticated`의 `vs_polls SELECT`만 허용하고, 해당 정책은 현재 사용자 소유 행으로 제한합니다.
- `anon`과 `authenticated`의 직접 INSERT·UPDATE·DELETE·TRUNCATE·REFERENCES·TRIGGER 권한은 모두 거부됩니다.
- 일반 클라이언트에 허용된 RPC는 기존 6개입니다. `vs_claim`, `vs_poll_json`, `vs_purge_expired`는 일반 클라이언트 실행을 허용하지 않습니다.
- 검사한 테이블에는 별도 사용자 정의 trigger 또는 rewrite rule이 없었습니다.
- 공유 조회는 기존 원본대로 투표 전 AI 선택·이유·집계를 숨기고, 작성자 또는 투표한 사용자에게만 이를 반환합니다.

따라서 기존 격리 검증과 운영 DB 정의 사이의 차이 불확실성은 줄었습니다. 실제 PostgREST 설정·Auth 설정·CORS 및 앱 요청 성공을 대신 확인한 것은 아닙니다.

## 2. 보관 기간과 실제 cron

| 항목 | 관찰 |
|---|---|
| 확장 | `pg_cron 1.6.4` |
| 작업 | `vs-purge-expired`, jobid 2 |
| 활성 | `true`; `cron.launch_active_jobs=on` |
| 시간대·스케줄 | `GMT`, `10 18 * * *` — 매일 KST 03:10 |
| 최근 성공 완료 | 2026-11-22 18:10:00.113912 UTC |
| 최근 5회 | 11월 18·19·20·21·22일 모두 `succeeded` |
| 함수 본문 | 보관 원본의 본문 해시·길이와 일치 |

명령의 첫 원문 문자열 비교는 끝 세미콜론을 포함한 비교값과 달라 false였습니다. 후속 검사는 대소문자·공백·선택적인 끝 세미콜론만 정규화하여 **단일 `select public.vs_purge_expired()` 호출과 일치**함을 확인했습니다. 추가 명령을 허용한 비교가 아닙니다.

실제 함수는 작성 시각이 `now() - interval '2 months'`보다 오래된 poll을 지웁니다. 관련 투표는 FK로 함께 삭제합니다. 사용자별·전체 한도 기록은 UTC 기준 날짜가 7일보다 오래된 것을 정리합니다.

여기서 2개월은 **달력상 2개월**이며 하루 한 번 정리됩니다. 정확히 60일 또는 만료 즉시 삭제라고 표시하면 안 됩니다. 이 cron은 `auth.users` 계정을 삭제하지 않습니다. 성공 상태는 작업 완료의 근거이며 실제 사용자 행별 삭제 감사, 백업·플랫폼 로그·AI 제공자 보관 기간의 근거는 아닙니다.

## 3. 배포된 vs-decide 소스

운영에서 읽은 함수는 `ACTIVE`, 버전 2입니다. tool이 제공한 번들 식별 해시는 `bc1be82fc8eba681fc4818f5511e115e259f525b95dbef1b80f794a2c842f5f4`이며 갱신 시각은 2026-11-17T01:59:13.708Z입니다. 원시 소스는 저장하지 않고 다음 사실만 추출했습니다.

| 구분 | 확인된 소스 동작 | 확인하지 못한 부분 |
|---|---|---|
| 제공자 | OpenAI `/v1/responses` | 실제 호출 결과 |
| 모델 | `OPENAI_MODEL` 환경변수 사용, 코드 기본값 없음 | 실제 설정된 모델 이름 |
| 사용자 입력 전송 | `a`, `b`, `note`만 JSON 직렬화 | 입력 자체에 개인정보가 포함되는지는 조회하지 않음 |
| 식별자 전송 | 사용자 UUID·Bearer token·과거 기록을 자동 첨부하지 않음 | 제공자의 전체 처리·보관 정책 |
| 응답 보관 옵션 | `store:false`, `max_output_tokens:400` | 모든 제공자/플랫폼 로그의 보관 여부 |
| 인증 | 코드에서 Bearer token을 `db.auth.getUser`로 검증 | 익명 로그인 활성·복구 설정 |
| DB 저장 | 사용자 ID, 두 선택지, note, AI pick, reason을 `vs_polls`에 저장 | 사용자 행은 조회하지 않음 |
| 명시적 로그 | 고정 성공 event와 모델/promptVersion | 자동 gateway·Auth·플랫폼 로그와 보관 설정 |

Gateway의 `verify_jwt:false`만 보고 무인증 함수라고 판단하지 않았습니다. 소스는 사용자 토큰을 검증한 다음 quota RPC와 모델 호출을 수행합니다. source-matched quota는 UTC 하루 사용자 30건, 전체 300건입니다.

입력 계약은 strict object, 두 선택지 각각 trim 후 1–20자, note 최대 60자, 요청 text 최대 2,000자이며 동일한 두 선택지를 거부합니다. 명시적인 console 로그에 질문·note·답변·사용자 UUID·token을 넣는 코드가 없었습니다. 인식 가능한 raw credential 상수도 발견하지 않았지만 포괄적인 비밀정보 감사라고 주장하지 않습니다.

### Android CORS 확인은 아직 남음

소스의 기본 허용 목록은 localhost 개발 포트 5173·4173과 두 기존 Vercel 주소입니다. **`https://localhost`는 기본 목록에 없습니다.** 다만 `VS_ALLOWED_ORIGINS`가 기본값을 대체하므로, 실제 배포 환경이 Android 출처를 이미 허용하는지는 알 수 없습니다.

소스 분기는 다음 순서입니다.

| 분기/동작 | 소스 행 |
|---|---:|
| 허용되지 않은 Origin 거부 403 | 104 |
| 허용된 OPTIONS 즉시 반환 204 | 105 |
| API key/model 환경 확인 | 108 |
| DB client 생성 | 110 |
| 사용자 토큰 검증 | 115 |
| 한도 RPC | 129 |
| 모델 호출 | 136 |

따라서 소스상 OPTIONS는 Auth·DB·quota·모델보다 먼저 종료됩니다. **이번 확인에서 실제 운영 OPTIONS를 보내지는 않았습니다.** 유효 CORS 설정의 안전한 읽기 또는 별도로 승인한 데이터 없는 preflight가 다음 확인 방법입니다.

## 4. 신고 배포와 남은 조건

운영 catalog에는 `vs_report_result`와 `genie_reporting_private`가 없습니다. 기존 `vs_*` API에도 공유 질문을 신고하는 별도 함수가 없습니다. 운영에서 신고가 접수된다고 안내할 수 없습니다.

기존 신고 SQL 제안 SHA-256 `c81db728edbc2b7584eff86d5aedc79485ba09476d35e06bfb40226d2f82024c`는 [일회용 로컬 Supabase 검증 run](https://github.com/jmpark0611-art/bestchoice/actions/runs/45166205966)에서 실제 Auth·HTTP·권한·동일 요청 2건 병렬 전송·1회 quota·삭제 cascade 및 정리까지 통과했습니다. 이번 작업은 그 검증을 반복하거나 운영에 적용하지 않았습니다.

아직 남은 결정은 다음과 같습니다.

| 조건 | 현재 근거 | 필요한 다음 확인/결정 |
|---|---|---|
| 신고 접수 | 운영 API·private schema 없음 | 필요한 신고 범위를 확정하고 운영 변경은 별도 검토·승인 |
| Android CORS | 소스 기본값에는 Android 출처 없음; 실제 override 미확인 | 유효 설정 읽기 또는 승인된 최소 preflight |
| Auth/Data API | 익명 Auth 설정 getter 없음; 조회한 `pgrst.db_schemas` 설정 null | 권한 있는 설정 화면/API의 읽기 확인 |
| 실제 모델·보관 설명 | 환경변수 선택, `store:false`만 확인 | 비밀 없는 모델 식별자·제공자 처리 사실 확인 |
| 운영 종단 간 동작 | 이번에 실행하지 않음 | 격리/device 증거와 운영 적용 상태를 계속 구분 |

DB 설정의 null 값만으로 Data API가 꺼졌다고 해석하지 않습니다. `auth.users` 행, 사용자 데이터, 키, 환경변수 값, 운영 요청 로그는 읽지 않았습니다.

## 공식 문서와 기록 범위

- [Supabase Cron 문서](https://supabase.com/docs/guides/cron): `cron.job`와 `cron.job_run_details`의 작업·실행 상태를 확인하는 근거.
- [Supabase changelog](https://supabase.com/changelog.md): 현재 변경사항을 확인했으며 업그레이드·설정 변경은 수행하지 않았습니다.
- [기계 판독 JSON](operational-readiness-2026-11-23.json): 정확한 read-only tool 입력과 관찰 결과의 기준 기록.

이 기록으로 앱, 기존 SQL, 운영 설정, 외부 계정, 결제 또는 스토어 상태를 변경하지 않았습니다.
