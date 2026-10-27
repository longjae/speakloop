import { useEffect, useState } from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { Button, Text, TextInput, Brand } from '../components/ui';
import { colors, ui } from '../lib/theme';
import { configured, supabase } from '../lib/supabase';
import { authRedirectUrl, googleLoginEnabled, recoveryRedirectUrl, signInWithGoogle } from '../lib/auth';
import { useAuth } from '../lib/auth-context';

export default function Login() {
  const {error:authError}=useAuth();
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const [googleAvailable,setGoogleAvailable]=useState(false);
  useEffect(()=>{let active=true;googleLoginEnabled().then(value=>{if(active)setGoogleAvailable(value);}).catch(()=>{});return ()=>{active=false;};},[]);
  async function signIn() {
    if (!supabase) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      setMessage(error?.message ?? '로그인되었습니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '로그인할 수 없습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function signUp() {
    if (!supabase) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: authRedirectUrl } });
      setMessage(error?.message ?? (data.session ? '가입하고 로그인했습니다.' : '확인 메일을 보냈습니다. 메일의 링크를 열어 가입을 완료해 주세요.'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '계정을 만들 수 없습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function googleSignIn() {
    setBusy(true);
    setMessage('');
    try {
      const completed = await signInWithGoogle();
      if (!completed) setMessage('Google 로그인을 취소했습니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Google 로그인에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    if (!supabase || !email.trim()) {
      setMessage('이메일을 입력해 주세요.');
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: recoveryRedirectUrl });
      if (error) throw error;
      setMessage('계정이 있으면 비밀번호 재설정 메일을 보냅니다. 메일의 링크를 앱에서 열어 주세요.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '재설정 메일을 보낼 수 없습니다.');
    } finally {
      setBusy(false);
    }
  }

  if(!configured)return <View style={ui.page}><Text>앱 연결 설정을 확인해 주세요.</Text></View>;
  return <ScrollView contentContainerStyle={{...ui.page,paddingTop:48,gap:20}} keyboardShouldPersistTaps="handled">
    <Brand/><Text style={ui.title}>말하기의 시작을 가볍게.</Text><Text>나의 영어를 듣고, 다듬고, 다시 말해요.</Text>
    <TextInput placeholder="이메일" keyboardType="email-address" autoCapitalize="none" value={email} onChangeText={setEmail}/>
    <TextInput placeholder="비밀번호" secureTextEntry value={password} onChangeText={setPassword}/>
    <Button variant="primary" title="로그인" loading={busy} onPress={signIn}/>
    <Button title="계정 만들기" disabled={busy} onPress={signUp}/>
    <Button variant="quiet" title="비밀번호 재설정" disabled={busy} onPress={resetPassword}/>
    {Platform.OS!=='web'&&googleAvailable&&<Button title="Google로 로그인" disabled={busy} onPress={googleSignIn}/>}
    {message||authError?<Text accessibilityLiveRegion="polite">{message||authError}</Text>:null}
  </ScrollView>;
}
