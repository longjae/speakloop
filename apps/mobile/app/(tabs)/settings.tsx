import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, ScrollView, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { AccentSelector } from '../../components/AccentSelector';
import { Button, Text } from '../../components/ui';
import { Accent, loadAccent, saveAccent } from '../../lib/accent';
import { useAuth } from '../../lib/auth-context';
import { ensureMicrophoneAccess, getMicrophonePermission, MicrophonePermission, openMicrophoneSettings } from '../../lib/microphone';
import { supabase } from '../../lib/supabase';
import { ui } from '../../lib/theme';

export default function Settings() {
  const {session}=useAuth();
  const [accent,setAccent]=useState<Accent>('en-US');
  const [accentLoading,setAccentLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [permission,setPermission]=useState<MicrophonePermission|null>(null);
  const [micLoading,setMicLoading]=useState(true);
  const [micBusy,setMicBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const [signingOut,setSigningOut]=useState(false);
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;};},[]);
  const refreshMic=useCallback(async()=>{
    try {const value=await getMicrophonePermission();if(mounted.current){setPermission(value);if(value.granted)setMessage(current=>current==='마이크 사용을 허용한 뒤 돌아와 주세요.'?'마이크 사용이 허용됐습니다.':current);}}
    catch {if(mounted.current){setPermission(null);setError('마이크 권한을 확인하지 못했습니다. 다시 확인해 주세요.');}}
    finally {if(mounted.current)setMicLoading(false);}
  },[]);
  useFocusEffect(useCallback(()=>{
    let active=true;setAccentLoading(true);
    loadAccent().then(value=>{if(active)setAccent(value);}).catch(()=>{if(active)setError('영어 설정을 불러오지 못했습니다.');}).finally(()=>{if(active)setAccentLoading(false);});
    void refreshMic();
    return ()=>{active=false;};
  },[refreshMic]));
  useEffect(()=>{
    const subscription=AppState.addEventListener('change',state=>{if(state==='active')void refreshMic();});
    return ()=>subscription.remove();
  },[refreshMic]);
  async function changeAccent(value:Accent) {
    setSaving(true);setMessage('');setError('');
    try {await saveAccent(value);if(mounted.current){setAccent(value);setMessage('영어 기준을 저장했습니다. 다음 코칭과 예문 듣기에 적용됩니다.');}}
    catch {if(mounted.current)setError('설정을 저장하지 못했습니다. 다시 선택해 주세요.');}
    finally {if(mounted.current)setSaving(false);}
  }
  async function allowMicrophone() {
    setMicBusy(true);setMessage('');setError('');
    try {
      const granted=await ensureMicrophoneAccess(true);
      await refreshMic();
      if(mounted.current)setMessage(granted?'마이크 사용이 허용됐습니다. 오픽과 일상 회화를 시작할 수 있습니다.':'마이크 사용을 허용한 뒤 돌아와 주세요.');
    } catch {if(mounted.current)setError('마이크 권한을 변경하지 못했습니다. 기기 설정에서 확인해 주세요.');}
    finally {if(mounted.current)setMicBusy(false);}
  }
  async function signOut() {
    setSigningOut(true);setError('');
    try {const result=await supabase?.auth.signOut();if(result?.error)throw result.error;}
    catch {if(mounted.current)setError('로그아웃하지 못했습니다. 다시 시도해 주세요.');}
    finally {if(mounted.current)setSigningOut(false);}
  }
  const micStatus=micLoading?'확인 중':permission?.granted?'허용됨':permission?.status==='unavailable'?'모바일 앱에서 사용':permission?'허용 필요':'확인 필요';
  return <ScrollView contentContainerStyle={ui.page}>
    <Text style={ui.label}>PREFERENCES</Text><Text style={ui.title}>나에게 맞는 연습 설정</Text>
    <View style={ui.card}><AccentSelector value={accent} onChange={changeAccent} disabled={accentLoading||saving}/><Text>이 기기에 선택을 기억합니다. 이미 생성한 피드백은 당시의 영어 기준을 유지합니다.</Text></View>
    <View style={ui.card}><Text style={ui.cardTitle}>마이크 사용</Text><Text accessibilityLiveRegion="polite">상태 · {micStatus}</Text><Text>말하기 연습에는 마이크가 필요합니다. 허용하지 않아도 시나리오와 이전 기록은 볼 수 있습니다. 연습을 시작할 때도 권한을 확인합니다.</Text>
      <Button variant="primary" title={permission?.granted?'마이크 허용됨':permission&&!permission.canAskAgain?'기기 설정에서 마이크 허용':'마이크 사용 허용'} loading={micBusy} disabled={micLoading||!permission||permission.granted||Platform.OS==='web'} onPress={allowMicrophone}/>
      {!permission&&<Button title="권한 다시 확인" onPress={refreshMic}/>}
      {Platform.OS!=='web'&&<Button variant="quiet" title="기기 권한 관리" onPress={()=>{void openMicrophoneSettings().catch(()=>setError('기기 설정을 열지 못했습니다.'));}}/>}
    </View>
    <View style={ui.card}><Text style={ui.cardTitle}>계정</Text><Text>{session?.user.email??'로그인됨'}</Text><Button title="로그아웃" loading={signingOut} onPress={signOut}/></View>
    {message?<Text accessibilityLiveRegion="polite">{message}</Text>:null}
    {error?<Text style={ui.error} accessibilityRole="alert">{error}</Text>:null}
  </ScrollView>;
}
