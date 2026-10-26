# SpeakLoop

OPIc 준비와 일상 영어 회화를 함께 돕는 AI 말하기 코칭 모바일 앱입니다.

사용자는 질문이나 상황을 고르고 영어로 말합니다. 앱은 발화를 전사하고 개선 가이드를 제공합니다. 사용자는 교정된 표현을 듣고 다시 말한 뒤, 유용한 표현을 저장하고 복습합니다. 턴 기반 대화와 실시간 음성 대화도 제품 범위에 포함됩니다.

## 현재 상태

S1 로그인·세션 기반 기능과 S2 시나리오 선택, 녹음·재생, 비공개 업로드, Vertex AI 영어 전사, 전사 수정 기능을 구현했습니다. Supabase 마이그레이션과 Vercel 운영 API 배포를 완료했고, Android 실기기에서 Google 로그인과 녹음→전사를 확인했습니다. 전사 수정본 재진입 확인과 S2 장애 사례·iOS 검증은 남았습니다. Android 테스트 앱은 EAS Update의 `preview` 채널로 화면·동작 변경을 받습니다.

- [제품 요구사항 문서](docs/PRD.md): 14개 기능, 화면 흐름, API·DB 설계, 보안, 하네스·루프·그래프 설계, 6개 스프린트
- 사용 기술: Expo/React Native, FastAPI, Supabase

## 개발 실행

- 모바일: `cd apps/mobile && pnpm install --frozen-lockfile && pnpm typecheck && pnpm start`
- API: `cd apps/api && uv sync --extra test && uv run pytest && uv run --env-file .env uvicorn app.main:app --reload`
- API 상태: `GET http://localhost:8000/health`
- 배포 API 상태: `GET https://speakloop-api.vercel.app/health`
- fake 상태 전이 검사: 저장소 루트에서 `PYTHONPATH=evals apps/api/.venv/bin/pytest -q evals`
- 로컬 RLS 검사: Docker가 실행 중일 때 저장소 루트에서 `bash supabase/tests/run-local.sh`

모바일에는 `apps/mobile/.env.example`을 참고해 공개 Supabase URL과 publishable/anon 키, 기기에서 접근 가능한 API 주소를 설정합니다. 실제 기기에서는 Vercel에 배포한 HTTPS API 주소를 사용합니다. 서버에는 `apps/api/.env.example`의 값을 환경 변수로 제공합니다. 실제 비밀키는 모바일에 넣지 않습니다. Supabase 프로젝트에 S1과 S2 마이그레이션을 적용했습니다. URL과 키가 없으면 모바일은 설정 안내를 보이며 API의 인증 경로는 503을 반환합니다.

S2 전사는 Vercel 서버의 `SUPABASE_SERVICE_ROLE_KEY`와 `GOOGLE_API_KEY`를 사용합니다. `GOOGLE_CLOUD_PROJECT=speakloop-512602`, `GOOGLE_CLOUD_LOCATION=global`, `STT_MODEL=gemini-3.5-transcribe`도 설정했습니다. 키를 채팅이나 저장소에 넣지 않습니다. 녹음 제출은 사용량에 따라 과금될 수 있고, 사용자별 하루 예약 20회로 제한합니다.

다음 개발 단계는 [PRD](docs/PRD.md)의 S3 코칭입니다. 구조화 피드백, 결과 화면, TTS 가이드, 분석 이력과 삭제를 구현합니다.

## 시작 순서

1. [PRD](docs/PRD.md)의 S1 범위와 인수 기준을 확인합니다.
2. Supabase 프로젝트를 만들고 공개 환경 변수를 설정한 뒤 마이그레이션을 적용합니다.
3. 각 스프린트의 기능을 구현하고 실제 iOS·Android 기기에서 검증합니다.

## Android 로그인 설정

앱은 Google OAuth와 이메일·비밀번호 가입 및 로그인을 지원합니다. Android 배포 빌드의 앱 ID와 딥링크 스킴은 `com.speakloop.app`이며, 로그인 복귀 주소는 `com.speakloop.app://`입니다. OAuth는 Expo Go에서 검증할 수 없으므로 개발 빌드나 배포 빌드에서 확인합니다.

1. Google Cloud `speakloop-512602` 프로젝트에 **웹 애플리케이션** OAuth 클라이언트를 만들었습니다. 승인된 리디렉션 URI는 `https://irpsdnjjizettheyxtkh.supabase.co/auth/v1/callback`입니다. 클라이언트 ID와 비밀값은 [Supabase Google 제공자 설정](https://supabase.com/dashboard/project/irpsdnjjizettheyxtkh/auth/providers)에 저장했고 Google 제공자를 켰습니다. 비밀값은 앱 `.env`에 넣지 않습니다.
2. [Supabase Auth URL 설정](https://supabase.com/dashboard/project/irpsdnjjizettheyxtkh/auth/url-configuration)에 `com.speakloop.app://**`를 추가했습니다. 이 주소는 Google 로그인 복귀와 이메일 가입 확인에 함께 쓰입니다.
3. [Google Auth Platform](https://console.cloud.google.com/auth/overview?project=speakloop-512602)에 `openid`, 이메일, 프로필 권한을 등록했습니다. `tinkit.studio@gmail.com`이 프로젝트 소유자, 공개 지원 이메일, 개발자 연락처, 테스트 사용자입니다. 기존 `mmqq2003@gmail.com`도 프로젝트 소유자와 테스트 사용자로 남아 있습니다. 현재 동의 화면은 테스트 상태입니다. 일반 사용자에게 배포하기 전 홈페이지, 개인정보처리방침, 서비스 약관 링크를 준비하고 공개 상태로 전환해야 합니다.
4. Android 빌드에서 Google 로그인, 이메일 가입·확인·로그인, 비밀번호 재설정, 로그아웃, 세션 복원을 확인합니다. 실제 기기에서는 `EXPO_PUBLIC_API_URL=https://speakloop-api.vercel.app`을 사용합니다. Vercel 운영 API는 공개돼 있으며 사용자 데이터 경로는 Supabase 로그인 토큰을 검사합니다. 미리보기 배포에는 Vercel 인증 보호가 적용됩니다.

## Android 테스트 빌드

`apps/mobile/eas.json`의 `preview` 프로필은 설치용 APK를 만듭니다. 로컬 앱은 [tinkit-studio의 SpeakLoop Expo 프로젝트](https://expo.dev/accounts/tinkit-studio/projects/speakloop)에 연결돼 있습니다. EAS `preview` 환경에는 `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_API_URL`을 설정했습니다. 새 빌드는 `cd apps/mobile && pnpm dlx eas-cli@25.3.0 build --platform android --profile preview`로 실행합니다. 이 세 값은 앱에 포함되는 공개 설정입니다. 서버 비밀키는 EAS에 넣지 않습니다.

앱에서 이메일을 입력하고 **비밀번호 재설정**을 누르면 확인 메일을 보냅니다. Android 기기에서 메일 링크를 열고 새 비밀번호를 입력합니다. 복귀 주소는 `com.speakloop.app:///reset-password`입니다.

[Supabase Android OAuth 안내](https://supabase.com/docs/guides/auth/native-mobile-deep-linking)와 [Expo OAuth 안내](https://docs.expo.dev/guides/authentication/)를 기준으로 설정합니다.

> OPIc 예상 등급은 공식 성적이 아닌 연습용 추정치로 설계합니다.
