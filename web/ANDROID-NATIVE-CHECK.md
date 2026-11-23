# 결정해지니 Android 실제 빌드 검증 결과

**후속 결과 — 2026-11-23 16:16 한국 시간:**
[실행 45129704040](https://github.com/jmpark0611-art/bestchoice/actions/runs/45129704040)에서
최종 AAB의 binary Manifest를 직접 읽는 앱 ID·버전 검증까지 통과했습니다.
검증 커밋은 `022bbd56881066c4bb12a2916dda77ad1e3a2028`이며,
새 receipt의 `finalBinaryManifestIdentityVerified`는 `true`입니다.
합성 설정·일회용 키를 사용한 범위이고 정식 출시 AAB나 서버·기기 검증은 아닙니다.
아래 13:57 결과는 최초 통과 이력을 보존한 것입니다. 현재 세 가지 출시 준비 상태는
[ANDROID-RELEASE-PROGRESS-2026-11-23.md](./ANDROID-RELEASE-PROGRESS-2026-11-23.md)에 있습니다.

확인일: 2026-11-23 13:57 한국 시간

## 결과: 네이티브 검증 통과

사용자가 새 빌드 전용 브랜치의 소스 반영과 검증을 승인한 뒤, 실제 Android
release variant를 컴파일하고 일회용 키로 서명한 새 AAB를 확인했습니다.
최종 [GitHub Actions 실행 45114713986](https://github.com/jmpark0611-art/bestchoice/actions/runs/45114713986)은 성공으로 종료됐습니다.

- 검증한 커밋: `9c88d192f26fd370e02186abad71d5794fabc961`
- 브랜치: `codex/genie-android-native-check-20261123`
- 환경: 표준 Ubuntu 24.04, Node 24.22.3, Java 21.0.13, SDK platform 36, Build Tools 35.0.0, Gradle 8.14.3
- 실제 Gradle 결과: `BUILD SUCCESSFUL`, 1분 31초, 120개 task 실행
- 새 AAB의 서명, 준비한 앱 자산의 경로·바이트, 필수 Capacitor 라이브러리 자산의 해시 대조 통과
- 빌드 뒤 소스·공개 설정·복사 파일·검증 코드의 일치 확인 통과
- 성공 기록을 남기기 전에 임시 서명키와 생성 AAB를 삭제했고, 업로드 artifact는 0개

기계 판독용 결과와 정확한 실행 이력은
[ANDROID-NATIVE-VERIFICATION-2026-11-23.json](./ANDROID-NATIVE-VERIFICATION-2026-11-23.json)에 있습니다.
기록 상태는 `native-check-passed-not-a-release`입니다. 실제 서버에 연결하거나 앱을
실행하지 않았으며, 정식 출시용 AAB를 보관한 결과는 아닙니다.

## 실제 실행에서 발견하고 해결한 문제

첫 실행은 컴파일·임시 서명까지 통과했지만 최종 자산 대조에서 멈췄습니다.
진단을 추가한 두 번째 실행에서 누락·내용 변경은 없고,
`base/assets/native-bridge.js` 한 파일만 기존 기대 목록에 없다는 사실을 확인했습니다.
이 파일의 SHA-256은 설치된 `@capacitor/android` 8.6.2의 원본과 정확히 같았습니다.

```text
02dfc17bd41d1e5d0748f7f6c48aa9f2a3e624bb3677df488db466fbc93f2246
```

Android 빌드는 앱 입력 폴더와 라이브러리의 자산을 병합합니다.
기존 검증기가 앱 입력 폴더만 기대 목록에 포함한 것이 원인이었습니다.
검증기를 수정하여 이 정확한 파일의 빌드 전 원본 해시를 기록하고 AAB 안의 파일과
대조하며, 빌드 뒤 원본이 바뀌거나 앱 자산과 경로가 충돌해도 실패하도록 했습니다.
다른 추가 파일이나 누락·내용 변경을 허용하는 예외는 넣지 않았습니다.

변경한 범위의 로컬 검사 4개가 통과했습니다. 실제 Python ZIP 검사는 정상,
추가 파일, 앱 파일 변경·누락, bridge 파일 변경·누락의 여섯 경우를 확인했습니다.
네이티브 명령을 주입한 정리·기록 검사는 실제 Android 빌드와 구분했습니다.
수정본의 세 번째 원격 실행에서 전체 검증이 통과했습니다. 기존 앱 전체 테스트는
반복하지 않았습니다.

| 실행 | 검증 커밋 | 결과 |
| --- | --- | --- |
| [첫 빌드](https://github.com/jmpark0611-art/bestchoice/actions/runs/45114017080) | `70d44c0` | 컴파일·서명 통과, 자산 기대 목록 불일치로 실패 |
| [원인 진단](https://github.com/jmpark0611-art/bestchoice/actions/runs/45114434469) | `96a4256` | 추가 파일 경로·해시를 확인하고 실패 유지 |
| [수정 검증](https://github.com/jmpark0611-art/bestchoice/actions/runs/45114713986) | `9c88d19` | 컴파일·서명·자산 대조·정리 모두 성공 |

## 반영 범위와 보존한 기존 작업

기존 출시 후보 `6cb0b24748dae152e66f8f4639506dba53b618cf`의 원격 tree에
검토한 파일 129개만 추가·수정하여 첫 검증 커밋을 만들었습니다. 원격에만 있던
기존 파일 100개를 보존하고 해시·mode를 대조했습니다. 기본 브랜치와 기존
출시 후보 및 다른 기존 브랜치의 HEAD도 변경되지 않았습니다.

후속 수정과 결과 기록도 위 빌드 전용 브랜치의 `web/` 및 native workflow
범위에만 반영했습니다. 기존 `app/`, Supabase 함수·마이그레이션과 기존
release-candidate workflow는 보존했습니다. 병합, 웹 배포, 운영 데이터·계정·결제
설정 변경, Google Play 제출은 수행하지 않았습니다.

`web/vercel.json`에는 이 빌드 브랜치의 자동 배포 비활성화가 포함되어 있습니다.
반영 전 현재 연결된 Vercel 계정과 팀에서 이 저장소 ID의 프로젝트가 반환되지
않는 것을 다시 확인했습니다. 이것은 다른 계정의 모든 연결을 조사했다는 의미는 아닙니다.

## 정식 출시까지 남는 단계

1. 실제 앱 패키지 ID·버전, 승인된 서버의 공개 설정, 공유 링크를 열 웹 주소를 확정합니다.
   이번 합성 앱 ID와 가짜 서버 설정은 출시 입력으로 쓰지 않습니다.
2. 비공개 빌드 환경에서 정식 업로드 서명키를 연결하고 새 출시용 AAB를 만듭니다.
   최종 binary Manifest의 앱 ID·버전도 확인해야 합니다. 이번 receipt의
   `finalBinaryManifestIdentityVerified`는 `false`입니다.
3. 이미 접근이 허용된 별도 격리 서버가 준비되면 합성 데이터·분리된 두 세션으로
   결정→공유→투표→작성자 집계/삭제를 확인합니다. Android 실기기에서 시작,
   뒤로가기, 공유 링크, 초안 복원, 투표·신고 흐름을 확인한 뒤 스토어 준비를 마무리합니다.

현재 검증에는 실제 서버 접속, 실기기 실행, 정식 서명키, 스토어 제출이 포함되지
않습니다. Android 출시 준비를 먼저 진행하고 iOS를 이어갑니다.

## 근거

- 위의 세 GitHub Actions 실행과 성공 receipt, 해당 커밋의 native smoke 코드.
- [AGP 8.13 ASSETS API](https://developer.android.com/reference/tools/gradle-api/8.13/com/android/build/api/artifact/SingleArtifact.ASSETS): 최종 APK/Bundle의 병합 자산.
- 잠긴 설치의 `@capacitor/android/capacitor/src/main/assets/native-bridge.js`와 `JSExport.java`.
