# 결정해지니 Android 최종 후보 제작 계획

작성 기준: **2026-11-25 UTC**. 저장소 jmpark0611-art/bestchoice, 준비 브랜치 **codex/genie-android-native-check-20261123**, 검토 커밋 **818655e10fe00b65da8bfe64f77e0d928429eb9d**, 트리 **5777b3fb5d24cbc6d62f49f5560f097cf8f7f99a**.

**개발 브랜치에는 검토본 표시를 유지한 법무 UI를 통합할 수 있다. 정식 제출용 후보 제작은 실제 정책·공개 주소·버전·서명 연결을 확정한 뒤 진행한다.** 이 문서는 실행 순서와 입력 판정이며, 이 작업에서 빌드·테스트·서명·워크플로 실행·배포·업로드를 수행하지 않았다. 원격 최신 ref 및 실제 쓰기는 루트가 담당한다.

## 1. 현재 확보된 것과 재사용 범위

| 항목 | 확인 내용 | 적용 범위 |
| --- | --- | --- |
| 기존 최신 서명 후보 | SHA-256 5fbf088745564bbe32343a485a2b316f130ba9668c529a25a48f17f557256e78, 소스 b8d9db66c249684842971410f2c7b80dd5bec395, com.jmpark0611.genie / 1.0.0 (1) | 기존 후보의 서명·빌드 증거. 이번 법무 UI 미포함 |
| 법무 UI 구현 | 6파일, 패치 SHA-256 af57c52046dcabeb2070fe6214f08a788b62e3021440717de6a4cb7bc0c52e08 | 인증·RPC 없이 /privacy, /delete-data를 읽고 /about으로 복귀. 공개 전 검토본 |
| 적용 가능성 | 수정 대상 3개가 현재 검토 커밋의 blob과 일치, 새 경로 3개는 없음 | 기존 패치 기준과 충돌 없음. 루트가 새 격리 working 사본에 적용·해시 확인했다고 보고 |
| 이미 끝난 검증 | 최종 6개 UI 검사, 타입 검사, 합성 설정 웹 빌드, 패치 재적용 | 반복하지 않는다. 새 네이티브 phase 2는 별도 작업이며 최종 소스와 새 결과에 연결해야 함 |
| Android CORS | Android와 기존 웹의 OPTIONS 모두 204, 2026-11-24 15:44:19.640 UTC | 완료. 인증·POST·모델 호출·DB 계약 성공을 뜻하지 않음 |
| 스토어 PNG | 아이콘 512×512 RGBA, feature 1024×500 RGB의 실제 파일과 SHA-256 확인 | 새 생성 필요 없음. PNG 구조·해시 확인이며 Console 업로드나 새 시각 검토가 아님 |
| Bundletool | 기존 1.18.3 파일 32,520,401 bytes, 지정 SHA-256 일치 | 새 다운로드 필요 없음. 이번에는 도구를 실행하지 않음 |

현재 scratch의 이름이 .aab인 파일 5개를 해시 확인했으나 5fbf0887 후보와 일치하는 파일은 없었다. 이전 347b580c, c737b458, 93c44128 후보만 있다. ZIP 내부와 원격 보관 파일은 이 조회 범위에 포함하지 않았다. **이전 AAB를 최신 후보로 바꾸어 부르지 않는다.** 필요한 경우 기존 원본을 복원해 지정 해시로 확인하면 되며, 이 사실은 새 개발 소스 통합을 막거나 이전 후보를 다시 빌드할 이유가 아니다.

정확한 기존 후보·입력 근거는 [프로필](https://github.com/jmpark0611-art/bestchoice/blob/818655e10fe00b65da8bfe64f77e0d928429eb9d/web/ANDROID-RELEASE-PROFILE.json), 패치와 이미 완료한 검증은 [법무 UI 준비 기록](https://github.com/jmpark0611-art/bestchoice/blob/818655e10fe00b65da8bfe64f77e0d928429eb9d/web/release-prep/legal-navigation/README.md)이다. 파일별 blob은 SOURCE-INDEX.json, 상태별 기계 판정은 INPUT-DECISIONS.json에 있다.

## 2. 지금 통합 가능한 개발 변경

법무 UI 패치의 런타임 코드, src 안의 검토본문, About 링크와 문구, 제한된 스타일, 전용 테스트는 공개 정책의 최종 확정과 별개로 개발 브랜치에 통합할 수 있다. 시행일·공개 URL을 만들거나 검토본 표시를 제거하지 않는다. 실제 데이터 보관 사실이 바뀌면 본문과 공개용 문서를 함께 정리하되 정책 완료로 먼저 표시하지 않는다.

루트는 이미 HEAD818655e 기준의 255개 파일을 격리 사본에 마련하고 기존 패치 결과를 대조했다. 추가 네이티브 검증 구현이 진행 중이므로 최종 sourceSnapshot은 그 변경까지 고정한 뒤 만들어야 한다. 현재 6파일 패치 검증을 앞으로 추가될 네이티브 소스 검증으로 확대하지 않는다.

소스 통합만으로 기존 AAB의 hash, 서명 결과, 실물 기기 검증 플래그를 바꾸지 않는다. 기존 ANDROID-RELEASE-PROFILE.json과 release-export.yml은 이번 개발 통합에서 보존한다.

## 3. 개발 소스 푸시 시 실제 자동 실행

아래는 현재 준비 브랜치의 실제 YAML을 읽은 결과다. 단순히 “합성 CI만 실행”으로 묶으면 release-build-check의 실제 공개 설정 빌드를 빠뜨리게 된다.

| 워크플로 | web/src 변경 푸시 | 실행·서명·통신 | 원격 산출물 |
| --- | --- | --- | --- |
| android-native-check.yml | 자동 실행 | 합성 설정 native 빌드, 임시 키 생성·서명 확인·삭제. 앱·운영 백엔드는 실행하지 않음 | 업로드 없음 |
| android-device-check.yml | 자동 실행 | 기존 격리 fixture를 loopback 환경에서 실행. baseline은 네 케이스이며 추가 phase 2의 실제 범위는 새 소스로 확인 | **실패 때만** failure.png와 state.json을 GitHub artifact로 1일 보관 |
| android-release-build-check.yml | 자동 실행 | 기존 공개 웹 HTML/JS를 GET하고 key fingerprint를 대조. 선택된 실제 공개 설정으로 **미서명 AAB** 빌드 후 삭제. 앱·백엔드 호출 없음 | AAB 업로드 없음 |
| android-release-input-check.yml | 실행 안 됨 | 프로필 또는 해당 workflow 변경일 때만 공개 정적 입력 GET | 업로드 없음 |
| android-release-export.yml | 실행 안 됨 | **이 workflow 자체의 변경만** 새 export를 유발 | 실행 시 미서명 후보 네 파일을 1일 업로드 |
| genie-local-integration.yml | 법무 UI만으로는 실행 안 됨 | 지정 격리 검사 스크립트·fixture 변경 또는 수동 실행에 한함 | 업로드 없음 |
| release-candidate.yml | push만으로는 실행 안 됨 | **PR에 web/** 변경이 있거나 수동 실행하면 Node 22의 전체 verify/build** | npm 캐시 및 web/dist artifact 업로드 |

나머지 bundletool-fetch, supabase-cli-fetch, SDK-license diagnostic, CORS workflow도 소스 통합만으로 실행되지 않는다. 각 workflow 자체 변경이나 해당 workflow_dispatch가 필요하다. 이번 분석에서 실행을 요청하지 않았다.

자동 native 세 작업에는 공개 저장소·정확한 브랜치 조건이 있으며 표준 ubuntu-24.04 runner를 사용한다. 현재 [GitHub 공식 과금 안내](https://docs.github.com/en/billing/concepts/product-billing/github-actions)는 공개 저장소의 표준 runner compute가 무료라고 명시한다. 계정의 청구·저장소 사용량을 확인한 것은 아니므로 artifact/cache까지 포함한 총비용 0원을 단정하지 않는다. 유료 runner·요금제·결제 설정 변경은 없다.

web/vercel.json은 이 브랜치의 deploymentEnabled를 false로 둔다. 읽은 workflow에는 Vercel 배포나 Play 업로드·제출이 없다. 이 결과를 다른 이름의 브랜치나 새 PR에도 그대로 적용하지 않는다. 현재 계획에서는 PR을 만들지 않고 release-export.yml을 수정하지 않아야 불필요한 Node 22 전체 검사·web artifact·후보 export를 추가하지 않는다.

루트가 별도로 수행한 푸시 전 읽기 조회에서는 이 브랜치의 Vercel deployment가 0건이고 프로젝트 nodeVersion은 22.x였다. 이는 루트의 관측이며 이 문서 작업이 다시 조회한 결과는 아니다. 호스팅 Node 22와 Android CI의 Node 24.22.3은 별도 실행 환경이다. 실제 웹 공개 단계에서는 해당 소스와 배포 입력에 필요한 확인을 진행하되, 이 계획 때문에 기존 전체 검사나 새 배포를 실행하지 않는다.

## 4. 출시 입력: 준비값과 아직 확인할 값

| 입력 | 현재 값·근거 | 최종 후보 전 필요한 결과 |
| --- | --- | --- |
| 앱 이름·기본 언어·유형 | 결정해지니 / ko-KR / App | 재질문 불필요 |
| 운영자·문의·연령 | 에스제이컴퍼니 / 박지민 / jmpark0611@gmail.com / 18+ | 재질문 불필요. 콘텐츠 등급과 별개 |
| applicationId | com.jmpark0611.genie | 인증된 Console에서 이 앱의 등록 상태 확인. 다른 앱의 package를 사용하지 않음 |
| versionCode | 기존 후보 1 | 실제 bundle 이력에서 미사용 여부 확인. 최종값은 그 전까지 미정 |
| versionName | 기존 후보 1.0.0 | 확정한 새 code와 함께 새 receipt에 기록 |
| 서버 origin | 기존 선택값 https://njrtcxohbkfgrgwhlvua.supabase.co | 빌드 설정으로 사용 가능하나 운영 기능 검증 완료 의미는 아님 |
| 공개 웹 origin | https://genie-web-rosy.vercel.app | 공유 웹의 guarded 계약 호환을 별도로 확인. 이 주소를 개인정보처리방침 URL로 대체하지 않음 |
| 공개 client key | 정확한 SHA-256만 보관 | 기존 loadPublishedReleaseConfig의 정적 GET·fingerprint 확인 사용. key 원문을 로그·문서·채팅에 쓰지 않음 |
| 개인정보처리방침 URL | null | 사실 확정·공개 후 실제 URL 응답과 앱 접근 확인. /privacy 제안 경로를 현재 공개 URL로 간주하지 않음 |
| 별도 삭제 요청 URL | null, 필수 적용 여부 미확정 | 실제 계정 기능과 Console 문항을 대조해 적용 여부·요청 범위를 확정. 익명 Auth만으로 필수나 면제를 단정하지 않음. /delete-data는 현재 공개 주소가 아님 |
| 서명 key 연결 | 기존 upload certificate SHA-256 확인 | Console의 이 앱 upload certificate와 실제 연결 확인. 새 key 생성·reset을 기본 해법으로 사용하지 않음 |
| native 도구 | CI Node24.22.3/JDK21/Android36/Build Tools35/Gradle8.14.3 | 기존 workflow 조건 충족. 이번에 로컬 SDK·Gradle 전체 cache를 검사하거나 설치하지 않음 |

[Android 버전 문서](https://developer.android.com/studio/publish/versioning)에 따라 이미 사용한 code를 다시 사용하는 방식으로 새 버전을 제출하지 않는다. 코드가 바뀌었다는 이유만으로 “반드시 2”로 정할 수도 없다. 현재 앱의 실제 업로드 이력이 기준이다.

preview 식별자인 dev.local.genie.preview는 native 원본의 의도된 미리보기 값이다. release 준비기는 별도 작업 사본에 확정된 applicationId와 앱 이름을 생성하므로 원본 preview identity를 운영 ID로 덮어쓰지 않는다. genie-test.invalid는 이전 로컬 웹 검증용 합성 설정이며 release 설정 검사에서는 거부된다. 정책 경로를 위해 새 VITE_PRIVACY_URL을 만들 필요도 없다. 현재 검사는 승인된 세 VITE_* 항목 외의 변수를 거부한다.

## 5. 사용자가 직접 해야 하는 것과 대행 가능한 것

사용자에게 모든 제출 항목을 다시 작성해 달라고 요청할 이유는 없다.

| 구분 | 해당 항목 | 처리 방법 |
| --- | --- | --- |
| 보안 인증이 필요할 때 사용자 동작 | 기존 Play 계정 로그인·계정 선택·2단계 확인 | 보안 로그인 흐름에서 처리. 암호·OTP를 문서나 채팅으로 받지 않음 |
| 아직 결정되지 않은 운영자 선택 | 다운로드 가격, 출시 국가, 확정되지 않은 공개 범위·롤아웃 | 기존 승인 범위를 확인한 뒤 필요한 선택만 한 번에 정리. 임의 유료화나 국가 선택을 하지 않음 |
| 운영자만 확정할 실제 업무 방식 | 문의 담당·이메일 보관, 인증 사용자·요청 데이터의 실제 처리·삭제 절차 | 조회 가능한 설정을 먼저 확인하고 남은 운영 결정만 요청 |
| 이미 준비돼 대행 입력 가능 | 이름·언어·앱 유형·설명 48/1,075자·출시 문구 102자·연락처·18+ | 기존 패킷을 사용. 연령·회사명·이메일을 다시 묻지 않음 |
| 인증 후 읽어서 확인할 사실 | package 등록, versionCode 이력, 서명 연결, 이 앱에 적용되는 test 요구 | 사용자에게 추측값을 요구하지 말고 실제 Console을 읽음 |
| 실제 설문에 맞춰 답할 것 | Data safety, 콘텐츠 등급, 앱 접근 지침 | 코드·제공자·운영 사실에 따라 문항별 매핑. 넓은 상호작용 질문을 채팅 없음만으로 No 처리하지 않음 |
| 파일·기기 작업 | 최종 후보 스크린샷, 실제 기기 동작 | 담당자가 수행하고 기기가 필요할 때만 사용자의 연결·조작 협조를 요청 |
| 새 법적 확인·선언 | Console에 표시되는 약관·수출·서명 선언 | 정확한 문구와 기존 위임 범위를 확인. 이미 동의했다거나 이 작업에서 수락했다고 쓰지 않음 |

[Play 앱 생성 문서](https://support.google.com/googleplay/android-developer/answer/9859152?hl=en)의 실제 초기 항목과 계정별 대시보드가 기준이다. 개발자 계정에 다른 출시 앱이 있다는 사실만으로 특정 테스트 인원·기간을 추가하거나 면제됐다고 단정하지 않는다. 대상 18+는 이미 확정됐으며 실제 설문이 산출할 콘텐츠 등급을 미리 18+로 입력하는 근거가 아니다.

Data safety의 계정 생성 false는 현재 패킷에 제한 조건이 붙은 해석이다. 내부 익명 Auth가 있다는 사실만으로 일반 계정 삭제 정책 적용·면제를 확정하지 않는다. 수집되는 User ID는 계속 공개하고 실제 문항과 사용자 기능을 대조한다. 공개 URL, 제공자 공유 분류, 로그·보관, 삭제 요청 범위의 null은 No가 아니라 미확정이다.

## 6. 최종 후보 제작: 실행 순서와 중단 조건

### A. 개발 통합과 범위 한정 확인

1. 루트의 최신 ref 확인과 정확한 격리 작업 사본에서 패치·추가 native phase 2를 통합한다.
2. 개발 검토본과 제출용 최종 정책을 구분한다. 기존 6개 UI/타입/합성 빌드 증거는 같은 파일에 재사용하며 새 변경에 필요한 범위만 확인한다.
3. 승인 브랜치 푸시로 자동 실행되는 세 작업의 실제 결과·소스 SHA를 기록한다. 실패 artifact의 자동 보관 가능성을 알고 진행한다.
4. sourceSnapshot 또는 최종 후보 플래그를 이전 AAB로부터 복사하지 않는다. 이 단계 결과는 개발 준비이며 새 서명 후보가 아니다.

### B. 최종 정책·버전·소스 고정

1. 남은 실제 제공자·보관·문의 절차 사실을 확정한다.
2. 공개 개인정보처리방침과 앱 본문을 일치시키고 확인된 공개 주소·시행일을 기록한다. 별도 계정 삭제 요청 URL의 필수 적용 여부는 실제 계정 기능과 Console 문항에 따라 확정하고, 제공할 데이터 삭제 안내도 확인된 실제 처리 범위와 일치시킨다. 공개 전에는 review 상태를 유지한다.
3. 이 앱의 Console package·versionCode·upload certificate를 확인한다.
4. 최종 source commit, 위 여섯 공개 빌드 입력, sourceSnapshot, 정책 문서 해시를 묶는다. 내용이 이후 바뀌면 해당 후보를 최종 후보로 제출하지 않는다.
5. Android compile/target은 현재 36, minSdk는 24다. 실제 제출 당시 Console 요구 사항과 대조하되 지금 target을 임의 변경하지 않는다.

### C. 재사용 가능한 기존 제작 경로: 미서명 export → 로컬 서명

현재 검증된 제작 경로는 android-release-export.yml의 미서명 export를 정확한 로컬 소스와 대조하여 sign-android-export.mjs로 서명하는 방식이다.

**현재 export workflow에는 workflow_dispatch가 없다. 앱 소스를 푸시해도 새 export는 나오지 않는다.** 기존 run 재실행은 그 run의 옛 소스를 재실행하므로 새 코드 후보가 아니다. 새 최종 소스의 export는 별도의 구체적 실행 방식과 원격 artifact 전송 범위를 확인한 뒤 진행해야 한다. 이번 개발 통합에서 workflow 주석을 바꿔 우회 실행하지 않는다. workflow 수정 자체가 export trigger라는 점도 고려한다.

새 export에서 확인할 것은 새 run ID/attempt/source commit, artifact ID와 digest, 미서명 AAB·Manifest·release manifest·export receipt의 정확한 묶음이다. 기존 45289031213의 run ID를 새 소스에 대입하지 않는다. unsigned-export 스크립트는 실제 CI source context를 요구하므로 로컬 환경에서 GitHub run ID를 만들어 실행하는 방법도 사용하지 않는다.

로컬 서명은 SDK/Gradle 없이 기존 keytool, jarsigner, python3와 명시한 private 입력으로 진행할 수 있다. 아래 명령은 모든 경로·소스·공개 환경 입력이 실제로 확인된 뒤 실행하는 형태이며, 이 문서 작업에서는 실행하지 않았다. 비밀값은 인자로 넣지 않고 기존 private access JSON에서 읽는다.

~~~bash
test -n "$GENIE_SIGN_ARCHIVE" || exit 1
test -n "$GENIE_SIGN_EXPECTED_RUN" || exit 1
test -n "$GENIE_FINAL_WEB_ROOT" || exit 1
test -n "$GENIE_SIGN_OUTPUT" || exit 1
test -n "$GENIE_SIGN_KEYSTORE" || exit 1
test -n "$GENIE_SIGN_ACCESS_JSON" || exit 1
test -n "$GENIE_SIGN_ALIAS" || exit 1
node scripts/sign-android-export.mjs \
  --archive "$GENIE_SIGN_ARCHIVE" \
  --expected-run "$GENIE_SIGN_EXPECTED_RUN" \
  --web-root "$GENIE_FINAL_WEB_ROOT" \
  --output-dir "$GENIE_SIGN_OUTPUT" \
  --keystore "$GENIE_SIGN_KEYSTORE" \
  --access-json "$GENIE_SIGN_ACCESS_JSON" \
  --alias "$GENIE_SIGN_ALIAS" \
  --certificate-sha256 1f9dace46345078bcd9089be6c38b6259b83a4e2040611558c9e108eea22ea71
~~~

전제: 같은 process의 공개 release 환경 입력이 확정돼 있고, expected-run JSON은 실제 새 GitHub 실행과 artifact digest에서 만들었으며, output은 새 절대 경로여야 한다. sourceSnapshot 불일치·서명 인증서 불일치·artifact digest 불일치에서는 중단한다. 개인 key나 access JSON을 저장소·artifact에 넣지 않는다.

별도의 완전한 로컬 native 환경이 실제로 준비돼 있다면 기존 android-release.mjs check/bundle 경로가 offline Gradle로 서명 AAB를 만들 수 있다. 그러나 SDK·Gradle·Maven cache와 명시한 서명 환경을 요구하고, 이 경로의 ANDROID-BUNDLE.json은 아래 QA 변환기가 요구하는 signAndroidExport receipt와 형식이 다르다. 이번 audit에서는 그 환경을 확인하거나 receipt 호환을 구현하지 않았으므로 CI export 경로의 즉시 대체로 제시하지 않는다.

[Play 서명 문서](https://support.google.com/googleplay/android-developer/answer/9842756?hl=en)에 따라 로컬 upload key와 Google Play가 배포 APK에 사용하는 app-signing key를 구분한다. 이전 인증서 hash가 같다는 사실만으로 Play 등록·배포 서명까지 확인된 것은 아니다.

### D. 새 정확한 후보의 기기 확인

새 AAB와 새 signing receipt가 나온 뒤 현재 보유한 지정 Bundletool로 QA APK를 만들 수 있다. 이 작업은 원래 upload key를 읽지 않고 임시 QA key로 다시 서명하며, 기기 설치·실행은 별도다.

~~~bash
test -n "$GENIE_NEW_SIGNED_AAB" || exit 1
test -n "$GENIE_NEW_SIGNING_RECEIPT" || exit 1
test -n "$GENIE_NEW_SIGNED_SHA256" || exit 1
test -n "$GENIE_QA_OUTPUT" || exit 1
test -n "$GENIE_QA_JAVA_HOME" || exit 1
test -n "$GENIE_QA_PYTHON" || exit 1
node scripts/android-candidate-device-prep.mjs \
  --candidate "$GENIE_NEW_SIGNED_AAB" \
  --verification "$GENIE_NEW_SIGNING_RECEIPT" \
  --sha256 "$GENIE_NEW_SIGNED_SHA256" \
  --bundletool /workspace/scratch/59b55f9d68c3/validation/bundletool-1.18.3-45180450888/bundletool-all-1.18.3.jar \
  --output-dir "$GENIE_QA_OUTPUT" \
  --java-home "$GENIE_QA_JAVA_HOME" \
  --python "$GENIE_QA_PYTHON"
~~~

보관 파일이 사라졌다면 먼저 원래 공식 tool과 지정 hash를 복원한다. 검증 값을 바꿔 통과시키거나 다시 다운로드한 다른 버전을 기존 pin으로 부르지 않는다.

전용 테스트 기기·프로필에서 새 후보의 출처를 기록하고 안내 열기, Android Back, 작은 폭·다크 모드, 실제 메일 앱 없음/이동 거부, 공유·클립보드·중단 복구의 필요한 경로를 확인한다. 이전 사용자의 앱 데이터 삭제·무조건 재설치를 준비 단계로 삼지 않는다. QA APK는 payload를 대조한 다른 서명 파일이므로 Play 서명/배포 검증으로 기록하지 않는다. 실제 최종 스토어 스크린샷은 식별된 후보를 실행한 화면에서 확보한다.

### E. 운영·공유 웹·Play 제출

신고·차단 RPC와 guarded 공유 웹의 호환, 운영자의 실제 신고 처리, 개인정보 공개가 완료돼야 제출 준비를 마칠 수 있다. 합성 또는 이미 승인된 격리 환경의 흐름 검증을 운영 사용자의 생성·삭제로 대체하지 않는다. 개발 CI 통과만으로 운영 앱이 정상이라고 보고하지 않는다.

실제 Console에서 준비 문구와 확인된 설문 답변, 최종 파일·이미지를 입력하고 해당 앱에 표시되는 테스트 요건을 진행한다. 업로드, internal track 저장, 심사 제출, production rollout은 각각 실제 실행한 범위로 기록한다. 현재 계획서 작성은 그 어떤 상태도 완료시키지 않는다. Android 다음에 iOS 순서를 유지한다.

## 7. 오래된 플래그와 placeholder 판정

- 프로필의 androidNativeCorsAllowed=false, 403, ORIGIN_DENIED는 11월23일 관측이다. 최신 readiness의 두 204 관측을 사용한다. 역사적 후보 프로필을 무조건 다시 쓰거나 CORS 검사를 반복할 필요가 없다.
- androidDeviceValidated=true는 고립된 preview 에뮬레이터 범위다. signedReleaseDeviceValidated와 physicalDeviceValidated는 여전히 false다.
- releaseAabCreated/releaseAabSignedAndVerified=true는 5fbf0887 후보에만 적용한다.
- isolatedBackendValidated=true와 배포 metadata READY는 실제 최신 guarded 웹·운영 E2E 완료가 아니다.
- 스토어 PNG 준비는 이번 실제 파일 존재·크기·hash와 부합한다. 폰 스크린샷은 여전히 미확보다.
- 계정 생성 false, 빈 개인정보 URL, 계정 삭제 요청 범위 등은 실제 설문에 그대로 자동 입력할 값으로 취급하지 않는다. null은 미확정이며 No가 아니다.
- 최종 공개 URL에 example, invalid, 홈페이지 대체 주소 또는 임의의 시행일을 넣지 않는다.
- export workflow의 오래된 CORS 주석을 고치는 것만으로도 export가 실행될 수 있다. 상태 보충은 준비 문서에서 하고 현재 workflow를 보존한다.

## 8. 다음 작업자가 남길 최종 근거

실제 통합 SHA, 자동 실행된 job과 범위, 최종 정책·공개 URL 확인, Console package/version/signing 관측, 새 sourceSnapshot, 새 export/signing receipt, 새 AAB hash, 실제 후보의 기기·공유 검증, 실제 화면 파일, 최종 입력 및 제출 상태가 필요하다.

기존 6개 UI 검증과 83개 전체 검사, 과거 native 결과를 이유 없이 반복하지 않는다. 새로운 코드·입력·후보가 생겼을 때 남은 구체적 위험과 연결되는 검증만 추가한다. 이 문서와 INPUT-DECISIONS.json의 pending 값은 이후 실제 근거를 얻은 항목만 갱신한다.


