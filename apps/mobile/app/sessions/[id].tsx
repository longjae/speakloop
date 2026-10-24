import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { getSession, PracticeSession } from '../../lib/api';

export default function SessionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [session, setSession] = useState<PracticeSession | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    getSession(id).then(setSession).catch(cause => setError(cause instanceof Error ? cause.message : '세션을 불러올 수 없습니다.'));
  }, [id]);

  return <View style={styles.page}>
    {!session && !error && <ActivityIndicator />}
    {error && <Text accessibilityRole="alert">{error}</Text>}
    {session && <>
      <Text style={styles.title}>{session.mode === 'opic' ? 'OPIc 연습' : '일상 회화'}</Text>
      <Text>상태: {session.status}</Text>
      <Text>세션: {session.id}</Text>
      <Text>녹음과 음성 분석은 다음 개발 단계에서 사용할 수 있습니다.</Text>
    </>}
  </View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 24, justifyContent: 'center', gap: 16 },
  title: { fontSize: 24, fontWeight: 'bold' },
});
