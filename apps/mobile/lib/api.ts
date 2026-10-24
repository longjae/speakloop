import { supabase } from './supabase';

const apiUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');

export type PracticeSession = {
  id: string;
  mode: 'opic' | 'daily';
  interaction_type: 'recorded' | 'turn';
  status: 'created' | 'recording' | 'processing' | 'ready' | 'failed' | 'cancelled';
  created_at: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!supabase || !apiUrl) throw new Error('앱의 API 주소와 Supabase 설정이 필요합니다.');
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error('다시 로그인해 주세요.');
  let response: Response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });
  } catch {
    throw new Error('서버에 연결할 수 없습니다.');
  }
  if (!response.ok) {
    if (response.status === 401) throw new Error('로그인이 만료되었습니다. 다시 로그인해 주세요.');
    if (response.status === 404) throw new Error('세션을 찾을 수 없습니다.');
    throw new Error(`요청에 실패했습니다 (${response.status}).`);
  }
  return response.json() as Promise<T>;
}

export function createSession(mode: PracticeSession['mode']): Promise<PracticeSession> {
  return request('/v1/sessions', {
    method: 'POST',
    body: JSON.stringify({ mode, interaction_type: 'recorded' }),
  });
}

export function listSessions(): Promise<{ items: PracticeSession[]; next_cursor: string | null }> {
  return request('/v1/sessions');
}

export function getSession(id: string): Promise<PracticeSession> {
  return request(`/v1/sessions/${encodeURIComponent(id)}`);
}
