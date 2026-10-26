import { Button, Text, TextInput, Brand } from '../components/ui';
import { colors, ui } from '../lib/theme';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import * as Linking from 'expo-linking';
import { configured, supabase } from '../lib/supabase';
import { authRedirectUrl, completeAuthFromUrl, googleLoginEnabled, recoveryRedirectUrl, signInWithGoogle } from '../lib/auth';
import { listSessions, PracticeSession } from '../lib/api';

const sessionStatus: Record<PracticeSession['status'], string> = { created: '연습 기록', recording: '녹음 중', processing: '처리 중', ready: '완료', failed: '재시도 필요', cancelled: '종료됨' };

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

  if (loading) return <View style={styles.page}><ActivityIndicator color={colors.mint} /></View>;
  if (!configured) return <View style={styles.page}><Text>Supabase 공개 설정을 .env에 입력해 주세요.</Text></View>;
  return <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
    <Brand />
    {signedIn ? <>
      <Text style={styles.title}>오늘도, 한 번 더 말해요.</Text>
      <Text>작은 연습이 쌓여 자연스러운 영어가 됩니다.</Text>
      <Text style={ui.label}>PRACTICE MODES</Text>
      <View style={styles.card}><Text style={ui.cardTitle}>OPIc 연습</Text><Text>질문에 답하며 나만의 이야기를 연습해요.</Text><Button title="시나리오 선택" disabled={busy} onPress={() => router.push({ pathname: '/scenarios/[mode]', params: { mode: 'opic' } })} /></View>
      <View style={styles.card}><Text style={ui.cardTitle}>일상 회화</Text><Text>실제 상황에서 바로 쓸 수 있는 영어.</Text><Button title="시나리오 선택" disabled={busy} onPress={() => router.push({ pathname: '/scenarios/[mode]', params: { mode: 'daily' } })} /></View>
      <Text style={ui.label}>RECENT PRACTICE · 최근 연습</Text>
      {sessions.length === 0 && <Text>첫 연습을 시작하면 여기에 기록됩니다.</Text>}
      {sessions.map(session => <Button key={session.id} title={`${session.mode === 'opic' ? 'OPIc' : '일상 회화'} · ${sessionStatus[session.status]}`} onPress={() => router.push({ pathname: '/sessions/[id]', params: { id: session.id } })} />)}
      <Button variant="quiet" title="로그아웃" onPress={() => supabase?.auth.signOut()} />
    </> : <>
      <Text style={styles.title}>말하기의 시작을 가볍게.</Text>
      <Text>나의 영어를 듣고, 다듬고, 다시 말해요.</Text>
      <TextInput style={styles.input} placeholder="이메일" keyboardType="email-address" autoCapitalize="none" value={email} onChangeText={setEmail} />
      <TextInput style={styles.input} placeholder="비밀번호" secureTextEntry value={password} onChangeText={setPassword} />
      <Button variant="primary" title="로그인" disabled={busy} onPress={signIn} />
      <Button title="계정 만들기" disabled={busy} onPress={signUp} />
      <Button variant="quiet" title="비밀번호 재설정" disabled={busy} onPress={resetPassword} />
      {Platform.OS !== 'web' && googleAvailable && <Button title="Google로 로그인" disabled={busy} onPress={googleSignIn} />}
    </>}
    {message ? <Text accessibilityLiveRegion="polite">{message}</Text> : null}
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { ...ui.page, paddingTop: 32, gap: 20 },
  title: { ...ui.title },
  input: { ...ui.input },
  card: { ...ui.card },
});
