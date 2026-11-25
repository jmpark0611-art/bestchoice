# 개인정보·삭제 안내의 실제 소스 통합

기준일: **2026-11-25, 한국 시간**. 준비 브랜치: `codex/genie-android-native-check-20261123`.

## 운영 문구 정합화 — 2026-11-25 후속 작업

운영 세 항목이 승인된 준비본 `e521357baf68fc0448ce2739acd7ce9b14341d1a`를 기준으로 앱 공통 본문과 두 HTML 검토본을 맞췄다. **박지민 문의 담당, 최초 답변 1영업일 목표, 종료 후 최소 처리표 최대 30일·불필요 시 조기 정리**를 같은 의미로 반영했다. 문의 원문·민감 첨부와 최소 처리표를 구분한다.

변경된 앱 코드는 `web/src/legal/legalContent.ts`의 본문뿐이다. 스타일·경로·컴포넌트·메일 링크·API·권한은 그대로다. 법정 개인정보 보호책임자 직위, 영업일 달력·운영시간, 시행일·공개 주소, 실제 문의 운영과 전체 인증·로그·백업 삭제는 이 승인으로 확정하지 않는다.

**새 본문 소스 `bd9667cd61f04d8bbfc72d13d5d7263095df50a5`의 자동 검사 세 개가 모두 attempt 1로 성공했다.** 2026-11-25 12:57 KST에 완료 상태와 실행별 소스 일치를 확인했다. 기존 83개 전체 검사나 같은 설치 실패를 반복하지 않았다.

| 이번 소스의 실제 실행 | 확인 결과 |
| --- | --- |
| [합성 native 빌드 45542787531](https://github.com/jmpark0611-art/bestchoice/actions/runs/45542787531/job/138965067221) | 성공. Manifest·assets·임시 서명 확인 후 키와 AAB 삭제 |
| [공개 설정 미서명 빌드 45542787552](https://github.com/jmpark0611-art/bestchoice/actions/runs/45542787552/job/138965067167) | 성공. 정적 공개 설정 fingerprint, sourceSnapshot·Manifest·assets 확인 후 미서명 출력 삭제 |
| [격리 가상기기 45542787577](https://github.com/jmpark0611-art/bestchoice/actions/runs/45542787577/job/138965067188) | 성공. 지정 여섯 케이스, 새 문구를 포함한 두 문서의 실제 이동·뒤로가기·320px·다크 모드 통과 |

두 문서 모두 화면 폭·스크롤 폭 320px, 가로로 벗어난 조작 요소 0개, 관련 링크 최소 높이 58px였다. 제목 포커스와 DOM 이메일 선택 상태를 확인했고 원래 night 모드를 복원했다. **실물 기기·정식 서명 후보·운영 서버·외부 메일 앱·클립보드 권한 검증은 아니다.** Node 24.22.3 결과이며 Node 22를 실행하지 않았다.

전체 빌드 입력 162개 중 `src/legal/legalContent.ts`만 달라졌다. 새 [입력 목록](../release-prep/launch-continuation/policy-source-snapshot.json)의 SHA-256은 `d8fa49d8a1013f5f163442d901cde584e82a3b6f6a6b47df30b5ee3b8ff20e26`이다. [이번 통합 기록](../release-prep/launch-continuation/policy-alignment-commit-receipt.json)은 변경 대상 외 기존 355개 blob 보존과 준비 브랜치만 갱신한 사실을 기록한다. 전후 브랜치의 웹 배포는 모두 0건이었다.

실제 [빌드 근거](../release-prep/launch-continuation/policy-ci-build-results.json)와 [기기 근거](../release-prep/launch-continuation/policy-ci-device-results.json)를 별도로 보관했다. 아래 11:17 KST 기록과 원래 `66010c2…`의 receipt는 당시 소스의 증거로 그대로 보존한다.

[Play Console 실제 관측](../release-prep/launch-continuation/play-console-readiness-2026-11-25.md)에서는 기존 개발자 계정에 인증된 접근이 가능했다. 기존 앱 2개 목록과 `com.jmpark0611.genie` 검색에 대상 앱이 없어, 신규 등록과 앱별 버전·서명 확인이 남는다. 계정 변경·앱 생성·업로드·제출은 수행하지 않았다.

[12:38 KST 서버 한정 조회](../release-prep/launch-continuation/server-readiness-20261125T033830Z.md)에서는 신규 두 스키마와 여섯 함수가 계속 없었다. 마이그레이션 7건이 그대로이며, 이전 변경 요청의 완료 경로가 복구됐다는 새 근거는 없었다. 같은 적용은 재요청하지 않았다.

## 최초 소스 통합과 검증 — 11:17 KST 기록


HEAD `818655e10fe00b65da8bfe64f77e0d928429eb9d`의 정확한 소스를 바탕으로 기존 검증된 여섯 파일을 실제 앱 소스에 통합했습니다. 실제 코드 커밋은 **`66010c2eca8aca06e22b4feaafaa098df2916f70`**입니다. `/about`에서 `/privacy`, `/delete-data`를 열고 돌아올 수 있습니다. 본문은 앱에 포함되어 안내 열기 자체에는 인증이나 서버 요청이 필요하지 않습니다. **정식 공개 전 검토본 표시를 유지합니다.** 공개 정책 확정·시행일·외부 URL·서명 후보 갱신은 완료되지 않았습니다.

**2026-11-25 11:17 KST 기준 새 소스의 자동 검사 세 개가 모두 성공했습니다.** 가상기기에서는 기존 네 케이스와 추가 두 케이스, 총 여섯 케이스가 모두 통과했습니다. 기존 AAB나 과거 네 케이스 결과를 새 소스의 증거로 대신하지 않았습니다.

| 실제 실행 | 결과와 범위 |
| --- | --- |
| [합성 native 빌드 45531304802](https://github.com/jmpark0611-art/bestchoice/actions/runs/45531304802/job/138927013381) | attempt 1 성공. 합성 설정·임시 서명·Manifest·assets 검증 후 키와 AAB 삭제 |
| [공개 설정 미서명 빌드 45531304799](https://github.com/jmpark0611-art/bestchoice/actions/runs/45531304799/job/138927013475) | attempt 1 성공. 정적 GET으로 공개 설정 fingerprint 대조, sourceSnapshot·Manifest·assets 검증 후 출력 삭제 |
| [Android 기기 검사 45531304702](https://github.com/jmpark0611-art/bestchoice/actions/runs/45531304702/job/138927012820) | attempt 1 성공. 고립된 API 36 에뮬레이터에서 여섯 케이스 모두 통과, 원래 테마 복원 확인 |

각 run metadata와 실제 receipt의 소스 SHA가 정확히 `66010c2…`입니다. 빌드 입력은 **162개**, 정렬된 sourceSnapshot의 SHA-256은 `ad9ebec64f269692a2b5adfa3d8b5bbf46550222bc442889dd5f63402f822a46`입니다. 기록을 갱신하는 문서 변경은 이 빌드 입력을 변경하지 않습니다.

두 안내 화면 모두 측정 폭·스크롤 폭 **320px**, 가로로 벗어난 조작 요소 **0개**, 관련 링크의 최소 높이 **58px**였습니다. 실제 터치와 시스템 뒤로가기로 문서 이동·복귀가 확인됐고, Android night 설정·화면 미디어 조건·계산된 CSS가 모두 dark였습니다. 원래 night 설정 `no`는 검사 후 복원됐습니다. 이메일 선택 검사는 DOM Range와 계산된 `user-select` 범위이며 실물 터치 선택이나 클립보드 권한 검사가 아닙니다.

## 재사용한 검증과 새 검증

- 여섯 파일은 기존에 통과한 UI 검사 6개, 타입 검사, 합성 설정 웹 빌드의 최종 결과와 바이트가 같다. 같은 전체 검사를 반복하지 않았다.
- 기존 실행·Android 뒤로가기·320px 화면·강제 종료 후 초안 복구 네 케이스를 보존한다.
- 이번에 추가로 통과한 범위는 문서 이동과 실제 Android 뒤로가기, 두 안내 화면의 320px 폭·가로 넘침·관련 링크 높이·이메일 선택 가능 상태·문서 제목 포커스·실제 다크 모드다.
- 검사는 외부 경로가 없는 loopback 전용 Android fixture에서 수행한다. 실제 메일 앱, 서명된 출시 앱, 실물 기기, 운영 백엔드 검증이 아니다.
- 로컬에서 확인된 기존 실행기는 Node 24.22.3이다. Node 22는 실행하거나 설치하지 않았다. Vercel 프로젝트의 22.x 설정만으로 이 소스가 Node 22에서 검증됐다고 표시하지 않는다.

로컬에서는 새 수신 결과·실패·누락·중복·다크 모드 복원 검사를 포함한 드라이버 검사 **28개가 통과**했습니다. 기존 20개에 8개를 추가한 결과이며 실제 Android 실행은 아래 CI 결과와 별도로 기록합니다. 새 안내 화면의 밝은 테마를 네이티브에서 검사했다는 의미는 아닙니다.

## 기존 결과의 보존

실제 커밋의 트리를 다시 읽어 27개 변경 경로의 blob을 확인했고, 변경 대상 외 기존 **334개 blob**을 그대로 보존했습니다. 브랜치는 expected-SHA 조건과 force=false로만 갱신했습니다. 자동 workflow는 예상한 세 개만 실행됐고, 통합 뒤 이 브랜치의 Vercel 배포 조회는 **0건**이었습니다. [커밋 확인 기록](../release-prep/launch-continuation/integration-commit-receipt.json).

원래 패치 SHA-256은 `af57c52046dcabeb2070fe6214f08a788b62e3021440717de6a4cb7bc0c52e08`이다. 과거 준비 단계의 [검증 기록](../release-prep/legal-navigation/verification.json)과 [소스 목록](../release-prep/legal-navigation/source-manifest.json)은 당시 범위를 그대로 보존한다.

서명 AAB `5fbf0887…`은 소스 `b8d9db6…`의 결과이며 이번 안내 화면이 없다. 해당 프로필·키·후보를 수정하지 않았다. 공개 정책 원본 초안과 기존 마이그레이션·함수도 이 통합에서 바꾸지 않는다.

## 운영 준비

[문의 처리 절차](../release-prep/launch-continuation/privacy-ops/PRIVACY-REQUEST-RUNBOOK.md)는 최소 접수정보, 본인 직접 삭제, 접근 상실, 일부 삭제 실패, 타인의 개인정보 노출 신고, 결과 확인·통지를 구체화했다. [답변 8종](../release-prep/launch-continuation/privacy-ops/REPLY-TEMPLATES.md)을 준비했으며 실제 발송은 하지 않았다. [운영 방식 선택 현황](../release-prep/launch-continuation/privacy-ops/OPERATOR-DECISIONS.md)의 세 항목은 **2026-11-25 KST 사용자의 승인으로 박지민 직접 담당, 최초 접수·분류 답변 1영업일 목표, 처리 종료 후 최소 처리표 최대 30일 보관으로 모두 확정**됐다. 최소 처리표도 필요가 없어지면 30일 전 정리한다. 원문·민감 첨부와 최소 처리표의 보관을 구분한다. 실제 적용 준비와 제공자 사실 확인은 남아 있으며, 전체 데이터 삭제 완료기한이나 운영 개시일을 확정한 것은 아니다.

[서버 관측](../release-prep/launch-continuation/migration-readiness.json)은 11월25일 10:42 KST 기준 신규 스키마 두 개와 공개 함수 여섯 이름의 부재를 기록한다. 완료 응답을 확인할 수 없었던 이전 적용 요청의 해결 근거는 새로 확보되지 않았다. 같은 적용 요청은 반복하지 않았다. 이전에 완료한 Android·웹 CORS의 204 관측은 보존한다.

## 출시 상태의 한계

새 코드 검증이 통과해도 정식 출시 완료가 아니다. 제공자 보관·처리 사실, 최종 정책과 실제 공개 주소, 신고·차단 서버 반영, Play의 이 앱 등록·버전·서명 연결, 갱신한 정확한 후보의 실물 기기 확인과 실제 스크린샷이 남는다. 계정 삭제 안내 URL의 제출 요구는 실제 기능과 Console 문항에 맞춰 판단한다.

실제 커밋·검사·배포 관측의 기계 판독 기록은 [legal-runtime-integration-2026-11-25.json](legal-runtime-integration-2026-11-25.json)이다.
