# Bestchoice 앱인토스 출시 체크리스트

기준일: 2026-09-29. 공식 개발자센터 기준으로 Apps in Toss는 빌드 결과물을 토스 CDN에 업로드하여 앱 내부 WebView에서 실행한다. 번들 검수는 운영·디자인·기능·보안 단계로 진행된다.

> **2026-09-29 갱신:** Codex에서 만든 앱 소스를 찾을 수 없어 Claude가 `app/`에 새로 만들었다. 아래 "현재 완료"는 원래 Codex 기준 기록이며,
> 재구축 앱의 실제 상태는 `AGENTS.md` 1·3장을 따른다. (테스트 35개, `.ait` 빌드 성공, 실기기 미검증)

## 현재 완료

- 콘솔 미니앱 등록 및 appName `Bestchoice` 확인
- Web Framework SDK 3.x, TDS, 뒤로가기/홈 동작 코드 적용
- Supabase 사용자별 저장, RLS, 쓰기 RPC, 익명 인증 원격 검증
- AI 질문 3개·6축 결과 계약, 중복 요청 방지, Edge Function 배포
- 비로그인 AI 요청 HTTP 401 차단 및 서버 전용 DB 함수 권한 확인
- 웹 빌드와 `Bestchoice.ait` 생성
- 홈 최근 결정 최대 3개 표시
- 운영자 `에스케이컴퍼니`(대표 박지민), 공개 문의 이메일 `jmpark0611@gmail.com` 확정 및 문의 화면 반영

## 출시 전 필수

- [ ] OpenAI API 충전 후 실제 질문 생성→3답변→6축 분석→실제 선택 저장 전체 흐름 검증. 이 단계 직전에 사용자에게 충전을 다시 안내한다.
- [ ] 실제 호출 성공 뒤 `.env`의 `VITE_ENABLE_AI=true` 적용 및 새 `Bestchoice.ait` 생성
- [ ] 토스 샌드박스/실기기에서 Android·iOS 뒤로가기, 홈, 안전영역, 키보드, 긴 텍스트, 네트워크 끊김 확인
- [ ] 실제 Toss WebView 요청의 `Origin`을 네트워크 로그에서 확인한 뒤 Supabase `ALLOWED_ORIGINS`에 정확히 등록. 추측한 도메인은 등록하지 않는다.
- [ ] 확정된 운영자명·문의 이메일을 바탕으로 보관기간, 국외 이전/처리위탁 내용을 확정하여 개인정보처리방침·이용약관·AI 안내의 임시 문구 교체
- [ ] 계정/모든 데이터 삭제 정책과 사용자 문의 대응 절차 확정
- [ ] OpenAI 프로젝트 지출 한도·알림과 API 키 교체 일정을 설정
- [ ] 초기 JS 약 1.67MB(gzip 약 518KB) 실기기 성능 확인 및 필요 시 코드 분할
- [ ] 콘솔에 새 `.ait` 업로드 후 운영·디자인·기능·보안 검수 요청

## 콘솔 주요 기능 등록안

최초 번들 검토 요청 때 주요 기능을 최소 1개 등록한다.

| 표시 문구 | 피처 주소 | 목적 |
|---|---|---|
| 고민 판단하기 | `intoss://Bestchoice/input` | 홈을 거치지 않고 고민 입력으로 진입 |
| 내 결정 기록 확인하기 | `intoss://Bestchoice/history` | 저장된 분석·선택 기록 확인 |

주요 기능 문구는 기능이 드러나는 `~하기` 형태로 작성하고, 등록 후 각 딥링크가 실제 경로를 여는지 샌드박스에서 확인한다.

## 현재 차단 사항

- OpenAI API 잔액 0달러로 실제 호출이 HTTP 429를 반환한다. 사용자 결정에 따라 실제 분석 테스트 시점까지 충전과 유료 호출을 보류한다.
- AI가 비활성인 현재 번들은 출시 후보가 아니다. 가짜 결과는 제공하지 않는다.
- 정책 화면이 임시 문구이므로 정식 검수 요청 전에 운영 정보를 받아 완성해야 한다.

공식 참고:

- https://developers-apps-in-toss.toss.im/
- https://developers-apps-in-toss.toss.im/development/test/function.md
- https://developers-apps-in-toss.toss.im/intro/guide.md
