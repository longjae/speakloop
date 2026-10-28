import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Button, Text } from './ui';
import { colors, ui } from '../lib/theme';
import { createSession, listScenarios, PracticeSession, Scenario } from '../lib/api';
import { topicLabels, typeLabels } from '../lib/opic-mock';
import { ensureMicrophoneAccess } from '../lib/microphone';

export function PracticeList({mode}:{mode:PracticeSession['mode']}) {
  const [topic,setTopic]=useState('all');
  const [kind,setKind]=useState('all');
  const [items,setItems]=useState<Scenario[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [permissionNeeded,setPermissionNeeded]=useState(false);
  const requestVersion=useRef(0);
  useFocusEffect(useCallback(()=>{setBusy(false);return ()=>{requestVersion.current++;};},[]));
  useEffect(()=>{
    let active=true;
    setLoading(true);setError('');
    listScenarios(mode).then(result=>{if(active)setItems(result.items);}).catch(cause=>{if(active)setError(cause.message);}).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[mode]);
  async function start(scenario:Scenario) {
    const version=requestVersion.current;
    setBusy(true);setError('');setPermissionNeeded(false);
    try {
      if(!await ensureMicrophoneAccess()) {
        setPermissionNeeded(true);setError('말하기 연습을 시작하려면 마이크 사용을 허용해 주세요.');return;
      }
      if(version!==requestVersion.current)return;
      const session=await createSession(mode,scenario.id);
      if(version!==requestVersion.current)return;
      router.push({pathname:'/sessions/[id]',params:{id:session.id,scenarioId:scenario.id}});
    } catch(cause) {if(version===requestVersion.current)setError(cause instanceof Error?cause.message:'연습을 시작할 수 없습니다.');}
    finally {if(version===requestVersion.current)setBusy(false);}
  }
  return <ScrollView contentContainerStyle={ui.page}>
    <Text style={ui.label}>{mode==='opic'?'OPIc PRACTICE':'EVERYDAY ENGLISH'}</Text>
    <Text style={ui.title}>{mode==='opic'?'나의 이야기를 영어로.':'일상에서 바로 쓰는 영어.'}</Text>
    <Text>{mode==='opic'?'질문을 고르고 나의 경험을 말해 보세요. 녹음 후 내용과 말하기 코칭을 받을 수 있습니다.':'상황에 맞게 말하고, 자연스러운 표현과 말하기 피드백을 확인하세요.'}</Text>
    {mode==='opic'?<View style={ui.card}><Text style={ui.label}>OPIc PLAYBOOK</Text><Text style={ui.cardTitle}>내 이야기를 잘 전달하는 6가지 방법</Text><Text>질문 파악부터 경험 연결, 다시 말하기까지 한 장씩 확인하세요.</Text><Button title="OPIc 노하우 보기" onPress={()=>router.push('/opic/guide')}/></View>:null}
    {mode==='opic'?<View style={ui.card}><Text style={ui.label}>OPIc MOCK TEST</Text><Text style={ui.cardTitle}>40분 실전 흐름으로 연습하기</Text><Text>관심 주제를 고르고 질문을 들으며 순서대로 답하세요. 피드백은 시험을 마친 뒤 확인합니다.</Text><Button variant="primary" title="모의시험 준비하기" onPress={()=>router.push('/opic/mock')}/></View>:null}
    <Text style={ui.cardTitle}>유형별 연습 · {items.length}개</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:8}}>{['all',...new Set(items.map(item=>item.topic??'general'))].map(value=><Pressable key={value} accessibilityRole="button" accessibilityState={{selected:topic===value}} onPress={()=>setTopic(value)} style={{padding:12,borderRadius:12,backgroundColor:topic===value?colors.mint:colors.elevated}}><Text style={{color:topic===value?colors.onMint:colors.text}}>{value==='all'?'모든 주제':topicLabels[value]??value}</Text></Pressable>)}</ScrollView>
    {mode==='opic'?<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:8}}>{['all',...new Set(items.map(item=>item.question_type??'situation'))].map(value=><Pressable key={value} accessibilityRole="button" accessibilityState={{selected:kind===value}} onPress={()=>setKind(value)} style={{padding:12,borderRadius:12,borderWidth:1,borderColor:kind===value?colors.mint:colors.border}}><Text>{value==='all'?'모든 유형':typeLabels[value]??value}</Text></Pressable>)}</ScrollView>:null}
    {loading&&<ActivityIndicator color={colors.mint}/>}
    {error?<Text style={ui.error} accessibilityRole="alert">{error}</Text>:null}
    {permissionNeeded&&<Button title="설정에서 마이크 권한 확인" onPress={()=>router.navigate('/settings')}/>}
    {!loading&&!error&&items.length>0&&!items.some(item=>(topic==='all'||(item.topic??'general')===topic)&&(kind==='all'||item.question_type===kind))?<Text>이 조건의 문항이 없습니다. 다른 주제나 유형을 선택해 주세요.</Text>:null}
    {!loading&&!error&&items.length===0&&<Text>아직 준비된 시나리오가 없습니다.</Text>}
    {items.filter(item=>(topic==='all'||(item.topic??'general')===topic)&&(kind==='all'||item.question_type===kind)).map(item=><View style={ui.card} key={item.id}><Text style={ui.label}>{item.level==='beginner'?'초급':'중급'}</Text><Text style={ui.cardTitle}>{item.title}</Text><Text>{item.prompt}</Text><Text>목표 · {item.goals.join(' · ')}</Text><Button variant="primary" title="이 주제로 연습하기" disabled={busy} onPress={()=>start(item)}/></View>)}
  </ScrollView>;
}
