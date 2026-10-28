import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { File } from 'expo-file-system';
import { FlowScreen } from '../../components/FlowScreen';
import { RecordingPlayback } from '../../components/RecordingPlayback';
import { Button, Text } from '../../components/ui';
import { accentLabels } from '../../lib/accent';
import { createSentenceAudio, getPracticeSentences, PracticeSentence } from '../../lib/api';
import { ensureMicrophoneAccess } from '../../lib/microphone';
import { colors, ui } from '../../lib/theme';

export default function Shadowing() {
  const {id}=useLocalSearchParams<{id:string}>();
  const [items,setItems]=useState<PracticeSentence[]>([]);
  const [accent,setAccent]=useState('');
  const [index,setIndex]=useState(0);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [voiceBusy,setVoiceBusy]=useState(false);
  const [speed,setSpeed]=useState(1);
  const [completed,setCompleted]=useState(false);
  const [recordings,setRecordings]=useState<Record<number,{uri:string;duration:number}>>({});
  const [playback,setPlayback]=useState<{url:string;label:string;key:number}|null>(null);
  const sequence=useRef(0);
  const focused=useRef(false);
  const files=useRef(new Set<string>());
  const recorder=useAudioRecorder({...RecordingPresets.HIGH_QUALITY,directory:'document'});
  const status=useAudioRecorderState(recorder);
  const current=items[index];
  const recording=recordings[index];
  const discard=(uri:string)=>{try{new File(uri).delete();}catch{/* Cache cleanup is best effort. */}};
  useEffect(()=>{
    let active=true;
    void getPracticeSentences(id).then(value=>{if(active){setItems(value.items);setAccent(accentLabels[value.accent]);}}).catch(cause=>{if(active)setError(cause.message);}).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;files.current.forEach(discard);};
  },[id]);
  useFocusEffect(useCallback(()=>{
    focused.current=true;
    return ()=>{
      focused.current=false;sequence.current++;setPlayback(null);
      if(recorder.isRecording)void recorder.stop().then(()=>{if(recorder.uri)discard(recorder.uri);return setAudioModeAsync({playsInSilentMode:true,allowsRecording:false});}).catch(()=>{});
    };
  },[recorder]));
  function changeSentence(next:number) {sequence.current++;setPlayback(null);setError('');setIndex(next);}
  async function listen() {
    if(!current)return;
    const operation=++sequence.current;
    setVoiceBusy(true);setError('');setPlayback(null);
    try {
      let guide=await createSentenceAudio(id,current.index);
      for(let attempt=0;guide.status==='processing'&&attempt<45;attempt++) {
        await new Promise(resolve=>setTimeout(resolve,2000));
        if(!focused.current||operation!==sequence.current||AppState.currentState!=='active')return;
        guide=await createSentenceAudio(id,current.index);
      }
      if(!focused.current||operation!==sequence.current)return;
      if(guide.status!=='ready'||!guide.playback_url)throw new Error('문장 음성을 준비하지 못했습니다. 잠시 후 다시 눌러 주세요.');
      setPlayback({url:guide.playback_url,label:'예문',key:operation});
    }catch(cause){if(focused.current&&operation===sequence.current)setError(cause instanceof Error?cause.message:'예문을 불러오지 못했습니다.');}
    finally{if(focused.current)setVoiceBusy(false);}
  }
  async function start() {
    setBusy(true);setError('');setPlayback(null);
    try {
      if(!await ensureMicrophoneAccess()){setError('따라 녹음하려면 마이크 사용을 허용해 주세요.');return;}
      if(!focused.current)return;
      await setAudioModeAsync({playsInSilentMode:true,allowsRecording:true});
      await recorder.prepareToRecordAsync();
      if(!focused.current){await recorder.stop();if(recorder.uri)discard(recorder.uri);return;}
      recorder.record();
    }catch{setError('녹음을 시작하지 못했습니다. 마이크 설정을 확인해 주세요.');}
    finally{setBusy(false);}
  }
  async function stop() {
    setBusy(true);
    try {
      const duration=status.durationMillis;
      await recorder.stop();
      await setAudioModeAsync({playsInSilentMode:true,allowsRecording:false});
      if(!recorder.uri||duration<1000){if(recorder.uri)discard(recorder.uri);throw new Error('1초 이상 말한 뒤 녹음을 마쳐 주세요.');}
      if(!focused.current){discard(recorder.uri);return;}
      if(recording){discard(recording.uri);files.current.delete(recording.uri);}
      files.current.add(recorder.uri);
      setRecordings(value=>({...value,[index]:{uri:recorder.uri!,duration}}));
    }catch(cause){if(focused.current)setError(cause instanceof Error?cause.message:'녹음을 저장하지 못했습니다.');}
    finally{setBusy(false);}
  }
  function leave() {
    Alert.alert('따라하기를 마칠까요?','이 연습의 비교 녹음은 화면을 나가면 삭제됩니다. 원래 코칭 기록은 남습니다.',[{text:'계속 연습',style:'cancel'},{text:'마치기',onPress:()=>router.back()}]);
  }
  return <FlowScreen key={completed?'complete':index} eyebrow="LISTEN · REPEAT · COMPARE" title={completed?'한 문장씩 끝까지 말했어요':loading?'따라할 문장을 준비해요':'듣고, 내 목소리로 따라해요'} step={!completed&&items.length?index+1:undefined} total={items.length||1} description={accent?`연습 기준 · ${accent}`:undefined} footer={completed?<><Button variant="primary" title="예문 코칭으로 돌아가기" onPress={()=>router.back()}/><Button title="다시 한 번 따라하기" onPress={()=>{setCompleted(false);changeSentence(0);}}/></>:current?<>
    <Button variant="primary" title={status.isRecording?'녹음 마치기':recording?'다시 따라 녹음하기':'따라 녹음하기'} loading={busy} disabled={voiceBusy} onPress={status.isRecording?stop:start}/>
    <Button title={index===items.length-1?'따라하기 완료':'다음 문장'} disabled={!recording||status.isRecording||busy||voiceBusy} onPress={()=>{setPlayback(null);if(index===items.length-1)setCompleted(true);else changeSentence(index+1);}}/>
  </>:<Button title="돌아가기" onPress={()=>router.back()}/>}>
    {loading?<ActivityIndicator color={colors.mint}/>:null}
    {error?<Text style={ui.error} accessibilityRole="alert">{error}</Text>:null}
    {completed?<><View style={ui.card}><Text style={ui.cardTitle}>{Object.keys(recordings).length}개 문장 연습 완료</Text><Text>강세와 끊어 읽기가 어떻게 달랐는지 떠올려 보세요. 다음에는 예문을 보지 않고 같은 뜻으로 말해 보세요.</Text></View><Text>이번 기능은 듣기와 비교 녹음 연습입니다. 발음 점수나 AI 평가는 제공하지 않습니다.</Text></>:current?<>
      <View style={ui.card}><Text style={ui.label}>따라 말할 문장</Text><Text style={ui.cardTitle}>{current.text}</Text></View>
      <Button title="1 · 예문 듣기" loading={voiceBusy} disabled={busy||status.isRecording} onPress={listen}/>
      <Button title={`예문 속도 ${speed}배`} disabled={status.isRecording} onPress={()=>setSpeed(value=>value===1?0.8:value===0.8?1.2:1)}/>
      <Text>{status.isRecording?`녹음 중 · ${Math.round(status.durationMillis/1000)}초`:'2 · 예문을 듣고 아래 버튼으로 따라 녹음하세요.'}</Text>
      {recording&&!status.isRecording?<><Button title="3 · 내 목소리 듣고 비교하기" disabled={busy||voiceBusy} onPress={()=>setPlayback({url:recording.uri,label:'내 녹음',key:++sequence.current})}/><Text>예문과 내 목소리를 번갈아 들으며 강세와 끊어 읽기 한 가지를 비교해 보세요.</Text></>:null}
      {playback?<View style={ui.card}><RecordingPlayback key={playback.key} url={playback.url} label={playback.label} playbackRate={playback.label==='예문'?speed:1} startMs={0} endMs={null} onError={setError} onClose={()=>setPlayback(null)}/></View>:null}
      {index>0?<Button variant="quiet" title="이전 문장" disabled={busy||voiceBusy||status.isRecording} onPress={()=>changeSentence(index-1)}/>:null}
      <Text>비교 녹음은 이 기기에만 잠시 보관하고 화면을 나가면 삭제합니다. AI 음성은 선택한 영어 기준으로 생성되며 실제 억양은 다를 수 있습니다. 한 번에 최대 12문장을 연습합니다.</Text>
      <Button variant="quiet" title="따라하기 마치기" disabled={busy||status.isRecording} onPress={leave}/>
    </>:!loading?<Text>따라할 예문이 없습니다. 코칭 결과를 다시 확인해 주세요.</Text>:null}
  </FlowScreen>;
}
