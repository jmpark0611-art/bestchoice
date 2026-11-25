# 운영 마이그레이션 재개 근거 점검

## 결론

**재개조건 개선 없음.** 신규 적용을 시도하지 않았다. 이전 요청의 완료·취소 또는 변경 요청 경로 복구를 입증하는 새 근거는 이번 읽기 점검에서 발견되지 않았다. 이는 SQL 오류나 자동 승인 거절이 확인됐다는 뜻이 아니다.

## 실제 관측

- DB 관측 시각: **2026-11-25 01:42:11.605901+00 UTC**.
- 정확한 신규 스키마 `genie_reporting_private`, `genie_question_safety_private`는 모두 없음.
- 공개 함수 `vs_report_result`, `vs_report_question`, `vs_set_question_author_block`, `vs_clear_question_author_blocks`, `vs_shared_poll_guarded`, `vs_vote_guarded`는 각 이름의 모든 오버로드가 0개.
- 관련 다른 세션 및 실행 중 세션 0개. 일치 세션의 잠금 대기도 관측되지 않음.
- 활동 추적 켜짐, 전체 통계 열람 권한 있음. SQL 기록 한도는 **1 kB**.
- 이전 진단(2026-11-24 21:24:40.906863+00 UTC)의 객체 부재 상태와 동일.
- 승인된 SQL 두 파일의 바이트 수와 SHA-256은 그대로 유지됨.
- 프로젝트 상태·마이그레이션 이력 조회는 Root가 담당하므로 중복 호출하지 않음.

## 공식 자료의 범위

[공식 상태페이지](https://status.supabase.com/)와 [해당 사건 공지](https://status.supabase.com/incidents/01M85A4AS1YN8A7ZZEFED974TR)는 여전히 11월 13–16일의 API 지연 사건을 Monitoring으로 표시했다. 공지는 이번 11월 24일 요청의 완료·취소나 실행 호스트 교체 문제의 복구를 설명하지 않는다.

[공식 MCP 안내](https://supabase.com/docs/guides/ai-tools/mcp)는 마이그레이션 도구와 조건부 SQL 확인 절차를 설명한다. 일반 절차가 존재한다는 사실로 이 연결이 현재 확인창을 기다린다거나 그것이 중단 원인이라고 추정하지 않았다. 설정 변경이나 확인 절차 우회도 하지 않았다.

## 남은 불확실성

현재 DB 객체 부재와 관련 세션 0개는 관측 시점의 상태다. 이전 상위 API 요청이 완전히 종료됐거나 앞으로 시작할 수 없다는 보증은 아니다. 새 직접 근거를 확보하기 위해 같은 실패를 재현하거나 운영 쓰기를 시도하지 않았다.

이번에는 카탈로그 SELECT 1회만 수행했다. 사용자 행·운영 사용자·로그 원문·인증정보·키를 읽지 않았고, 로그·Advisors·전체 preflight·기존 테스트를 다시 실행하지 않았다. 세부 메타데이터와 정확한 조회문은 [migration-readiness.json](migration-readiness.json)에 있다.

