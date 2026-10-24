import { useEffect, useState } from 'react';
import { ActivityIndicator, Button, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { configured, supabase } from '../lib/supabase';
import { createSession, listSessions, PracticeSession } from '../lib/api';

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [sessions, setSessions] = useState<PracticeSession[]>([]);
  const [busy, setBusy] = useState(false);

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
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setMessage(error?.message ?? '로그인되었습니다.');
  }

  useEffect(() => {
    if (!signedIn) { setSessions([]); return; }
    listSessions().then(result => setSessions(result.items)).catch(error => setMessage(error.message));
  }, [signedIn]);

  async function startPractice(mode: PracticeSession['mode']) {
    setBusy(true);
    setMessage('');
    try {
      const session = await createSession(mode);
      router.push({ pathname: '/sessions/[id]', params: { id: session.id } });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '세션을 시작할 수 없습니다.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <View style={styles.page}><ActivityIndicator /></View>;
  if (!configured) return <View style={styles.page}><Text>Supabase 공개 설정을 .env에 입력해 주세요.</Text></View>;
  return <View style={styles.page}>
    <Text style={styles.title}>SpeakLoop</Text>
    {signedIn ? <>
      <Text>연습 모드를 선택하세요.</Text>
      <View style={styles.card}><Text>OPIc 연습</Text><Button title="새 연습 시작" disabled={busy} onPress={() => startPractice('opic')} /></View>
      <View style={styles.card}><Text>일상 회화</Text><Button title="새 연습 시작" disabled={busy} onPress={() => startPractice('daily')} /></View>
      <Text>최근 연습</Text>
      {sessions.map(session => <Button key={session.id} title={`${session.mode === 'opic' ? 'OPIc' : '일상 회화'} · ${session.status}`} onPress={() => router.push({ pathname: '/sessions/[id]', params: { id: session.id } })} />)}
      <Button title="로그아웃" onPress={() => supabase?.auth.signOut()} />
    </> : <>
      <TextInput style={styles.input} placeholder="이메일" autoCapitalize="none" value={email} onChangeText={setEmail} />
      <TextInput style={styles.input} placeholder="비밀번호" secureTextEntry value={password} onChangeText={setPassword} />
      <Button title="로그인" onPress={signIn} />
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
