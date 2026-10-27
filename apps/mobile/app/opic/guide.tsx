import { useState } from 'react';
import { Linking, View } from 'react-native';
import { router } from 'expo-router';
import { FlowScreen } from '../../components/FlowScreen';
import { Button, Text } from '../../components/ui';
import { opicSources, opicTips } from '../../lib/opic-guide';
import { ui } from '../../lib/theme';

export default function OpicGuide() {
  const [index,setIndex]=useState(0);
  const [error,setError]=useState('');
  const tip=opicTips[index];
  return <FlowScreen key={index} eyebrow="OPIc PLAYBOOK" title={tip.title} step={index+1} total={opicTips.length} description="SpeakLoop의 말하기 연습 가이드" footer={<>
    <Button variant="primary" title={index===opicTips.length-1?'주제 골라서 연습하기':'다음 노하우'} onPress={()=>index===opicTips.length-1?router.dismissTo('/opic'):setIndex(index+1)}/>
    {index>0?<Button variant="quiet" title="이전 노하우" onPress={()=>setIndex(index-1)}/>:null}
  </>}>
    <Text>{tip.body}</Text>
    <View style={ui.card}><Text style={ui.label}>말하기 예시</Text><Text style={ui.cardTitle}>{tip.example}</Text></View>
    <View style={ui.card}><Text style={ui.label}>오늘 해볼 일</Text><Text>{tip.practice}</Text></View>
    {index===0?<Text>공식 OPIc은 질문 수행, 정확성과 이해 가능성, 내용·맥락, 발화의 양과 구성을 종합적으로 평가합니다. 이 앱의 코칭은 공인 등급 평가가 아닙니다.</Text>:null}
    {index===opicTips.length-1?<View style={ui.card}><Text>위 연습법은 공식 기준을 참고해 앱에서 제안한 방법입니다. 정해진 답변 길이나 특정 표현만으로 등급을 보장하지 않습니다.</Text>{opicSources.map(source=><Button key={source.url} variant="quiet" title={source.title} onPress={()=>{setError('');void Linking.openURL(source.url).catch(()=>setError('공식 안내를 열지 못했습니다. 잠시 후 다시 눌러 주세요.'));}}/>)}</View>:null}
    {error?<Text style={ui.error}>{error}</Text>:null}
  </FlowScreen>;
}
