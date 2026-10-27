import { Button, Text } from '../../components/ui';
import { Accent, accentLabels, loadAccent } from '../../lib/accent';
import { colors, ui } from '../../lib/theme';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, StyleSheet, View } from 'react-native';
import { RecordingPresets, setAudioModeAsync, useAudioPlayer, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { File } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { getScenario, getSession, listUtterances, PracticeSession, reserveUpload, Scenario, transcribeUpload, Utterance } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { Analysis, deleteSession, listAnalyses } from '../../lib/api';
import { FlowScreen } from '../../components/FlowScreen';
import { ensureMicrophoneAccess } from '../../lib/microphone';

export default function SessionDetail() {
  const { id, scenarioId } = useLocalSearchParams<{ id: string; scenarioId?: string }>();
  const [session, setSession] = useState<PracticeSession | null>(null);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [error, setError] = useState('');
  const [recordingUri, setRecordingUri] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [utterance, setUtterance] = useState<Utterance | null>(null);
  const [uploadedId, setUploadedId] = useState<string | null>(null);
  const [uploadMessage, setUploadMessage] = useState('');
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [showHistory,setShowHistory]=useState(false);
  const [accent,setAccent] = useState<Accent|null>(null);
  const [accentLoading,setAccentLoading] = useState(true);
  useFocusEffect(useCallback(()=>{
    let active=true;setAccentLoading(true);
    loadAccent().then(value=>{if(active)setAccent(value);}).catch(()=>{if(active){setAccent(null);setError('영어 설정을 불러오지 못했습니다. 설정 탭에서 다시 선택해 주세요.');}}).finally(()=>{if(active)setAccentLoading(false);});
    return ()=>{active=false;};
  },[]));

  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, directory: 'document' });
  const recorderState = useAudioRecorderState(recorder);
  const player = useAudioPlayer(null);
  const focused=useRef(false);
  useFocusEffect(useCallback(()=>{
    focused.current=true;
    return ()=>{
      focused.current=false;player.pause();
      if(recorder.isRecording)void recorder.stop().then(()=>setAudioModeAsync({playsInSilentMode:true,allowsRecording:false})).catch(()=>{});
    };
  },[player,recorder]));

  useEffect(() => {
    if (!id) return;
    getSession(id).then(value => {
      setSession(value);
      const selectedScenario = scenarioId ?? value.scenario_id;
      if (selectedScenario) getScenario(selectedScenario).then(setScenario).catch(() => setError('시나리오를 불러올 수 없습니다.'));
      listUtterances(id).then(result => {
        const latest = result.items[0];
        if (latest) {
          setUtterance(latest);
        }
      }).catch(() => {});
    }).catch(cause => setError(cause instanceof Error ? cause.message : '세션을 불러올 수 없습니다.'));
  }, [id]);

  useEffect(() => {
    player.replace(recordingUri ? { uri: recordingUri } : null);
  }, [player, recordingUri]);

  useFocusEffect(useCallback(() => {
    if (id) listAnalyses(id).then(result => setAnalyses(result.items)).catch(() => setError('피드백 이력을 불러오지 못했습니다. 다시 들어와 주세요.'));
  }, [id]));

  function removeSession() {
    Alert.alert('연습 기록을 삭제할까요?', '녹음, 전사, 피드백과 AI 음성이 함께 삭제됩니다.', [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: () => { setBusy(true); deleteSession(id).then(() => router.replace('/dashboard')).catch(cause => setError(cause.message)).finally(() => setBusy(false)); } },
    ]);
  }

  async function startRecording() {
    setBusy(true);
    setError('');
    try {
      if (!await ensureMicrophoneAccess()) { setError('마이크 사용을 허용한 뒤 녹음을 다시 시작해 주세요. 설정 탭에서도 확인할 수 있습니다.'); return; }
      if(!focused.current)return;
      player.pause();
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      setRecordingUri(null);
      setUploadedId(null);
      setUploadMessage('');
      setUtterance(null);
      setDurationMs(0);
      await recorder.prepareToRecordAsync();
      if(!focused.current){await recorder.stop();await setAudioModeAsync({playsInSilentMode:true,allowsRecording:false});return;}
      recorder.record();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '녹음을 시작할 수 없습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function stopRecording() {
    setBusy(true);
    setError('');
    try {
      const elapsed = recorderState.durationMillis;
      await recorder.stop();
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
      if (!recorder.uri || elapsed < 1000) throw new Error('녹음이 너무 짧습니다. 1초 이상 말해 주세요.');
      setRecordingUri(recorder.uri);
      setDurationMs(elapsed);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '녹음을 저장할 수 없습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function playRecording() {
    if (!recordingUri) return;
    try {
      await setAudioModeAsync({playsInSilentMode:true,allowsRecording:false});
      await player.seekTo(0);
      player.play();
    } catch {
      setError('녹음을 재생할 수 없습니다. 다시 녹음해 주세요.');
    }
  }

  async function submitRecording() {
    if (!recordingUri || !id || !supabase) return;
    setBusy(true);
    setError('');
    setUploadMessage('녹음을 업로드하고 있습니다…');
    try {
      let uploadId = uploadedId;
      if (!uploadId) {
        const file = new File(recordingUri);
        const bytes = new Uint8Array(await file.arrayBuffer());
        const reservation = await reserveUpload(id, bytes.byteLength, durationMs, randomUUID());
        const result = await supabase.storage.from('recordings').upload(reservation.path, bytes, { contentType: 'audio/mp4', upsert: false });
        if (result.error) throw new Error('녹음 업로드에 실패했습니다. 다시 시도해 주세요.');
        uploadId = reservation.upload_id;
        setUploadedId(uploadId);
      }
      setUploadMessage('업로드 완료. 영어 전사를 만들고 있습니다…');
      const resultUtterance = await transcribeUpload(id, uploadId);
      setUtterance(resultUtterance);
      player.pause();
      if(resultUtterance.stt_status==='ready'&&focused.current)router.push({pathname:'/sessions/[id]/review',params:{id,utteranceId:resultUtterance.id}});
      setUploadMessage(resultUtterance.transcript_raw ? '업로드와 영어 전사가 완료됐습니다.' : '업로드는 완료됐지만 음성을 인식하지 못했습니다. 다시 녹음해 주세요.');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '전사를 완료할 수 없습니다.';
      setError(message);
      setUploadMessage(`처리 실패: ${message} 제출 버튼을 눌러 다시 시도해 주세요.`);
    } finally {
      setBusy(false);
    }
  }

  return <FlowScreen eyebrow={session?.mode==='opic'?'OPIc · RECORDING':'DAILY · RECORDING'} title={scenario?.title??'나의 목소리로 말해요'} description={accentLoading?'영어 설정 확인 중':accent?`연습 기준 · ${accentLabels[accent]}`:'설정 탭에서 영어 기준을 확인해 주세요.'} footer={session&&Platform.OS!=='web'?<>
    {recorderState.isRecording?<Button variant="primary" title="녹음 마치기" loading={busy} onPress={stopRecording}/>:recordingUri?<>
      <Button variant="primary" title={utterance?.stt_status==='ready'?'다음 · 전사 확인':'다음 · 녹음 제출하고 전사 확인'} loading={busy} onPress={()=>utterance?.stt_status==='ready'?router.push({pathname:'/sessions/[id]/review',params:{id,utteranceId:utterance.id}}):submitRecording()}/>
      <Button variant="quiet" title="다시 녹음하기" disabled={busy} onPress={startRecording}/>
    </>:<Button variant="primary" title={utterance?'새로 녹음하기':'녹음 시작'} loading={busy} onPress={startRecording}/>}
  </>:undefined}>
    {!session&&!error?<ActivityIndicator color={colors.mint}/>:null}
    {error?<Text style={ui.error} accessibilityRole="alert">{error}</Text>:null}
    {session?<>
      {scenario?<View style={ui.card}><Text style={ui.label}>오늘의 질문</Text><Text style={styles.prompt}>{scenario.prompt}</Text><Text>목표 · {scenario.goals.join(' · ')}</Text></View>:null}
      {Platform.OS==='web'?<Text>녹음은 Android·iOS 앱에서 이용해 주세요.</Text>:<>
        <View style={ui.card}><Text style={ui.label}>{recorderState.isRecording?'지금 녹음 중':recordingUri?'녹음 완료':'READY TO SPEAK'}</Text><Text style={styles.timer}>{Math.round((recorderState.isRecording?recorderState.durationMillis:durationMs)/1000)}초</Text><Text>{recorderState.isRecording?'질문에 맞춰 나의 경험을 편하게 말해 보세요.':recordingUri?'내 녹음을 확인하거나 다음 화면에서 전사를 살펴보세요.':'녹음이 끝나면 전사 확인과 코칭 화면으로 이어집니다.'}</Text></View>
        {recordingUri&&!recorderState.isRecording?<Button title="방금 녹음한 내용 듣기" disabled={busy} onPress={playRecording}/>:null}
        {uploadMessage?<Text style={styles.notice} accessibilityLiveRegion="polite">{uploadMessage}</Text>:null}
        <Text>녹음은 먼저 기기에 저장됩니다. 제출하면 비공개 저장소에 보관하고, 전사와 코칭을 위해 Google Vertex AI로 보냅니다.</Text>
      </>}
      {utterance&&!recordingUri&&!recorderState.isRecording?<Button title="이전 전사 확인하고 코칭받기" disabled={busy} onPress={()=>router.push({pathname:'/sessions/[id]/review',params:{id,utteranceId:utterance.id}})}/>:null}
      {analyses.length>0?<><Button title={`이전 피드백 ${analyses.length}개 ${showHistory?'접기':'보기'}`} variant="quiet" disabled={busy||recorderState.isRecording} onPress={()=>setShowHistory(value=>!value)}/>{showHistory?analyses.map(item=><Button key={item.id} title={`${new Date(item.created_at).toLocaleDateString('ko-KR')} · ${item.input_source==='audio_original'?accentLabels[item.accent??'en-US']:'전사 코칭'} · ${item.status==='ready'?'피드백 보기':item.status==='failed'?'분석 재시도':'분석 중'}`} onPress={()=>{player.pause();router.push({pathname:'/analyses/[id]',params:{id:item.id}});}}/>):null}</>:null}
      <Button variant="quiet" title="이 연습 기록 삭제" disabled={busy||recorderState.isRecording} onPress={removeSession}/>
    </>:null}
  </FlowScreen>;
}

const styles = StyleSheet.create({
  prompt: { color: colors.text, fontSize: 20, lineHeight: 30 },
  notice: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 16, color: colors.text },
  timer: {color:colors.mint,fontSize:42,lineHeight:52,fontWeight:'700'},
});
