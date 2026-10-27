import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { FlowScreen } from '../../../components/FlowScreen';
import { Button, Text } from '../../../components/ui';
import { startAnalysis } from '../../../lib/api';
import { colors, ui } from '../../../lib/theme';

export default function PreparingCoaching() {
  const {id,utteranceId,accent}=useLocalSearchParams<{id:string;utteranceId:string;accent:string}>();
  const [error,setError]=useState('');
  const [attempt,setAttempt]=useState(0);
  const inFlight=useRef<ReturnType<typeof startAnalysis>|null>(null);
  useFocusEffect(useCallback(()=>{
    let active=true;setError('');
    if(!utteranceId||(accent!=='en-US'&&accent!=='en-GB')){setError('연습 정보를 확인하지 못했습니다. 전사 화면으로 돌아가 다시 시작해 주세요.');return;}
    // Share the request across focus changes. The server also reserves idempotently.
    inFlight.current??=startAnalysis(id,utteranceId,accent);
    void inFlight.current.then(result=>{if(active)router.replace({pathname:'/feedback/[id]/[step]',params:{id:result.id,step:'overview'}});}).catch(cause=>{inFlight.current=null;if(active)setError(cause instanceof Error?cause.message:'코칭을 시작하지 못했습니다.');});
    return ()=>{active=false;};
  },[id,utteranceId,accent,attempt]));
  return <FlowScreen eyebrow="COACHING" title={error?'잠시 멈췄어요':'나의 녹음을 듣고 있어요'} description="답변 내용과 말하기 특징을 살펴본 뒤, 하나씩 안내해 드릴게요." footer={<Button variant="quiet" title="연습 기록으로 돌아가기" onPress={()=>router.dismissTo({pathname:'/sessions/[id]',params:{id}})}/>}>
    {error?<View style={ui.card}><Text style={ui.error} accessibilityRole="alert">{error}</Text><Button variant="primary" title="다시 시도" onPress={()=>setAttempt(value=>value+1)}/></View>:<View style={ui.card}><ActivityIndicator size="large" color={colors.mint}/><Text accessibilityLiveRegion="polite">분석이 끝나면 핵심 평가 화면으로 이동합니다.</Text><Text>원본 확인 → 목소리 관찰 → 표현 다듬기</Text><Text>화면을 나가도 서버 처리는 계속될 수 있습니다. 다시 들어오면 기존 분석을 확인합니다.</Text></View>}
  </FlowScreen>;
}
