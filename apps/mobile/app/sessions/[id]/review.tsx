import { useCallback, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { FlowScreen } from '../../../components/FlowScreen';
import { Button, Text, TextInput } from '../../../components/ui';
import { accentLabels, Accent, loadAccent } from '../../../lib/accent';
import { editTranscript, listUtterances, Utterance } from '../../../lib/api';
import { colors, ui } from '../../../lib/theme';

export default function TranscriptReview() {
  const {id,utteranceId}=useLocalSearchParams<{id:string;utteranceId?:string}>();
  const [utterance,setUtterance]=useState<Utterance|null>(null);
  const [accent,setAccent]=useState<Accent|null>(null);
  const [loading,setLoading]=useState(true);
  const [editing,setEditing]=useState(false);
  const [text,setText]=useState('');
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [reload,setReload]=useState(0);
  useFocusEffect(useCallback(()=>{
    let active=true;setLoading(true);setError('');
    void Promise.all([listUtterances(id),loadAccent()]).then(([result,preference])=>{
      if(!active)return;
      const item=utteranceId?result.items.find(value=>value.id===utteranceId):result.items[0];
      if(!item)throw new Error('전사를 찾지 못했습니다. 연습 화면에서 녹음을 제출해 주세요.');
      setUtterance(item);setText(item.transcript_edited??item.transcript_raw??'');setAccent(preference);
    }).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'전사를 불러오지 못했습니다.');}).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[id,utteranceId,reload]));
  async function save() {
    if(!utterance)return;
    setSaving(true);setMessage('');setError('');
    try {
      const result=await editTranscript(utterance.id,text);
      setUtterance({...utterance,transcript_edited:result.transcript_edited});
      setText(result.transcript_edited);setEditing(false);setMessage('개인 확인용 수정본을 저장했습니다. 코칭은 원본 녹음과 원본 전사를 사용합니다.');
    }catch(cause){setError(cause instanceof Error?cause.message:'수정본을 저장하지 못했습니다.');}
    finally{setSaving(false);}
  }
  return <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':undefined}><FlowScreen eyebrow="RECORDING → COACHING" title="말한 내용을 확인해요" description="녹음 업로드와 전사가 끝났습니다. 이제 원본을 바탕으로 코칭을 받을 수 있어요." footer={<>
    <Button variant="primary" title="다음 · 녹음 분석하기" disabled={loading||saving||!accent||utterance?.stt_status!=='ready'} onPress={()=>{if(utterance&&accent)router.push({pathname:'/sessions/[id]/coaching',params:{id,utteranceId:utterance.id,accent}});}}/>
    <Button variant="quiet" title="다시 녹음할래요" disabled={saving} onPress={()=>router.dismissTo({pathname:'/sessions/[id]',params:{id}})}/>
  </>}>
    {loading?<ActivityIndicator color={colors.mint}/>:null}
    {error?<><Text style={ui.error} accessibilityRole="alert">{error}</Text><Button title="다시 확인" onPress={()=>setReload(value=>value+1)}/></>:null}
    {utterance?<>
      <View style={ui.card}><Text style={ui.label}>원본 전사</Text><Text style={ui.cardTitle}>{utterance.transcript_raw||'인식한 말이 없습니다. 다시 녹음해 주세요.'}</Text></View>
      {accent?<Text>연습 기준 · {accentLabels[accent]}</Text>:null}
      <Text>평가에는 원본 녹음과 원본 전사를 함께 사용합니다. 인식 오류를 수정해도 평가 입력은 바뀌지 않습니다.</Text>
      {editing?<View style={ui.card}><Text style={ui.label}>개인 확인용 수정본</Text><TextInput multiline accessibilityLabel="전사 수정" value={text} onChangeText={setText} style={{minHeight:140}}/><Button title="수정본 저장" loading={saving} disabled={!text.trim()} onPress={save}/><Button title="수정 취소" disabled={saving} variant="quiet" onPress={()=>{setText(utterance.transcript_edited??utterance.transcript_raw??'');setEditing(false);}}/></View>:<Button title="인식 오류 수정하기 (선택)" variant="quiet" onPress={()=>setEditing(true)}/>}
      {message?<Text accessibilityLiveRegion="polite">{message}</Text>:null}
      {!editing&&utterance.transcript_edited?<View style={ui.card}><Text style={ui.label}>저장된 수정본</Text><Text>{utterance.transcript_edited}</Text></View>:null}
    </>:null}
  </FlowScreen></KeyboardAvoidingView>;
}
