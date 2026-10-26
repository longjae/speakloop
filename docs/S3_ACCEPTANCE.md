# S3 구현과 검증

## 범위

- 원본 전사와 모드별 기준으로 구조화 피드백 생성. 원본 인용 검증, 강점 1~3개·교정 0~3개·영어 개선 예문·다음 연습.
- 수정 전사는 저장하지만 원본 평가 입력으로 사용하지 않음. 발음·억양·공식 점수·OPIc 등급은 생성하지 않음.
- 분석 결과·근거·모드·원본 스냅샷·루브릭 버전 보존. 중복 탭은 기존 분석 반환. 실패만 최대 3회 시도, 사용자당 하루 20회 예약 제한.
- 예문은 필요할 때 Vertex TTS로 생성해 비공개 WAV로 캐시. 5분 만료 재생 URL, 기기에서 0.8/1/1.2배 재생. 음성 실패가 텍스트 피드백을 막지 않음.
- 세션별 피드백 이력·재열람, 피드백만 삭제, 녹음·전사·피드백·생성 음성을 포함한 연습 기록 삭제.
- 서버의 진행 중 상태를 저장하고 동시 요청에는 202를 반환. 실제 공급자 호출은 Vercel 요청 생명주기 안에서 최대 90초 기다림. 별도 작업 큐 없이 응답 이후 프로세스 지속을 가정하지 않음. 중단된 작업은 3분 후 제한 재시도 가능.

기본 공급자는 Vertex AI `gemini-3.5-flash`(코칭), `gemini-3.8-flash-lite-tts`(예문 음성)이며 `COACH_MODEL`·`TTS_MODEL` 환경 변수로 변경할 수 있다. 기존 `GOOGLE_API_KEY` 서버 인증을 재사용하며 사용량은 과금될 수 있다.

공식 형식은 [구조화 출력](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/control-generated-output)과 [Gemini TTS](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/text-to-speech/overview)를 기준으로 한다.

## 자동 검증

`cd apps/api && .venv/bin/python -m pytest -q`에서 18개 테스트로 원본 입력, JSON 스키마·근거, 다른 사용자 차단, 캐시 중복 호출 방지, 실패 상태 보존, WAV 변환, 단기 URL, Storage 실패 시 삭제 중단을 검증한다.

`supabase/tests/s3_coaching.sql`은 실제 DB에서 예약 중복 방지·원본 보존·짧은 발화 거부·RLS·클라이언트 RPC 실행 차단을 검증하고 모두 롤백한다. 테스트 데이터를 유지하지 않는다.

`evals/coaching_cases.json`은 실제 모델 결과를 사람이 비교할 대표 사례다. 자동 테스트 통과만으로 실제 코칭 품질을 승인하지 않는다. 원본 인용 일치, 의미 보존, 모드 적합성, 불필요한 교정, 민감한 추론·등급·음성 평가가 없는지 확인한다.

## Android 실기기 확인

1. 8단어 이상 녹음·전사 → 원본 발화 코칭 받기 → 피드백·인용 확인.
2. 인식 오류 수정본을 저장한 뒤에도 분석에 사용한 원본이 유지되는지 확인.
3. AI 예문 듣기·일시정지·재생 속도 변경. 음성 생성 실패해도 텍스트 예문이 보이는지 확인.
4. 화면을 나갔다 돌아와서 같은 피드백을 확인. 다시 누를 때 중복 분석을 만들지 않는지 확인.
5. 삭제 확인 창에서 취소·확인. 피드백만 삭제하면 원본 유지, 연습 기록 삭제 시 전체 이력 제거 확인.

iOS는 구현만 유지하고 실기기 테스트는 Android 우선 검증 후 진행한다. 실제 공급자 코칭·TTS 품질과 Android 재생은 기기 확인 전까지 미검증이다.

## 아이콘

`assets/icon.png`와 투명 `assets/adaptive-icon.png`는 제공된 Tinkit Studio 이미지를 바탕으로 ImageGen으로 제작했다. 블랙 배경, 실버 수달, 민트 말풍선을 사용한다. Android 아이콘 설정은 새 APK에 포함되므로 기존 설치본은 OTA로 화면 기능만 받을 수 있다.
