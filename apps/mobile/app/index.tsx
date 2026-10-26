import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Button, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import * as Linking from 'expo-linking';
import { configured, supabase } from '../lib/supabase';
import { authRedirectUrl, completeAuthFromUrl, googleLoginEnabled, recoveryRedirectUrl, signInWithGoogle } from '../lib/auth';
import { listSessions, PracticeSession } from '../lib/api';

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [sessions, setSessions] = useState<PracticeSession[]>([]);
  const [busy, setBusy] = useState(false);
  const [googleAvailable, setGoogleAvailable] = useState(false);
  const incomingUrl = Linking.useURL();

  useEffect(() => {
    googleLoginEnabled().then(setGoogleAvailable).catch(() => setGoogleAvailable(false));
  }, []);

  useEffect(() => {
    if (!incomingUrl) return;
    completeAuthFromUrl(incomingUrl)
      .then(completed => { if (completed) setMessage('로그인되었습니다.'); })
      .catch(error => setMessage(error instanceof Error ? error.message : '로그인을 완료할 수 없습니다.'));
  }, [incomingUrl]);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => {
      setSignedIn(Boolean(data.session)); setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setSignedIn(Boolean(session)));
    return () => data.subscription.unsubscribe();
  }, []);

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

  useFocusEffect(useCallback(() => {
    if (!signedIn) { setSessions([]); return; }
    listSessions().then(result => setSessions(result.items)).catch(error => setMessage(error.message));
  }, [signedIn]));

  if (loading) return <View style={styles.page}><ActivityIndicator /></View>;
  if (!configured) return <View style={styles.page}><Text>Supabase 공개 설정을 .env에 입력해 주세요.</Text></View>;
  return <View style={styles.page}>
    <Text style={styles.title}>SpeakLoop</Text>
    {signedIn ? <>
      <Text>연습 모드를 선택하세요.</Text>
      <View style={styles.card}><Text>OPIc 연습</Text><Button color="#22B89F" title="시나리오 선택" disabled={busy} onPress={() => router.push({ pathname: '/scenarios/[mode]', params: { mode: 'opic' } })} /></View>
      <View style={styles.card}><Text>일상 회화</Text><Button color="#22B89F" title="시나리오 선택" disabled={busy} onPress={() => router.push({ pathname: '/scenarios/[mode]', params: { mode: 'daily' } })} /></View>
      <Text>최근 연습</Text>
      {sessions.map(session => <Button color="#22B89F" key={session.id} title={`${session.mode === 'opic' ? 'OPIc' : '일상 회화'} · ${session.status}`} onPress={() => router.push({ pathname: '/sessions/[id]', params: { id: session.id } })} />)}
      <Button color="#22B89F" title="로그아웃" onPress={() => supabase?.auth.signOut()} />
    </> : <>
      <TextInput style={styles.input} placeholder="이메일" autoCapitalize="none" value={email} onChangeText={setEmail} />
      <TextInput style={styles.input} placeholder="비밀번호" secureTextEntry value={password} onChangeText={setPassword} />
      <Button color="#22B89F" title="로그인" disabled={busy} onPress={signIn} />
      <Button color="#22B89F" title="계정 만들기" disabled={busy} onPress={signUp} />
      <Button color="#22B89F" title="비밀번호 재설정" disabled={busy} onPress={resetPassword} />
      {Platform.OS !== 'web' && googleAvailable && <Button color="#22B89F" title="Google로 로그인" disabled={busy} onPress={googleSignIn} />}
    </>}
    <Text>{message}</Text>
  </View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 24, justifyContent: 'center', gap: 14 },
  title: { fontSize: 28, fontWeight: 'bold' },
  input: { padding: 12, borderWidth: 1, borderColor: '#999', borderRadius: 8 },
  card: { padding: 18, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, gap: 6 },
});
