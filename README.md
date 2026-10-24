# SpeakLoop

OPIc 준비와 일상 영어 회화를 함께 돕는 AI 말하기 코칭 모바일 앱입니다.

사용자는 질문이나 상황을 고르고 영어로 말합니다. 앱은 발화를 전사하고 개선 가이드를 제공합니다. 사용자는 교정된 표현을 듣고 다시 말한 뒤, 유용한 표현을 저장하고 복습합니다. 턴 기반 대화와 실시간 음성 대화도 제품 범위에 포함됩니다.

## 현재 상태

제품 요구사항과 S1 기반 코드의 첫 단계를 정리했습니다. 실제 Supabase 프로젝트 연결과 기기 검증은 아직 필요합니다.

- [제품 요구사항 문서](docs/PRD.md): 14개 기능, 화면 흐름, API·DB 설계, 보안, 하네스·루프·그래프 설계, 6개 스프린트
- 사용 기술: Expo/React Native, FastAPI, Supabase

## 개발 실행

- 모바일: `cd apps/mobile && npm ci && npm run typecheck && npm run start`
- API: `cd apps/api && uv sync --extra test && uv run pytest && uv run uvicorn app.main:app --reload`
- API 상태: `GET http://localhost:8000/health`
- fake 상태 전이 검사: 저장소 루트에서 `PYTHONPATH=evals apps/api/.venv/bin/pytest -q evals`
- 로컬 RLS 검사: Docker가 실행 중일 때 저장소 루트에서 `bash supabase/tests/run-local.sh`

모바일에는 `apps/mobile/.env.example`을 참고해 공개 Supabase URL과 publishable/anon 키, 기기에서 접근 가능한 API 주소를 설정합니다. 실제 기기에서 API 주소의 `localhost`는 기기 자체를 가리키므로 개발 PC의 LAN 주소 또는 접근 가능한 HTTPS 주소를 사용해야 합니다. 서버에는 `apps/api/.env.example`의 두 값을 환경 변수로 제공합니다. 실제 비밀키는 모바일에 넣지 않습니다. Supabase 프로젝트의 SQL 편집기에서 `supabase/migrations/202610240001_s1.sql`을 적용한 뒤 로그인과 사용자별 세션을 확인합니다. URL과 키가 없으면 모바일은 설정 안내를 보이며 API의 인증 경로는 503을 반환합니다.

현재 S1 구현은 로그인·로그아웃·세션 복원 UI, 모드별 세션 생성·조회, JWT 검증 API, RLS 정책, fake 상태 그래프의 시작점입니다. 로컬 PostgreSQL에서는 마이그레이션 및 계정 간 읽기·수정·삭제·대리 생성 차단을 검증합니다. 실제 기기 로그인과 호스팅 Supabase에 대한 검증은 프로젝트 연결 후 진행해야 합니다.

## 시작 순서

1. [PRD](docs/PRD.md)의 S1 범위와 인수 기준을 확인합니다.
2. Supabase 프로젝트를 만들고 공개 환경 변수를 설정한 뒤 마이그레이션을 적용합니다.
3. 각 스프린트의 기능을 구현하고 실제 iOS·Android 기기에서 검증합니다.

> OPIc 예상 등급은 공식 성적이 아닌 연습용 추정치로 설계합니다.
