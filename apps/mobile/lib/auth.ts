import * as WebBrowser from 'expo-web-browser';
import { supabase } from './supabase';

export const authRedirectUrl = 'com.speakloop.app://';
export const recoveryRedirectUrl = 'com.speakloop.app:///reset-password';

WebBrowser.maybeCompleteAuthSession();

const handledCallbacks = new Set<string>();

export async function googleLoginEnabled(): Promise<boolean> {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return false;
  const response = await fetch(`${url.replace(/\/$/, '')}/auth/v1/settings`, { headers: { apikey: key } });
  if (!response.ok) return false;
  const settings: { external?: { google?: boolean } } = await response.json();
  return settings.external?.google === true;
}

export async function completeAuthFromUrl(url: string): Promise<boolean> {
  const callback = new URL(url);
  if (callback.protocol !== 'com.speakloop.app:' || callback.host || !['', '/', '/reset-password'].includes(callback.pathname)) return false;

  const query = callback.searchParams;
  const fragment = new URLSearchParams(callback.hash.slice(1));
  const reason = query.get('error_description') ?? fragment.get('error_description');
  if (reason) throw new Error(reason);
  if (!supabase) throw new Error('Supabase 설정이 필요합니다.');

  const accessToken = fragment.get('access_token');
  const refreshToken = fragment.get('refresh_token');
  const code = query.get('code');
  const callbackId = accessToken?.slice(-20) ?? code;
  if (!callbackId) return false;
  if (handledCallbacks.has(callbackId)) return true;
  handledCallbacks.add(callbackId);

  try {
    const { error } = accessToken && refreshToken
      ? await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      : code
        ? await supabase.auth.exchangeCodeForSession(code)
        : { error: new Error('인증 응답이 올바르지 않습니다.') };
    if (error) throw error;
    return true;
  } catch (error) {
    handledCallbacks.delete(callbackId);
    throw error;
  }
}

export async function signInWithGoogle(): Promise<boolean> {
  if (!supabase) throw new Error('Supabase 설정이 필요합니다.');
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: authRedirectUrl, skipBrowserRedirect: true },
  });
  if (error) throw error;
  if (!data.url) throw new Error('Google 로그인 주소를 받지 못했습니다.');

  const result = await WebBrowser.openAuthSessionAsync(data.url, authRedirectUrl);
  if (result.type !== 'success') return false;
  return completeAuthFromUrl(result.url);
}
