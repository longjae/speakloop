import { Button, Text } from '../../components/ui';
import { colors, ui } from '../../lib/theme';
import { useLocalSearchParams, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { createSession, listScenarios, PracticeSession, Scenario } from '../../lib/api';

export default function ScenarioList() {
  const { mode } = useLocalSearchParams<{ mode: string }>();
  const validMode: PracticeSession['mode'] | null = mode === 'opic' || mode === 'daily' ? mode : null;
  const [items, setItems] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!validMode) { setError('연습 모드를 확인할 수 없습니다.'); setLoading(false); return; }
    listScenarios(validMode)
      .then(result => setItems(result.items))
      .catch(cause => setError(cause instanceof Error ? cause.message : '시나리오를 불러올 수 없습니다.'))
      .finally(() => setLoading(false));
  }, [validMode]);

  async function start(scenario: Scenario) {
    setBusy(true);
    setError('');
    try {
      const session = await createSession(scenario.mode, scenario.id);
      router.replace({ pathname: '/sessions/[id]', params: { id: session.id, scenarioId: scenario.id } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '연습을 시작할 수 없습니다.');
    } finally {
      setBusy(false);
    }
  }

  return <ScrollView contentContainerStyle={styles.page}>
    <Text style={styles.title}>{validMode === 'opic' ? 'OPIc' : '일상 회화'} 시나리오</Text>
    {loading && <ActivityIndicator color={colors.mint} />}
    {error && <Text style={ui.error} accessibilityRole="alert">{error}</Text>}
    {!loading && !error && items.length === 0 && <Text>선택할 수 있는 시나리오가 없습니다.</Text>}
    {items.map(item => <View style={styles.card} key={item.id}>
      <Text style={styles.cardTitle}>{item.title}</Text>
      <Text>{item.level === 'beginner' ? '초급' : '중급'}</Text>
      <Text>{item.prompt}</Text>
      <Text>목표: {item.goals.join(' · ')}</Text>
      <Button variant="primary" title="이 시나리오로 시작" disabled={busy} onPress={() => start(item)} />
    </View>)}
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { ...ui.page },
  title: { ...ui.title },
  card: { ...ui.card },
  cardTitle: { ...ui.cardTitle },
});
