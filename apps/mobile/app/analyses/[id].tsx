import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Button, Text } from '../../components/ui';
import { RecordingPlayback } from '../../components/RecordingPlayback';
import { accentLabels } from '../../lib/accent';
import { colors, ui } from '../../lib/theme';
import { Analysis, createAudioGuide, deleteAnalysis, getAnalysis, getAudioGuide, getAnalysisRecording, startAnalysis } from '../../lib/api';

const audioCategories:Record<string,string>={pronunciation:'발음·전달력',intonation:'강세·억양',pace:'말하기 속도',pauses:'멈춤·호흡'};
const confidenceLabels:Record<string,string>={low:'확신 낮음',medium:'확신 보통',high:'확신 높음'};
const categories: Record<string, string> = { grammar:'문법',vocabulary:'어휘',structure:'구성',relevance:'상황 적합성',naturalness:'자연스러운 표현' };

export default function AnalysisDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [analysis,setAnalysis]=useState<Analysis|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [voiceBusy,setVoiceBusy]=useState(false);
  const [voiceMessage,setVoiceMessage]=useState('');
  const [speed,setSpeed]=useState(1);
  const [guideUrl,setGuideUrl]=useState<string|null>(null);
  const [originalBusy,setOriginalBusy]=useState(false);
  const [clip,setClip]=useState<{url:string;startMs:number;endMs:number|null;key:number}|null>(null);
  const clipSequence=useRef(0);
  async function listenOriginal(startMs=0,endMs:number|null=null) {
    setOriginalBusy(true);setError('');player.pause();setGuideUrl(null);
    try {
      const result=await getAnalysisRecording(id);
      if(mounted.current)setClip({url:result.playback_url,startMs,endMs,key:++clipSequence.current});
    } catch(cause) { if(mounted.current)setError(cause instanceof Error?cause.message:'녹음을 불러오지 못했습니다.'); }
    finally { if(mounted.current)setOriginalBusy(false); }
  }

  const mounted=useRef(true);
  useEffect(()=>{ mounted.current=true;return ()=>{mounted.current=false;}; },[]);
  const player=useAudioPlayer(null);
  const playback=useAudioPlayerStatus(player);
  const guideStarted=useRef(false);

  useEffect(()=>{
    let disposed=false;
    let inFlight=false;
    let complete=false;
    let checks=0;
    async function refresh() {
      if (disposed || inFlight || AppState.currentState!=='active') return;
      inFlight=true;
      try {
        const value=await getAnalysis(id);
        if (!disposed) { setAnalysis(value); setError(''); }
        complete=value.status!=='processing';
      } catch(cause) { if (!disposed) setError(cause instanceof Error?cause.message:'분석을 불러올 수 없습니다.'); }
      finally { inFlight=false; }
    }
    void refresh();
    const interval=setInterval(()=>{ if (!complete && checks++<72) void refresh(); },2500);
    const subscription=AppState.addEventListener('change',state=>{ if(state==='active') { checks=0; void refresh(); } });
    return ()=>{ disposed=true;clearInterval(interval);subscription.remove(); };
  },[id,analysis?.status]);

  useEffect(()=>{
    if (!guideUrl) return;
    guideStarted.current=false;
    player.replace({ uri:guideUrl });
  },[guideUrl,player]);
  useEffect(()=>{
    if (!playback.isLoaded || !guideUrl || guideStarted.current) return;
    guideStarted.current=true;
    void setAudioModeAsync({playsInSilentMode:true,allowsRecording:false}).then(()=>{if(mounted.current)player.play();}).catch(()=>setVoiceMessage('음성을 재생하지 못했습니다. 다시 눌러 주세요.'));
  },[playback.isLoaded,guideUrl,player]);
  useEffect(()=>{ if(playback.isLoaded) player.setPlaybackRate(speed); },[playback.isLoaded,speed,player]);

  useEffect(()=>{if(playback.error)setVoiceMessage('AI 음성을 불러오지 못했습니다. 듣기를 다시 눌러 주세요.');},[playback.error]);

  async function retry() {
    if (!analysis) return;
    setBusy(true);setError('');
    try { const result=await startAnalysis(analysis.session_id,analysis.utterance_id,analysis.accent);if(result.id!==id)router.replace({pathname:'/analyses/[id]',params:{id:result.id}});else setAnalysis(result); }
    catch(cause) { setError(cause instanceof Error?cause.message:'분석에 실패했습니다.'); }
    finally { setBusy(false); }
  }

  async function listen() {
    if (!analysis) return;
    if (playback.playing) { player.pause(); return; }
    setClip(null);
    setVoiceBusy(true);setVoiceMessage('AI 음성 예문을 준비하고 있습니다…');
    try {
      let guide=await createAudioGuide(analysis.id);
      if (!mounted.current) return;
      // A concurrent request can already be generating the cached guide.
      for(let i=0;guide.status==='processing' && i<45;i++) {
        await new Promise(resolve=>setTimeout(resolve,2000));
        if (!mounted.current) return;
        if (AppState.currentState!=='active') { setVoiceMessage('앱에 돌아오면 듣기를 다시 눌러 주세요.');return; }
        guide=await getAudioGuide(analysis.id);
      }
      if (!mounted.current) return;
      if (guide.status!=='ready' || !guide.playback_url) throw new Error('음성을 준비하지 못했습니다. 텍스트 예문으로 연습하거나 다시 눌러 주세요.');
      if (guideUrl===guide.playback_url) { await player.seekTo(0);player.setPlaybackRate(speed);player.play(); }
      else setGuideUrl(guide.playback_url);
      setVoiceMessage(analysis.input_source==='audio_original'?`${accentLabels[analysis.accent]}로 생성한 AI 음성입니다.`:'AI가 생성한 예문 음성입니다.');
    } catch(cause) { setVoiceMessage(cause instanceof Error?cause.message:'음성을 재생할 수 없습니다. 텍스트 예문으로 연습해 주세요.'); }
    finally { setVoiceBusy(false); }
  }
  function changeSpeed() { const next=speed===1?0.8:speed===0.8?1.2:1;setSpeed(next);player.setPlaybackRate(next); }
  function remove() {
    Alert.alert('이 피드백을 삭제할까요?','피드백과 AI 음성이 삭제됩니다. 원본 녹음과 전사는 연습 기록에 남습니다.',[
      {text:'취소',style:'cancel'},
      {text:'삭제',style:'destructive',onPress:()=>{setBusy(true);deleteAnalysis(id).then(()=>router.back()).catch(cause=>setError(cause.message)).finally(()=>setBusy(false));}},
    ]);
  }
  const feedback=analysis?.feedback_json;
  return <ScrollView contentContainerStyle={ui.page}>
    <Text style={ui.label}>{analysis?.mode==='opic'?'OPIc COACHING':'DAILY COACHING'}</Text>
    <Text style={ui.title}>나의 말하기 피드백</Text>
    {analysis?.input_source==='audio_original'?<Text>원본 녹음과 원본 전사를 함께 분석했습니다. 오디오 코칭은 AI의 관찰이며 공인 발음 점수나 공식 등급이 아닙니다.</Text>:<Text>이 기록은 이전의 전사 기반 코칭입니다. 새 코칭에서는 녹음도 함께 분석합니다.</Text>}
    {analysis?.input_source==='audio_original'&&<Text>연습 기준 · {accentLabels[analysis.accent??'en-US']}</Text>}
    {analysis&&<Button title="원본 녹음 듣기" loading={originalBusy} onPress={()=>listenOriginal()}/>}
    {clip&&<View style={ui.card}><RecordingPlayback key={clip.key} url={clip.url} startMs={clip.startMs} endMs={clip.endMs} onError={setError} onClose={()=>setClip(null)}/></View>}
    {error ? <Text accessibilityRole="alert" style={ui.error}>{error}</Text> : null}
    {!analysis && !error && <ActivityIndicator color={colors.mint} />}
    {analysis?.status==='processing' && <View style={ui.card}><ActivityIndicator color={colors.mint}/><Text>발화 내용을 분석하고 있습니다. 잠시 후 이 화면에서 결과를 확인해 주세요.</Text><Button title="진행 상태 확인" onPress={()=>getAnalysis(id).then(setAnalysis).catch(cause=>setError(cause.message))}/></View>}
    {analysis?.status==='failed' && <View style={ui.card}><Text>분석을 완료하지 못했습니다. 원본은 보존되어 있습니다.</Text><Button variant="primary" title="분석 다시 시도" loading={busy} onPress={retry}/></View>}
    {analysis?.status==='ready' && feedback && <>
      <View style={ui.card}><Text style={ui.label}>오늘의 피드백</Text><Text style={ui.cardTitle}>{feedback.summary}</Text></View>
{feedback.audio_quality_note&&<View style={ui.card}><Text style={ui.label}>녹음 확인</Text><Text>{feedback.audio_quality_note}</Text>{feedback.transcript_alignment==='mismatch'&&<Text style={ui.error}>전사와 녹음이 다르게 들려 문장 교정은 보류했습니다. 다시 녹음·전사해 주세요.</Text>}</View>}
      {feedback.audio_observations&&<><Text style={ui.cardTitle}>목소리에서 들린 특징</Text><Text>구간과 관찰은 AI 추정입니다. 원본을 들어보며 확인해 주세요.</Text>{feedback.audio_observations.length===0&&<Text>확실하게 판단할 수 있는 음성 특징이 없어 피드백을 보류했습니다.</Text>}{feedback.audio_observations.map((item,index)=><View style={ui.card} key={index}><Text style={ui.label}>{audioCategories[item.category]} · {confidenceLabels[item.confidence]}</Text><Text style={styles.body}>{item.observation}</Text><Text>{item.practice_tip}</Text><Button title={`약 ${(item.start_ms/1000).toFixed(1)}~${(item.end_ms/1000).toFixed(1)}초 원본 듣기`} disabled={originalBusy} onPress={()=>listenOriginal(item.start_ms,item.end_ms)}/></View>)}</>}
      <Text style={ui.cardTitle}>잘한 점</Text>
      {feedback.strengths.length===0&&<Text>명확한 근거가 부족해 판단을 보류했습니다.</Text>}
      {feedback.strengths.map((item,index)=><View style={ui.card} key={index}><Text style={styles.body}>{item.text}</Text><Text>“{item.evidence}”</Text></View>)}
      <Text style={ui.cardTitle}>다음에 다듬을 부분</Text>
      {feedback.improvements.length===0 && <Text>확실한 근거가 있는 문장 교정은 없습니다. 다음 연습 안내를 확인해 주세요.</Text>}
      {feedback.improvements.map((item,index)=><View style={ui.card} key={index}><Text style={ui.label}>{categories[item.category]??item.category}</Text><Text>말한 표현 · {item.original}</Text><Text style={styles.corrected}>{item.corrected}</Text><Text>{item.reason}</Text></View>)}
      <View style={ui.card}><Text style={ui.cardTitle}>이렇게 말해볼까요?</Text><Text style={styles.example}>{feedback.improved_example}</Text><Text>학습을 위한 개선 예문입니다. 실제 발화 원본과 구분됩니다.</Text><Button variant="primary" title={playback.playing?'음성 일시정지':'AI 예문 듣기'} loading={voiceBusy} onPress={listen}/><Button title={`재생 속도 ${speed}배`} onPress={changeSpeed}/>{voiceMessage?<Text accessibilityLiveRegion="polite">{voiceMessage}</Text>:null}</View>
      <View style={ui.card}><Text style={ui.cardTitle}>다음 연습</Text><Text>{feedback.next_practice}</Text><Button title="연습 화면으로 돌아가기" onPress={()=>router.back()}/></View>
    </>}
    {analysis && <View style={ui.card}><Text style={ui.label}>분석에 사용한 원본 전사</Text><Text>{analysis.input_text}</Text></View>}
    {analysis && <Button variant="quiet" title="이 피드백 삭제" disabled={busy || analysis.status==='processing'} onPress={remove}/>}
  </ScrollView>;
}
const styles=StyleSheet.create({body:{color:colors.text},corrected:{color:colors.mint,fontSize:18,lineHeight:28},example:{color:colors.text,fontSize:20,lineHeight:32}});
