import { useEffect, useState } from 'react';
import { ActivityIndicator, Button, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { completeAuthFromUrl } from '../lib/auth';
import { supabase } from '../lib/supabase';

export default function ResetPassword() {
  const incomingUrl = Linking.useURL();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!incomingUrl) return;
    const callback = new URL(incomingUrl);
    if (callback.pathname !== '/reset-password') return;
    if (new URLSearchParams(callback.hash.slice(1)).get('type') !== 'recovery' && !callback.searchParams.has('code')) {
      setMessage('비밀번호 재설정 메일의 링크를 열어 주세요.');
      return;
    }
    completeAuthFromUrl(incomingUrl)
      .then(completed => {
        setReady(completed);
        if (!completed) setMessage('비밀번호 재설정 링크가 올바르지 않습니다.');
      })
      .catch(error => setMessage(error instanceof Error ? error.message : '재설정 링크를 확인할 수 없습니다.'));
  }, [incomingUrl]);

  async function changePassword() {
    if (!supabase || password.length < 8) {
      setMessage('새 비밀번호를 8자 이상 입력해 주세요.');
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setMessage('비밀번호를 변경했습니다.');
      router.replace('/');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '비밀번호를 변경할 수 없습니다.');
    } finally {
      setBusy(false);
    }
  }

  return <View style={styles.page}>
    <Text style={styles.title}>비밀번호 재설정</Text>
    {!incomingUrl && <ActivityIndicator />}
    {ready && <>
      <TextInput style={styles.input} placeholder="새 비밀번호 (8자 이상)" secureTextEntry value={password} onChangeText={setPassword} />
      <Button color="#22B89F" title="비밀번호 변경" disabled={busy} onPress={changePassword} />
    </>}
    <Text accessibilityRole="alert">{message}</Text>
  </View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 24, justifyContent: 'center', gap: 14 },
  title: { fontSize: 28, fontWeight: 'bold' },
  input: { padding: 12, borderWidth: 1, borderColor: '#999', borderRadius: 8 },
});
