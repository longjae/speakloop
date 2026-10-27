import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Button, Text } from '../../components/ui';
import { colors, ui } from '../../lib/theme';
import { listSessions, PracticeSession } from '../../lib/api';

const statuses:Record<PracticeSession['status'],string>={created:'연습 기록',recording:'녹음 중',processing:'처리 중',ready:'피드백 완료',failed:'재시도 필요',cancelled:'종료됨'};
export default function Dashboard() {
  const [sessions,setSessions]=useState<PracticeSession[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  useFocusEffect(useCallback(()=>{
    let active=true;setLoading(true);setError('');
    listSessions().then(result=>{if(active)setSessions(result.items);}).catch(cause=>{if(active)setError(cause.message);}).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[]));
  return <ScrollView contentContainerStyle={ui.page}>
    <Text style={ui.label}>MY SPEAKING DASHBOARD</Text><Text style={ui.title}>오늘도, 한 번 더 말해요.</Text><Text>작은 연습이 쌓여 자연스러운 영어가 됩니다.</Text>
    {loading&&<ActivityIndicator color={colors.mint}/>}
    {error?<Text style={ui.error} accessibilityRole="alert">{error}</Text>:null}
    {!loading&&!error&&<View style={ui.card}><Text style={ui.cardTitle}>나의 최근 연습</Text><Text>최근 기록 {sessions.length}개 · 피드백 완료 {sessions.filter(item=>item.status==='ready').length}개</Text><Text>최근 50개 기록을 기준으로 보여드립니다.</Text></View>}
    <View style={ui.card}><Text style={ui.cardTitle}>지금 시작해 볼까요?</Text><Button variant="primary" title="오픽 연습하기" onPress={()=>router.navigate('/opic')}/><Button title="일상 회화 연습하기" onPress={()=>router.navigate('/daily')}/></View>
    <Text style={ui.cardTitle}>최근 연습 기록</Text>
    {!loading&&!error&&sessions.length===0&&<Text>첫 연습을 시작하면 여기에 기록됩니다.</Text>}
    {sessions.map(session=><View style={ui.card} key={session.id}><Text style={ui.label}>{session.mode==='opic'?'OPIc':'일상 회화'} · {new Date(session.created_at).toLocaleDateString('ko-KR')}</Text><Button title={statuses[session.status]} onPress={()=>router.push({pathname:'/sessions/[id]',params:{id:session.id}})}/></View>)}
  </ScrollView>;
}
