import asyncio
import base64
import io
import wave
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError
from app import main, coaching

USER='00000000-0000-0000-0000-000000000001'
SESSION='00000000-0000-0000-0000-000000000002'
UTTERANCE='00000000-0000-0000-0000-000000000003'
ANALYSIS='00000000-0000-0000-0000-000000000004'
AUDIO=b'\x00\x00\x00\x20ftypisom'+b'original-audio'
RAW='I went to a cafe yesterday and ordered a coffee.'
FEEDBACK={'summary':'주문 상황을 구체적으로 전했습니다.','strengths':[{'text':'과거 경험을 설명했습니다.','evidence':'went to a cafe yesterday'}], 'improvements':[], 'improved_example':'I visited a cafe yesterday and ordered a coffee.','next_practice':'다음에는 주문한 이유도 덧붙여 보세요.'}

AUDIO_FEEDBACK={**FEEDBACK,'audio_quality':'clear','audio_quality_note':'말소리가 비교적 또렷합니다.','transcript_alignment':'consistent','audio_observations':[{'category':'pauses','start_ms':1000,'end_ms':2000,'observation':'문장 중간에 짧은 멈춤이 들립니다.','practice_tip':'의미가 이어지는 단어를 묶어 말해 보세요.','confidence':'medium'}]}

def row(**kwargs):
    return {'id':ANALYSIS,'user_id':USER,'session_id':SESSION,'utterance_id':UTTERANCE,'mode':'daily','status':'ready','feedback_json':FEEDBACK,'input_source':'audio_original','accent':'en-US','audio_duration_ms':12000,'audio_checksum':__import__('hashlib').sha256(AUDIO).hexdigest(),'input_text':RAW,'rubric_version':coaching.RUBRIC_VERSION,'audio_status':'none','audio_attempts':0,'attempt_count':1,'created_at':datetime.now(timezone.utc).isoformat(),**kwargs}


@pytest.fixture(autouse=True)
def auth(monkeypatch):
    main.app.dependency_overrides[main.current_user]=lambda:(USER,'user-token')
    monkeypatch.setattr(main,'service_key',lambda:'server-only')
    yield
    main.app.dependency_overrides.clear()


def test_feedback_requires_exact_grounding_and_rejects_extra_grades():
    assert coaching.validate_feedback(FEEDBACK,RAW).improvements==[]
    with pytest.raises(ValueError):
        coaching.validate_feedback({**FEEDBACK,'strengths':[{'text':'근거 없음','evidence':'I bought tea'}]},RAW)
    with pytest.raises(ValidationError):
        coaching.validate_feedback({**FEEDBACK,'grade':'AL'},RAW)


def test_provider_receives_original_as_data_and_mode_rubric(monkeypatch):
    seen={}
    def fake_generate(model,payload):
        seen.update(payload=payload)
        return {'candidates':[{'content':{'parts':[{'text':__import__('json').dumps(AUDIO_FEEDBACK)}]}}]}
    monkeypatch.setattr(coaching,'vertex_generate',fake_generate)
    assert coaching.generate_feedback(RAW,'opic',{'prompt':'Describe a cafe','goals':[]},audio=AUDIO,duration_ms=12000,accent='en-GB')==AUDIO_FEEDBACK
    assert RAW in seen['payload']['contents'][0]['parts'][0]['text']
    assert seen['payload']['contents'][0]['parts'][1]['inlineData']=={'mimeType':'audio/mp4','data':base64.b64encode(AUDIO).decode()}
    assert seen['payload']['generationConfig']['audioTimestamp'] is True
    assert 'OPIc' not in str(FEEDBACK)
    assert '질문 적합성' in seen['payload']['systemInstruction']['parts'][0]['text']
    assert seen['payload']['generationConfig']['responseSchema']['properties']['strengths']['items']['properties']['evidence']['type']=='STRING'


def test_pcm_voice_is_valid_wave(monkeypatch):
    pcm=b'\x00\x01'*240
    monkeypatch.setattr(coaching,'vertex_generate',lambda *args:{'candidates':[{'content':{'parts':[{'inlineData':{'data':base64.b64encode(pcm).decode(),'mimeType':'audio/L16;rate=24000'}}]}}]})
    result=coaching.generate_voice('A coffee, please.')
    with wave.open(io.BytesIO(result),'rb') as audio:
        assert audio.getframerate()==24000
        assert audio.readframes(240)==pcm


def test_duplicate_analysis_does_not_rerun_provider(monkeypatch):
    async def owned(*args): return None
    async def query(table,token,method='GET',**kwargs):
        assert table=='rpc/reserve_audio_coaching'
        assert kwargs['body']['p_user']==USER
        assert 'transcript_edited' not in kwargs['body']
        return [row()]
    monkeypatch.setattr(main,'owned_session',owned)
    monkeypatch.setattr(main,'query',query)
    monkeypatch.setattr(main,'generate_feedback',lambda *args:pytest.fail('cached analysis generated twice'))
    response=TestClient(main.app).post(f'/v1/sessions/{SESSION}/analysis',json={'utterance_id':UTTERANCE,'transcript_edited':'A rewritten answer.'})
    assert response.status_code==200
    assert response.json()['input_source']=='audio_original'
    assert response.json()['input_text']==RAW
    assert 'audio_path' not in response.json()


def test_analysis_is_scoped_to_owner(monkeypatch):
    async def query(table,token,**kwargs):
        assert kwargs['params']['user_id']==f'eq.{USER}'
        assert token=='user-token'
        return []
    monkeypatch.setattr(main,'query',query)
    assert TestClient(main.app).get(f'/v1/analyses/{ANALYSIS}').status_code==404


def test_analysis_failure_persists_retryable_state(monkeypatch):
    calls=[]
    async def query(table,token,method='GET',**kwargs):
        calls.append((table,method,kwargs))
        if table=='practice_sessions': return [{'scenario_id':None}]
        return [row()]
    def fail(*args,**kwargs): raise RuntimeError('private provider detail')
    monkeypatch.setattr(main,'query',query)
    async def load_audio(row):return AUDIO
    monkeypatch.setattr(main,'load_coaching_audio',load_audio)
    monkeypatch.setattr(main,'generate_feedback',fail)
    asyncio.run(main.run_analysis(row(status='processing')))
    patch=[c[2] for c in calls if c[0]=='analyses' and c[1]=='PATCH'][0]
    assert patch['body']['status']=='failed'
    assert patch['body']['error_code']=='COACH_PROVIDER_ERROR'
    assert patch['params']['attempt_count']=='eq.1'


def test_cached_voice_uses_short_lived_owned_url(monkeypatch):
    async def owned(*args):return row(audio_status='ready',audio_path=f'{USER}/{SESSION}/{ANALYSIS}.wav')
    async def storage(method,bucket,path,**kwargs):
        assert kwargs['json']=={'expiresIn':300}
        return SimpleNamespace(json=lambda:{'signedURL':'/object/sign/audio-guides/test?token=short-lived'})
    monkeypatch.setattr(main,'owned_analysis',owned)
    monkeypatch.setattr(main,'storage_request',storage)
    monkeypatch.setattr(main,'settings',lambda:('https://example.supabase.co','anon'))
    monkeypatch.setattr(main,'generate_voice',lambda *args:pytest.fail('cached voice generated twice'))
    response=TestClient(main.app).post('/v1/audio-guides',json={'source_id':ANALYSIS})
    assert response.status_code==200
    assert response.json()['playback_url'].startswith('https://example.supabase.co/storage/v1/object/sign/')


def test_deletion_stops_when_storage_fails(monkeypatch):
    async def owned(*args):return row(audio_status='ready',audio_path='private.wav')
    async def fail(*args,**kwargs):raise HTTPException(503,'Storage unavailable')
    async def query(*args,**kwargs):pytest.fail('metadata must not be deleted after storage failure')
    monkeypatch.setattr(main,'owned_analysis',owned)
    monkeypatch.setattr(main,'storage_request',fail)
    monkeypatch.setattr(main,'query',query)
    assert TestClient(main.app).delete(f'/v1/analyses/{ANALYSIS}').status_code==503


def test_active_jobs_cannot_be_deleted():
    with pytest.raises(HTTPException) as exc:
        main.assert_deletable([row(status='processing',updated_at=datetime.now(timezone.utc).isoformat())])
    assert exc.value.status_code==409


def test_new_analysis_runs_and_persists_feedback(monkeypatch):
    stored=row(status='processing',worker_started_at=None)
    async def owned(*args):return None
    async def query(table,token,method='GET',**kwargs):
        if table=='rpc/reserve_audio_coaching': return [stored.copy()]
        if table=='practice_sessions': return [{'scenario_id':None}]
        if table=='analyses':
            if method=='PATCH': stored.update(kwargs['body'])
            return [stored.copy()]
        pytest.fail(table)
    monkeypatch.setattr(main,'owned_session',owned)
    monkeypatch.setattr(main,'query',query)
    async def load_audio(row):return AUDIO
    monkeypatch.setattr(main,'load_coaching_audio',load_audio)
    monkeypatch.setattr(main,'generate_feedback',lambda text,mode,scenario,**kwargs: AUDIO_FEEDBACK if text==RAW and mode=='daily' and kwargs['audio']==AUDIO else pytest.fail('incorrect analysis input'))
    response=TestClient(main.app).post(f'/v1/sessions/{SESSION}/analysis',json={'utterance_id':UTTERANCE})
    assert response.status_code==200
    assert response.json()['status']=='ready'
    assert response.json()['feedback_json']==AUDIO_FEEDBACK
    assert stored['worker_started_at']


def test_session_delete_removes_both_storage_buckets_before_rows(monkeypatch):
    calls=[]
    async def owned(*args):return None
    async def query(table,token,method='GET',**kwargs):
        assert kwargs['params'].get('user_id')==f'eq.{USER}'
        if method=='DELETE':calls.append('db-delete');return []
        if table=='analyses':return [row(audio_status='ready',audio_path='owned-guide.wav')]
        if table=='utterances':return []
        if table=='audio_uploads':return [{'path':'owned-recording.m4a'}]
        pytest.fail(table)
    async def storage(method,bucket,path,**kwargs):
        calls.append((bucket,kwargs['json']['prefixes']))
    monkeypatch.setattr(main,'owned_session',owned)
    monkeypatch.setattr(main,'query',query)
    monkeypatch.setattr(main,'storage_request',storage)
    assert TestClient(main.app).delete(f'/v1/sessions/{SESSION}').status_code==200
    assert calls==[('audio-guides',['owned-guide.wav']),('recordings',['owned-recording.m4a']),'db-delete']


def test_audio_evidence_requires_valid_intervals_and_uncertainty():
    with pytest.raises(ValueError):
        coaching.validate_feedback({**AUDIO_FEEDBACK,'audio_observations':[{**AUDIO_FEEDBACK['audio_observations'][0],'end_ms':13000}]},RAW,12000)
    with pytest.raises(ValueError):
        coaching.validate_feedback({**AUDIO_FEEDBACK,'audio_quality':'insufficient'},RAW,12000)
    bad={'category':'grammar','original':'went','corrected':'go','reason':'인식 오류를 문법 오류로 잘못 판단'}
    with pytest.raises(ValueError):
        coaching.validate_feedback({**AUDIO_FEEDBACK,'transcript_alignment':'mismatch','improvements':[bad]},RAW,12000)


def test_original_recording_checksum_is_verified(monkeypatch):
    seen=[]
    async def query(table,token,method='GET',**kwargs):
        assert kwargs['params']['user_id']==f'eq.{USER}'
        assert kwargs['params']['session_id']==f'eq.{SESSION}'
        seen.append(table)
        if table=='utterances':return [{'upload_id':'upload'}]
        return [{'path':f'{USER}/{SESSION}/recording.m4a','size_bytes':len(AUDIO),'duration_ms':12000,'checksum':row()['audio_checksum'],'mime_type':'audio/mp4'}]
    async def storage(*args,**kwargs):return SimpleNamespace(content=AUDIO)
    monkeypatch.setattr(main,'query',query)
    monkeypatch.setattr(main,'storage_request',storage)
    assert asyncio.run(main.load_coaching_audio(row()))==AUDIO
    with pytest.raises(ValueError):
        asyncio.run(main.load_coaching_audio(row(audio_checksum='0'*64)))
    assert seen.count('utterances')==2


def test_regional_voice_selection_and_spoken_text_separation(monkeypatch):
    monkeypatch.setenv('GOOGLE_CLOUD_PROJECT','test-project')
    monkeypatch.setenv('GOOGLE_API_KEY','test-key')
    monkeypatch.delenv('TTS_VOICE_EN_US',raising=False)
    monkeypatch.delenv('TTS_VOICE_EN_GB',raising=False)
    coaching._library_voice.cache_clear()
    def get(url,**kwargs):
        return SimpleNamespace(raise_for_status=lambda:None,json=lambda:{'voices':[{'id':'voice_american','languageCode':'en-US'},{'id':'voice_british','languageCode':'en-GB'}]})
    monkeypatch.setattr(coaching.httpx,'get',get)
    assert coaching.resolve_voice('en-US')=='voice_american'
    assert coaching.resolve_voice('en-GB')=='voice_british'
    seen={}
    def generate(model,payload):
        seen.update(payload)
        return {'candidates':[{'content':{'parts':[{'inlineData':{'data':base64.b64encode(b'\x00\x01'*240).decode(),'mimeType':'audio/L16'}}]}}]}
    monkeypatch.setattr(coaching,'vertex_generate',generate)
    coaching.generate_voice('A coffee, please.','en-GB')
    assert seen['contents'][0]['parts'][0]['text']=='A coffee, please.'
    assert 'British' in seen['contents'][0]['parts'][0]['speechMetadata']['style']
    assert seen['generationConfig']['speechConfig']['voiceConfig']['voice']=='voice_british'
    coaching._library_voice.cache_clear()


def test_unavailable_accent_voice_never_silently_falls_back(monkeypatch):
    monkeypatch.setenv('GOOGLE_CLOUD_PROJECT','test-project')
    monkeypatch.setenv('GOOGLE_API_KEY','test-key')
    monkeypatch.delenv('TTS_VOICE_EN_GB',raising=False)
    coaching._library_voice.cache_clear()
    monkeypatch.setattr(coaching.httpx,'get',lambda *args,**kwargs:SimpleNamespace(raise_for_status=lambda:None,json=lambda:{'voices':[{'id':'Kore','languageCode':'en-US'}]}))
    with pytest.raises(RuntimeError):coaching.resolve_voice('en-GB')
    coaching._library_voice.cache_clear()


def test_invalid_accent_is_rejected_before_database(monkeypatch):
    async def query(*args,**kwargs):pytest.fail('invalid preference reached database')
    monkeypatch.setattr(main,'query',query)
    assert TestClient(main.app).post(f'/v1/sessions/{SESSION}/analysis',json={'utterance_id':UTTERANCE,'accent':'invalid'}).status_code==422
