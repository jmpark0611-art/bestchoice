# 결정해지니 iOS App Store IPA (CI)

`ci/genie-ios-build` 브랜치 전용. `web/`은 고정 커밋 `c0f3e34` 그대로 빌드하고, 아래 파일만 추가함.

- `.github/workflows/genie-ios-build.yml`: macOS 러너(공개 저장소라 무료). 이 브랜치에 워크플로/`ci/genie-ios/**` 변경을 푸시하거나 이전 실행을 Re-run하면 시작.
- `prepare.mjs`: CI 체크아웃 안에서만 `com.jmpark0611.genie`, 결정해지니, 1.0, 빌드 번호, 수동 서명, 아이콘(`web/public/genie-icon.svg`를 1024 RGB로 렌더링한 `AppIcon-1024.png`), arm64를 설정.
- `asc.mjs`: App Store Connect API로 기존 앱·빌드 번호를 읽고(최댓값+1), 제공된 배포 인증서가 들어간 유효한 App Store 프로파일을 재사용하거나 없으면 1개 생성(소유자 승인 2026-11-26). 앱·번들 ID·인증서·키는 만들지 않음. 업로드 없음.
- `verify.mjs`: codesign 검증, Info.plist, embedded.mobileprovision, 서명 인증서·팀 ID 일치, SDK·버전·빌드 번호, SHA-256 → `genie-ios-1.0-verification.json`.

## 필요한 저장소 시크릿 (없으면 서명 전 미리 점검까지만 하고 멈춤)
`ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`(.p8 내용 그대로), `IOS_DIST_CERT_P12_BASE64`, `IOS_DIST_CERT_PASSWORD`.
API 키 역할은 Admin(프로파일 생성). 값을 출력·커밋하지 말 것.

## 기록
- 2026-11-26 실행 45740485804: Xcode 26.3 / iPhoneOS SDK 26.2, 공개 설정 키 해시 일치, 웹 빌드, `cap sync ios`, 서명 없는 Release 아카이브 성공(validate-for-store 통과).
- 미검증: 실기기, 운영 서버 iOS Origin(`capacitor://localhost`가 `VS_ALLOWED_ORIGINS`에 없음 → vs-decide 403 예상), 최신 운영 RPC, 수출 규정(`ITSAppUsesNonExemptEncryption` 미설정).
