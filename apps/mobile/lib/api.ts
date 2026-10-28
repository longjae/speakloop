import { supabase } from './supabase';
import { Accent } from './accent';

const apiUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');

export type PracticeSession = {
  id: string;
  scenario_id?: string | null;
  mode: 'opic' | 'daily';
  interaction_type: 'recorded' | 'turn';
  status: 'created' | 'recording' | 'processing' | 'ready' | 'failed' | 'cancelled';
  created_at: string;
};

export type Scenario = {
  id: string;
  mode: PracticeSession['mode'];
  level: 'beginner' | 'intermediate';
  title: string;
  prompt: string;
  goals: string[];
  version: number;
  topic?: string;
  question_type?: string;
};

export type Utterance = { id: string; transcript_raw: string | null; transcript_edited: string | null; stt_status: 'processing' | 'ready' | 'empty' | 'failed' };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!supabase || !apiUrl) throw new Error('앱의 API 주소와 Supabase 설정이 필요합니다.');
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error('다시 로그인해 주세요.');
  let response: Response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);
  try {
    response = await fetch(`${apiUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });
  } catch {
    throw new Error(controller.signal.aborted ? '처리 시간이 길어지고 있습니다. 이력에서 진행 상태를 확인해 주세요.' : '서버에 연결할 수 없습니다.');
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    if (response.status === 401) throw new Error('로그인이 만료되었습니다. 다시 로그인해 주세요.');
    if (response.status === 404) throw new Error('기록을 찾을 수 없습니다.');
    const detail = await response.json().catch(() => null);
    const message = detail?.error?.message;
    if (typeof message === 'string' && /[가-힣]/.test(message)) throw new Error(message);
    throw new Error(`요청에 실패했습니다 (${response.status}).`);
  }
  return response.json() as Promise<T>;
}

export function createSession(mode: PracticeSession['mode'], scenarioId?: string): Promise<PracticeSession> {
  return request('/v1/sessions', {
    method: 'POST',
    body: JSON.stringify({ mode, scenario_id: scenarioId, interaction_type: 'recorded' }),
  });
}

export function listScenarios(mode: PracticeSession['mode']): Promise<{ items: Scenario[]; next_cursor: string | null }> {
  return request(`/v1/scenarios?mode=${mode}`);
}

export function getScenario(id: string): Promise<Scenario> {
  return request(`/v1/scenarios/${encodeURIComponent(id)}`);
}

export function listSessions(): Promise<{ items: PracticeSession[]; next_cursor: string | null }> {
  return request('/v1/sessions');
}

export function getSession(id: string): Promise<PracticeSession> {
  return request(`/v1/sessions/${encodeURIComponent(id)}`);
}

export function reserveUpload(sessionId: string, sizeBytes: number, durationMs: number, idempotencyKey: string): Promise<{ upload_id: string; path: string }> {
  return request(`/v1/sessions/${sessionId}/uploads`, { method: 'POST', body: JSON.stringify({ mime_type: 'audio/mp4', size_bytes: sizeBytes, duration_ms: durationMs, idempotency_key: idempotencyKey }) });
}

export function transcribeUpload(sessionId: string, uploadId: string): Promise<Utterance> {
  return request(`/v1/sessions/${sessionId}/utterances`, { method: 'POST', body: JSON.stringify({ upload_id: uploadId }) });
}

export function editTranscript(utteranceId: string, text: string): Promise<{ id: string; transcript_edited: string }> {
  return request(`/v1/utterances/${utteranceId}/transcript`, { method: 'PATCH', body: JSON.stringify({ text }) });
}

export function listUtterances(sessionId: string): Promise<{ items: Utterance[] }> {
  return request(`/v1/sessions/${sessionId}/utterances`);
}

export type AudioObservation = { category:'pronunciation'|'intonation'|'pace'|'pauses';start_ms:number;end_ms:number;observation:string;practice_tip:string;confidence:'low'|'medium'|'high' };
export type Feedback = {
  summary: string;
  audio_quality?: 'clear'|'limited'|'insufficient';
  audio_quality_note?: string;
  transcript_alignment?: 'consistent'|'uncertain'|'mismatch';
  audio_observations?: AudioObservation[];
  strengths: { text: string; evidence: string }[];
  improvements: { category: string; original: string; corrected: string; reason: string }[];
  improved_example: string;
  next_practice: string;
};
export type Analysis = {
  id: string; session_id: string; utterance_id: string; mode: PracticeSession['mode'];
  status: 'processing' | 'ready' | 'failed'; feedback_json: Feedback | null;
  input_source: 'original'|'audio_original'; input_text: string; rubric_version: string; accent: Accent; audio_duration_ms: number | null;
  audio_status: 'none' | 'processing' | 'ready' | 'failed'; created_at: string;
};
export type AudioGuide = { id: string; status: Analysis['audio_status']; playback_url: string | null; expires_in: number };
export function startAnalysis(sessionId: string, utteranceId: string, accent: Accent = 'en-US'): Promise<Analysis> {
  return request(`/v1/sessions/${sessionId}/analysis`, { method: 'POST', body: JSON.stringify({ utterance_id: utteranceId, accent }) });
}
export function getAnalysis(id: string): Promise<Analysis> { return request(`/v1/analyses/${id}`); }
export function listAnalyses(sessionId: string): Promise<{ items: Analysis[] }> { return request(`/v1/sessions/${sessionId}/analyses`); }
export function createAudioGuide(id: string): Promise<AudioGuide> { return request('/v1/audio-guides', { method: 'POST', body: JSON.stringify({ source_type: 'analysis', source_id: id }) }); }
export function getAudioGuide(id: string): Promise<AudioGuide> { return request(`/v1/audio-guides/${id}`); }
export function deleteAnalysis(id: string): Promise<{ deleted: boolean }> { return request(`/v1/analyses/${id}`, { method: 'DELETE' }); }
export function deleteSession(id: string): Promise<{ deleted: boolean }> { return request(`/v1/sessions/${id}`, { method: 'DELETE' }); }

export function getAnalysisRecording(id:string):Promise<{playback_url:string;expires_in:number;duration_ms:number}> { return request(`/v1/analyses/${id}/recording`); }

export type PracticeSentence = {index:number;text:string};
export function getPracticeSentences(id:string):Promise<{items:PracticeSentence[];accent:Accent}> { return request(`/v1/analyses/${id}/sentences`); }
export function createSentenceAudio(id:string,index:number):Promise<AudioGuide> { return request(`/v1/analyses/${id}/sentences/${index}/audio`,{method:'POST'}); }

export function getQuestionAudio(id:string,accent:Accent):Promise<AudioGuide> { return request(`/v1/scenarios/${id}/audio`,{method:'POST',body:JSON.stringify({accent})}); }
