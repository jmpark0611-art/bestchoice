# 조사 보고서: AI 분석 결과 이미지 공유 기능 (결정해지니Genie)

- 작성: 2026-10-28, Claude (조사만 함. 코드 수정·배포·DB 변경 없음)
- 저장소: `jmpark0611-art/bestchoice`, 브랜치 `claude/bestchoice-miniapp-dev-ar5jtm`
- 대상: 토스 앱인토스에 출시된 웹 미니앱 "결정해지니Genie"(구 결정해줘). appName `bestchoice`
- 목적: 기존 운영 서비스에 "AI 분석 결과를 이미지로 저장·공유" 기능을 추가하기 전, 구조와 공식 API를 확인하고 최소 변경안을 정리

## 결론 요약

- 토스 SDK에는 **"이미지를 첨부해 공유하는" 전용 API가 없다.**
- 결과 카드를 **기기 안에서 Canvas로 이미지(base64)로 만든 뒤 `File.saveBase64`로 넘기면**, OS 저장·공유 시트가 떠서 사용자가 사진 저장이나 카카오톡 전송을 고를 수 있다(커뮤니티 답변 기준).
- 결과 화면에 버튼 하나 + 새 파일 2개 정도로 구현 가능하며, **DB·AI 서버·권한 설정·정책 문서는 바꾸지 않아도 된다.**

---

## 1. 프레임워크와 기술 스택

| 영역 | 내용 |
|---|---|
| 앱 | React 18.3.1, TypeScript 5.9, Vite 6.4.3, react-router-dom 7.18.4, zod 3 |
| UI | `@toss/tds-mobile` / `@toss/tds-mobile-ait` 2.5.1, 제목 글꼴 주아(`@fontsource/jua`, woff2를 번들에 포함) |
| 서버 | Supabase(서울 리전): 익명 로그인, RLS, SECURITY DEFINER RPC 함수. Edge Function `decision-ai`가 OpenAI(`gpt-4.1-mini`, Responses API)를 호출 |
| 테스트 | vitest + jsdom + Testing Library, 테스트 56개 |
| 앱 위치 | 저장소의 `app/` 폴더 |

## 2. 앱인토스 SDK와 버전 (package-lock.json 기준)

- `@apps-in-toss/web-framework` **3.6.0** (웹 방식 미니앱)
- `@apps-in-toss/cli` 3.6.0, `@apps-in-toss/devtools` 3.6.0
- 설정 파일 `app/apps-in-toss.config.ts`: `appName: 'bestchoice'`, `brand.primaryColor`, `permissions: []`, `webBundleDir: 'dist'`
  - web-framework 설정 타입에는 표시 이름(displayName) 항목이 없음. 토스 상단 바의 앱 이름은 콘솔 등록 이름을 씀
- 현재 사용 중인 SDK 기능
  - `graniteEvent`(시스템 뒤로가기), `Screen.close`
  - `Analytics.log` 이벤트: `decision_submitted`, `result_viewed`(콘솔 대표 전환 지표), `actual_choice_saved`, `ad_reward_earned`
  - `Review.request`(첫 실제 선택 기록 후 1회)
  - `loadFullScreenAd` / `showFullScreenAd`(보상형 광고, 광고 그룹 ID가 없으면 꺼짐. 아직 미사용)

## 3. AI 분석 결과 상세 화면 파일

| 파일 | 역할 |
|---|---|
| `app/src/screens/DecisionScreen.tsx` | 라우트 `/decision/:id`. 상태(`viewFor`)에 따라 질문 / 분석 중 / 결과 / 위기 안내 화면 선택. 결과를 보면 `result_viewed` 1회 기록, 실제 선택 저장(`saveChoice`), 리뷰 요청 |
| `app/src/components/ResultView.tsx` | `ResultView`(결론·근거·48시간 할 일·6가지 기준 막대·접는 상세), `ActualChoiceForm`(실제 선택 기록), `CrisisView`(위기 안내) |
| `app/src/lib/contract.ts` | 결과 데이터 스키마 `analysisSchema`, 표시 이름 `AXIS_LABELS` / `CONFIDENCE_LABELS` / `recommendationLabel` |
| `app/src/App.tsx` | 라우트: `/`, `/input`, `/history`, `/decision/:id`, `/settings`, `/policy/:doc` |

결과 데이터(`Analysis`) 주요 필드: `summary`, `recommendation{optionId,label,rationale}`, `confidence`, `confidenceReason`, `axes[6]{key,score 1~5,rationale,uncertainty}`, `missedFactors[]`, `nextAction{text,timeframeHours}`, `switchConditions[]`, `disclaimer`.

## 4. 분석 결과 저장·조회·삭제 구현 위치

- **저장**: 앱이 아니라 Edge Function `supabase/functions/decision-ai/index.ts`(배포 v10)가 AI 응답을 검증한 뒤 RPC `bc_finish_ai`로 `bc_decision_results.result_json`에 저장. 앱이 직접 저장하는 것은 실제 선택뿐(`app/src/lib/api.ts` → `saveActualChoice` → RPC `bc_save_actual_choice`)
- **조회** (`app/src/lib/api.ts`)
  - `getDecision(id)`: `bc_decisions` + `bc_actual_choices` + `bc_decision_results`를 한 번에 조회 후 zod로 검증
  - `listDecisions(limit)`: 홈(최근 3개)·기록 화면 목록
- **삭제** (`app/src/lib/api.ts`)
  - `deleteAllDecisions()` → RPC `bc_delete_my_decisions` (기록 화면, 설정 화면에서 사용)
  - `deleteAccount()` → RPC `bc_delete_account` (설정 화면)
  - `deleteDecision(id)` → RPC `bc_delete_decision`: 함수는 있으나 **화면에서 쓰는 곳 없음**
- **자동 삭제**: pg_cron `bc-purge-expired`가 매일 03:00(KST)에 작성 후 2개월 지난 기록 삭제(`bc_purge_expired`, `supabase/migrations/20260929093527_bc_retention_and_account_delete.sql`)
- 스키마: `supabase/migrations/20260927110000_bc_ai_decision_schema.sql` (`bc_decision_results`는 `bc_decisions` 삭제 시 함께 삭제, RLS 켜짐)

## 5. 현재 배포·빌드 방식

1. `cd app && npm run build:release`
   - `npm run verify`(테스트 + 타입 검사)
   - `scripts/preflight-release.mjs`: Supabase 주소·publishable 키, `VITE_ENABLE_AI=true`, 정책 시행일 형식, 광고 그룹 ID 유무와 약관의 보상형 광고 조항 일치 여부 검사
   - `vite build` → `ait build` → `app/bestchoice.ait` 생성
2. `.ait` 파일을 **앱인토스 콘솔 "앱 출시"에 수동 업로드** → 샌드박스 테스트 → 검토 요청(영업일 3~7일) → 승인 후 출시. `npm run deploy`(`ait deploy`) 스크립트는 있으나 사용한 적 없음
3. DB 마이그레이션과 Edge Function 배포는 앱 배포와 별개로 Supabase에 직접 적용
4. `.env`, `.ait`는 커밋 금지(`.gitignore`). 환경 변수: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_ENABLE_AI`, `VITE_AD_GROUP_REWARDED`
5. 마지막 기록(10/17): `genie-20261017-v2.ait`(앱 이름·상호 정정, UI 개편) 검토 대기. 실제 출시 버전은 콘솔에서 확인 필요

## 6. 이미지 생성·저장·공유 공식 API와 호환성 (SDK 3.6.0 타입 정의 + 공식 문서 + 커뮤니티)

| 하고 싶은 것 | API | 비고 |
|---|---|---|
| 이미지 만들기 | **SDK에 없음** → 브라우저 표준 Canvas 2D (`canvas.toDataURL`) | 아이폰·안드로이드 WebView 모두 지원 |
| 기기에 저장 | **`File.saveBase64({ data, fileName, mimeType })`**, `File.saveBase64.isSupported()` | 토스 앱 Android 5.218.0 / iOS 5.216.0 이상. `fileName`에 확장자 필수, 반환값 없음. 공식 문서상 이미지·텍스트·PDF 지원 |
| 이미지 첨부 공유 | **전용 API 없음** | 커뮤니티 답변: `saveBase64`는 갤러리 직접 저장이 아니라 **OS 공유·저장 시트**를 띄움 → 사용자가 사진 저장/카톡 전송 선택 가능 |
| 링크 공유 | `Share.createLink({ path: 'intoss://bestchoice/...', ogImageUrl? })` → `Share.sendMessage({ message })` | `sendMessage`는 **텍스트만**. `ogImageUrl`은 https 절대 주소 이미지, 토스 앱 Android 5.240.0 / iOS 5.239.0 이상에서만 표시 |
| 표준 Web Share `navigator.share({ files })` | **동작 여부 확인 안 됨** | 커뮤니티에 질문만 있고 답변 없음 → 사용하지 않는 것이 안전 |

호환성 주의
- 커뮤니티 보고(Android, SDK 3.5.0): **GIF 저장은 UNKNOWN_ERROR, JPG는 정상**. PNG는 확인되지 않음 → 1차는 JPEG, PNG는 샌드박스에서 확인 후 사용
- 사용 중지 예정 이름: `saveBase64Data`, `getTossShareLink`, `share` → 3.x 이름 `File.saveBase64`, `Share.createLink`, `Share.sendMessage` 사용
- 저장 시 사진 권한(`photos` write) 요청이 필요한지는 문서에 명시 없음. 시트 방식이라 불필요할 가능성이 크지만 실기기 확인 필요. 현재 `permissions: []` (권한 추가 시 검토 항목 증가)

## 7. 기존 기능을 손상시키지 않는 최소 변경안 (권장)

원칙: 새 파일 위주, 기존 파일은 버튼을 끼우는 몇 줄만. **DB·Edge Function·권한 설정·정책 문서 변경 없음.**

| # | 변경 | 파일 |
|---|---|---|
| 1 | 결과 카드 이미지 생성기(신규). Canvas 2D로 1080×1350 카드를 그려 base64 JPEG 반환. `document.fonts.load('… Jua')`로 글꼴을 먼저 불러온 뒤 그림. 외부 라이브러리 추가 없음 | `app/src/lib/resultImage.ts` |
| 2 | 저장·공유 버튼(신규). `File.saveBase64.isSupported()`가 false면 버튼 숨김(구버전 토스 앱·브라우저). 실패 시 토스트 안내만, 화면 상태는 유지 | `app/src/components/ShareResultButton.tsx` |
| 3 | 결과 화면 연결: `view === 'result'`일 때 실제 선택 폼 위에 버튼 한 줄 추가. 위기 안내(crisis)에는 표시 안 함 | `app/src/screens/DecisionScreen.tsx` |
| 4 | 이벤트 `result_image_saved` 추가 | `app/src/lib/analytics.ts` |
| 5 | 테스트: 카드 데이터 구성, 미지원 환경에서 버튼 숨김, 저장 실패 처리(Canvas는 mock) | 신규 테스트 2개 |

이미지에 넣을 내용
- 넣음: 앱 이름, "결정했어요", 추천안, 판단 강도, 6가지 기준 막대, 날짜
- **넣지 않음: 고민 원문, 메모**(민감 정보 가능성, 타인에게 보내는 이미지)

1차에서 일부러 하지 않는 것
- 서버에 이미지 업로드(링크 미리보기 `ogImageUrl`용): Supabase Storage 설정, 개인정보처리방침 수정, 보관 정책이 필요해짐 → 필요하면 2차. 이미지를 기기 안에서만 만들면 개인정보처리방침에 추가할 내용 없음
- 링크 공유(`Share.createLink` + `Share.sendMessage`)는 텍스트라 쉽게 추가 가능 → 같이 넣을지 선택

진행 순서 제안
1. 현재 검토 중인 버전이 출시된 뒤, 광고 버전과 같은 다음 버전에 묶어서 반영(검토 1회)
2. 샌드박스 실기기 확인(아이폰·안드로이드 각 1대): 저장·공유 시트 표시, JPEG 저장, 카톡 전송 시 이미지 정상, 주아 글꼴이 이미지에 들어가는지
3. 앱 안 이름이 콘솔 이름(결정해지니Genie)과 같은지 확인 후 검토 요청

## 확인되지 않은 점 / 위험

- 개발 환경에 WebKit(아이폰 엔진)이 없어 아이폰 동작은 샌드박스 실기기로만 확인 가능
- `saveBase64`가 OS 시트로 뜬다는 것은 커뮤니티 답변이며 공식 문서에는 명시 없음. 최신 SDK에서 달라졌을 수 있음
- `navigator.share({ files })` 동작 여부 미확인

## 참고 자료

- File.saveBase64 (공식): https://developers-apps-in-toss.toss.im/documentation/api-and-sdk-en/sdk/domains-api/file/file.savebase64
- Save File (공식): https://developers-apps-in-toss.toss.im/documentation/api-and-sdk-en/common/file-storage/file
- 미니앱 공유 링크 (공식): https://developers-apps-in-toss.toss.im/documentation/common/growth/share/miniapp-share-link
- SDK v3 변경 사항 (공식): https://developers-apps-in-toss.toss.im/documentation/api-and-sdk-en/sdk/v3
- 커뮤니티: saveBase64Data가 OS 공유 시트로 표시: https://techchat-apps-in-toss.toss.im/t/savebase64data-os/2156
- 커뮤니티: File.saveBase64 안드로이드 공유/저장 시트: https://techchat-apps-in-toss.toss.im/t/file-savebase64/4677
- 커뮤니티: 결과 이미지 저장 및 이미지 포함 공유 방법: https://techchat-apps-in-toss.toss.im/t/topic/4969
- 커뮤니티: 이미지파일 공유 문의: https://techchat-apps-in-toss.toss.im/t/topic/3917
- 커뮤니티: 이미지 저장 가능 여부: https://techchat-apps-in-toss.toss.im/t/topic/3629
- 커뮤니티: Android SDK 3.5.0 GIF 저장 오류(JPG 정상): https://techchat-apps-in-toss.toss.im/t/android-sdk-3-5-0-file-savebase64-gif-unknown-error-jpg/5043
- 커뮤니티: 파일 저장하기 버그: https://techchat-apps-in-toss.toss.im/t/topic/686
- 커뮤니티: 파일 저장하기 기능 문의: https://techchat-apps-in-toss.toss.im/t/topic/2680
