# 결정해지니 출시 작업 재개 기록

기준 조회: 2026-11-25T15:04:25Z. 이 문서는 확인 결과와 다음 실행 지점을 기록한다. 운영 반영, 최신 앱 서명, 실물 기기 검증 또는 스토어 제출 완료를 뜻하지 않는다.

## 최신 코드와 Android 후보

- 기능 수정 기준: `91f130abb9eb7e11fc3f1a5643ed889eaec597da` — 기록 삭제의 소유권·동일 세션·삭제 후 부재 확인.
- 이전 문서 HEAD: `2f579a238253832e15bdb0d376aaadd5f99052ee`.
- 새 unsigned export 소스: `c0f3e3423032712caf0fdd806ce94aa1ad48b46e`. 이전 HEAD와 차이는 `.github/workflows/android-release-export.yml`의 후보 근거 주석 1줄이며 앱 실행 코드는 동일하다.
- [네이티브 검사](https://github.com/jmpark0611-art/bestchoice/actions/runs/45554248233), [출시 설정 빌드 검사](https://github.com/jmpark0611-art/bestchoice/actions/runs/45554248205), [격리 기기 검사](https://github.com/jmpark0611-art/bestchoice/actions/runs/45554248232)는 기능 수정 SHA에서 모두 성공했다.
- [새 unsigned export](https://github.com/jmpark0611-art/bestchoice/actions/runs/45624599691): 성공. Job `139241340476`의 잠금 의존성 설치, 4파일 export 생성·검증, artifact 업로드, 원격 식별정보 기록 단계가 모두 성공했다.
- Artifact ID: `15028101833`, 이름: `genie-android-unsigned-45624599691-1`.
- ZIP 크기: `4178238` bytes. GitHub가 제공한 ZIP SHA-256: `6cc7c7037a35338c549ac13ebc7d9acd4e9d7b95ed485179a43a2debd7ca6917`.
- 원격 artifact 만료 예정: `2026-11-26T13:33:51Z`. 이는 unsigned ZIP의 식별정보이며 서명 AAB의 해시가 아니다.
- 최신 서명 완료의 새 근거는 없다. 기존 11/24 서명 후보의 소스 `b8d9db66c249684842971410f2c7b80dd5bec395` 및 AAB SHA-256 `5fbf088745564bbe32343a485a2b316f130ba9668c529a25a48f17f557256e78`는 과거 이력으로 보존한다. 이를 최신 수정본으로 표시하거나 최신 실기기 검증에 쓰지 않는다.

## 운영 서버 관측과 변경 요청

운영 대상은 Supabase `bestchoice`의 서울 프로젝트다. 운영 웹 `https://genie-web-rosy.vercel.app`은 조회 시 기존 커밋 `470dba663677f0df7fbc3c07843b0371758b7f32`의 READY 배포였다. 새 웹 코드를 운영에 반영했다는 근거는 없다.

사전 확인 결과:

- 검토된 SQL 두 파일의 SHA-256과 기존 검증 자료를 대조했다.
- DB 기본/현재 isolation은 READ COMMITTED이며 관련 DB·역할에 isolation override가 없었다.
- 기존 VS 함수 9개의 본문·선언·권한, 기존 테이블 4개의 RLS·권한을 읽기 전용으로 확보했다.
- `genie_reporting_private`, `genie_question_safety_private` 및 신규 public RPC 6개가 없었다.
- 기존 migration history 7개만 확인됐으며 신규 migration 이름은 없었다.

첫 migration `genie_result_reporting` 적용 요청에서 실행 환경 교체로 완료 응답을 받지 못했다. 실제 DB 부재·활성 작업 0을 다시 확인한 뒤 같은 사전 guard가 있는 요청을 한 번 재시도했으나 역시 완료 응답을 받지 못했다. 두 번째 migration은 요청하지 않았다. 이를 SQL 오류나 자동 승인 거절로 단정할 근거는 없다.

마지막 조회 `2026-11-25T15:04:25Z`에도 두 신규 schema 모두 부재, 신규 RPC 목록 빈 배열, 관련 활성 DB 작업 0이었다. 이 관측은 DB 적용이 확인되지 않았다는 근거이며 상위 API 요청의 종료 영수증을 대신하지 않는다. 추가 중복 요청은 중단했다.

재개 시 기존 승인을 다시 요구할 사안이 아니라 실행 경로 복구가 필요하다. 먼저 상위 요청 결과와 실제 migration history·객체를 조정한 후 아래 원문을 순차 적용한다. guard를 제거하거나 IF NOT EXISTS/CREATE OR REPLACE로 바꾸지 않는다.

1. `supabase/release-prep/cli-generated/20261123161249_genie_result_reporting.sql` — SHA-256 `92d40ba68d582bd442ff8d0b3b7d2b70759a2b7b0bf9c3d5fe8f7ad1516a89b6`.
2. 첫 성공 응답과 실제 migration version 확인.
3. `supabase/release-prep/cli-generated/20261123161257_genie_question_safety.sql` — SHA-256 `fc424dadada0dfd074b39dfb12c835adc58ad9880d0637e6370844f4513c9698`.
4. 실제 migration version, private 테이블 7개 RLS·권한, 신규 함수 13개/공개 RPC 6개, 기존 함수 9개 보존, advisors 차이를 확인.

Android CORS는 별도 기존 완료 근거가 있다. 이 작업에서는 CORS, vs-decide, 기존 canonical VS 함수 또는 cron을 재설정하지 않았다.

## 개인정보·삭제 안내

최신 소스의 `/privacy`, `/delete-data`, About 링크와 운영 기준은 이미 통합돼 있다. 옛 legal-integration 패치를 다시 적용하지 않는다.

확정된 사항은 만18세 이상, 문의 담당 박지민, 지원 이메일 jmpark0611@gmail.com, 최초 접수·분류 안내 답변 1영업일 이내 목표, 처리 종료 후 최소 처리표 최대30일 보관이다. 1영업일은 전체 삭제 완료기한이 아니다. Android 첫 버전 무료 다운로드도 승인돼 있다.

정책은 아직 최종 공개본으로 확정되지 않았다. 운영 신고·차단의 실제 반영 결과와 제공자별 처리조건을 맞춰야 한다. 특히 실제 운영 OpenAI 조직·프로젝트의 입력·출력 공유, 보관 통제, 지역 설정은 로그인된 계정에서 확인해야 한다. 코드의 `store:false`만으로 모든 기록의 부재나 국내 처리만을 약속하지 않는다. 기존 토스용 계정 삭제 RPC를 새 앱의 전체 계정 삭제 기능으로 임의 재사용하지 않는다.

## 환경과 다음 실행 지점

- 코드 복구 중 이전 문서 HEAD의 379개 blob을 원격 tree와 대조하여 누락0·SHA불일치0을 확인했다. 그 뒤 실행 환경을 사용할 수 없게 됐다.
- 브라우저 연결도 originating browser context가 없다는 응답으로 계정 설정을 열지 못했다.
- 새 unsigned ZIP은 다운로드 응답을 확보했지만 새 로컬 서명·서명파일 영속 보관 완료를 확인하지 못했다. 서명키는 재생성하거나 공개 저장소/CI artifact에 포함하지 않는다.

실행 환경 복구 후 순서는 ① 위 DB 요청 상태 조정 및 순차 적용·검증 ② 개인정보 실제 설정 확인과 최종 본문·공개 경로 확인 ③ 최종 소스 후보에 기존 업로드키로 서명 및 출처·서명 검증 ④ 실제 Android 설치·운영 흐름 확인 ⑤ Play 등록·심사 제출이다. 실제 폰·Play 완료 증거가 생기기 전에는 해당 단계를 완료로 표시하지 않는다.
