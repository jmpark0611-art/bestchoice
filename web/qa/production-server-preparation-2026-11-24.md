# 운영 서버 반영 준비 및 실제 결과

**2026년 11월 24일 01:55:47 한국시간 확인: 운영 미반영.**

사용자는 이번 대화에서 운영 서버 반영을 승인했습니다. AI 결과 신고용 첫 마이그레이션을 실제 적용 도구에 요청했지만, 도구가 `aborted by user after 2390.4s`로 종료되었습니다. 성공 응답은 없었으며 같은 쓰기 요청을 다시 보내지 않았습니다. 질문 신고·차단 마이그레이션은 요청하지 않았습니다.

취소 뒤 읽기 전용으로 다시 확인한 결과, 기존 마이그레이션은 7개 그대로이고 두 신규 private schema와 6개 신규 공개 RPC 모두 없습니다. 따라서 이번 작업을 운영 반영이나 출시 완료로 표시하지 않습니다. 정확한 관측값은 [JSON 기록](production-server-preparation-2026-11-24.json)에 있습니다.

## 이번에 완료한 준비

| 항목 | 완료한 내용 |
| --- | --- |
| 운영 기준점 | 기존 VS 테이블·함수 9개와 권한을 이전 검증본과 대조. 새 schema·함수 이름 충돌 없음. 실행 역할 `postgres`, READ COMMITTED, 관련 역할·DB isolation override 없음 확인 |
| 신규 운영 SQL | 기존 AI 결과 신고 및 공유 질문 신고·작성자 차단 proposal에서 파생. 원본 proposal, 기존 함수와 migration은 보존 |
| 실제 migration 파일 | 공식 Supabase CLI 3.2.0으로 격리 폴더에서 `migration new`를 실제 실행. 생성된 이름과 SQL 해시 보관 |
| 트랜잭션 수정 | 운영용 파생본의 최상위 BEGIN/COMMIT 제거. migration runner가 DDL과 이력 기록을 함께 관리하도록 준비 |
| 국소 검증 | 8개 통과. 의존성·이름 충돌 거부, 기존 함수·권한 보존, 정상 적용, 이력 기록 실패 시 신규 객체 전체 rollback 포함 |
| 적용 후 확인 자료 | 신규 함수 13개(공개 6개·내부 7개), private 테이블 7개, RLS·권한·본문 해시를 확인할 읽기 전용 SQL과 기대값 준비. 운영에서 아직 실행하지 않음 |

기존 앱 전체 83개 테스트나 이전 실제 격리 HTTP 검증은 반복하지 않았습니다. 이번 국소 검증은 PGlite이며 운영 적용이나 실기기 검증을 대신하지 않습니다.

## 실제 CLI 생성 파일

파일은 실행 대기 자료인 `supabase/release-prep/cli-generated/`에 보존했습니다. 운영 적용 이력이 아직 없으므로 `supabase/migrations/`의 기존 이력을 임의로 변경하지 않았습니다. 추후 정상 적용 후에는 서버에 실제 기록된 version에 맞춰 최종 경로와 이름을 맞춰야 합니다.

| 파일 | SHA-256 | 운영 상태 |
| --- | --- | --- |
| `20261123161249_genie_result_reporting.sql` | `92d40ba68d582bd442ff8d0b3b7d2b70759a2b7b0bf9c3d5fe8f7ad1516a89b6` | 적용 요청 취소, 신규 객체 없음 확인 |
| `20261123161257_genie_question_safety.sql` | `fc424dadada0dfd074b39dfb12c835adc58ad9880d0637e6370844f4513c9698` | 적용 요청하지 않음 |

Supabase 공식 안내에 따라 파일 내부의 트랜잭션 제어를 제거했습니다. 함수·테이블·제약·RLS·권한 정의는 기존 검증 proposal과 동일합니다. [공식 근거](https://supabase.com/kb/troubleshooting/partial-migrations-and-schema-inconsistencies-from-embedded-transactions-13ae82)

## 남은 두 차단점

1. **운영 migration 적용 요청 취소.** 기존 사용자 승인은 있었으나 실제 요청이 취소로 끝났기 때문에 자동으로 재시도하지 않았습니다. 재개 의사를 확인한 뒤 이력·충돌을 새로 읽고 준비된 첫 migration부터 한 번씩 적용해야 합니다.
2. **Android CORS 관리 화면 로그인 필요.** 연결된 Supabase MCP에는 secret 조회·변경 도구가 없고, 공식 Dashboard는 로그인 화면입니다. 로그인이나 설정 변경은 하지 않았습니다. `VS_ALLOWED_ORIGINS`가 존재하는지와 실제 기존 값을 확인하기 전에는 Android origin을 더할 전체 값을 확정할 수 없습니다. 기존 모든 항목을 보존하고 정확히 `https://localhost`만 추가하는 범위입니다.

기존 OPTIONS 근거에서는 Android가 403이고 기존 웹은 204였습니다. 이번에는 설정을 바꾸지 않았으므로 동일 검사를 반복하지 않았습니다. 설정 적용 뒤에만 두 Origin의 고정 OPTIONS를 확인합니다. [기존 실제 관측](native-cors-read-2026-11-23.md)

## 보존한 출시 후보와 범위

Android 후보 소스는 `5efd0a4fe7f04b38087ecc3de07c1730ce4b0944`, 서명 AAB의 SHA-256은 `347b580ca3a3a86c50453e55adb31375b3124cdafe1cd6c790fca7ccb6a7b5c3`입니다. 앱 코드를 바꾸거나 AAB·ZIP을 다시 만들지 않았습니다.

운영 사용자·질문·투표·신고 데이터 쓰기, 운영 테스트 계정 생성, 모델 호출, 기존 `vs-decide` 덮어쓰기, 웹 배포, 기본 브랜치 병합, 유료 자원 생성, 스토어 제출은 하지 않았습니다. 신고 처리 담당·공개 개인정보 안내·대상 연령과 정확한 Android 후보의 실기기 확인은 별도 출시 조건으로 남습니다.
