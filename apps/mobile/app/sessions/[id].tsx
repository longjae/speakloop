import { Button, Text, TextInput } from '../../components/ui';
import { Accent, accentLabels, loadAccent } from '../../lib/accent';
import { colors, ui } from '../../lib/theme';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet } from 'react-native';
import { RecordingPresets, setAudioModeAsync, useAudioPlayer, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { File } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { editTranscript, getScenario, getSession, listUtterances, PracticeSession, reserveUpload, Scenario, transcribeUpload, Utterance } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { Analysis, deleteSession, listAnalyses, startAnalysis } from '../../lib/api';
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
  const [editedText, setEditedText] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [uploadMessage, setUploadMessage] = useState('');
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
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
          setEditedText(latest.transcript_edited ?? latest.transcript_raw ?? '');
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

  async function analyze() {
    if (!id || !utterance || !accent) return;
    setAnalyzing(true); setError('');
    try {
      const result = await startAnalysis(id, utterance.id, accent);
      router.push({ pathname: '/analyses/[id]', params: { id: result.id } });
    } catch (cause) { setError(cause instanceof Error ? cause.message : '분석을 시작할 수 없습니다.'); }
    finally { setAnalyzing(false); }
  }

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
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      setRecordingUri(null);
      setUploadedId(null);
      setUploadMessage('');
      setSaveMessage('');
      setUtterance(null);
      setDurationMs(0);
      await recorder.prepareToRecordAsync();
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
      setEditedText(resultUtterance.transcript_edited ?? resultUtterance.transcript_raw ?? '');
      setUploadMessage(resultUtterance.transcript_raw ? '업로드와 영어 전사가 완료됐습니다.' : '업로드는 완료됐지만 음성을 인식하지 못했습니다. 다시 녹음해 주세요.');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '전사를 완료할 수 없습니다.';
      setError(message);
      setUploadMessage(`처리 실패: ${message} 제출 버튼을 눌러 다시 시도해 주세요.`);
    } finally {
      setBusy(false);
    }
  }

  async function saveTranscript() {
    if (!utterance) return;
    setBusy(true);
    setError('');
    setSaveMessage('');
    try {
      const result = await editTranscript(utterance.id, editedText);
      setUtterance(value => value ? { ...value, transcript_edited: result.transcript_edited } : value);
      setEditedText(result.transcript_edited);
      setSaveMessage('수정한 전사를 저장했습니다. 다시 들어와도 이 내용이 유지됩니다.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '전사를 저장할 수 없습니다.');
    } finally {
      setBusy(false);
    }
  }

  return <ScrollView contentContainerStyle={styles.page}>
    {!session && !error && <ActivityIndicator color={colors.mint} />}
    {error && <Text style={ui.error} accessibilityRole="alert">{error}</Text>}
    {session && <>
      <Text style={styles.title}>{scenario?.title ?? (session.mode === 'opic' ? 'OPIc 연습' : '일상 회화')}</Text>
      <Text>연습 기준 · {accentLoading?'설정 확인 중':accent?accentLabels[accent]:'설정 확인 필요'}</Text>
      {scenario && <><Text style={styles.prompt}>{scenario.prompt}</Text><Text>목표: {scenario.goals.join(' · ')}</Text></>}
      {Platform.OS === 'web' ? <Text>녹음은 Android·iOS 앱에서 이용해 주세요.</Text> : <>
        <Text>녹음은 먼저 기기에 저장됩니다. 제출하면 비공개 저장소에 보관하고, 영어 전사와 말하기 코칭을 위해 Google Vertex AI로 보냅니다.</Text>
        <Text>녹음 시간: {Math.round((recorderState.isRecording ? recorderState.durationMillis : durationMs) / 1000)}초</Text>
        {recorderState.isRecording ? <Button variant="primary" title="녹음 종료" disabled={busy || analyzing} onPress={stopRecording} /> : <Button variant="primary" title={recordingUri ? '다시 녹음' : '녹음 시작'} disabled={busy || analyzing} onPress={startRecording} />}
        {recordingUri && !recorderState.isRecording && <><Button title="내 녹음 듣기" disabled={busy || analyzing} onPress={playRecording} /><Button variant="primary" title={busy ? '처리 중…' : '녹음 제출·영어 전사'} disabled={busy || analyzing} onPress={submitRecording} /></>}
        {uploadMessage && <Text style={styles.notice} accessibilityLiveRegion="polite">{uploadMessage}</Text>}
        {utterance && <><Text style={ui.label}>TRANSCRIPT · 나의 발화</Text><Text style={ui.subtitle}>원본: {utterance.transcript_raw || '인식한 말이 없습니다. 다시 녹음해 주세요.'}</Text><Text style={ui.label}>인식 오류 수정</Text><TextInput accessibilityLabel="전사 수정" multiline value={editedText} onChangeText={value => { setEditedText(value); setSaveMessage(''); }} style={styles.editor} /><Button variant="primary" title="수정한 전사 저장" disabled={busy || analyzing || !editedText.trim()} onPress={saveTranscript} />{saveMessage && <Text style={styles.notice} accessibilityLiveRegion="polite">{saveMessage}</Text>}{utterance.transcript_edited && <Text>저장된 수정본: {utterance.transcript_edited}</Text>}</>}
      </>}
      {utterance?.stt_status === 'ready' && <><Text>코칭에는 녹음한 원본 오디오와 원본 전사를 함께 사용합니다. 수정한 문장은 평가에 반영하지 않습니다.</Text><Button variant="primary" title="녹음 듣고 코칭 받기" loading={analyzing} disabled={busy || accentLoading || !accent || recorderState.isRecording} onPress={analyze} /></>}
      {analyses.length > 0 && <><Text style={ui.cardTitle}>피드백 이력</Text>{analyses.map(item => <Button key={item.id} title={`${new Date(item.created_at).toLocaleDateString('ko-KR')} · ${item.input_source==='audio_original'?accentLabels[item.accent ?? 'en-US']:'전사 코칭'} · ${item.status === 'ready' ? '피드백 보기' : item.status === 'failed' ? '분석 재시도' : '분석 중'}`} onPress={() => router.push({ pathname: '/analyses/[id]', params: { id: item.id } })} />)}</>}
      <Button variant="quiet" title="이 연습 기록 삭제" disabled={busy || analyzing || recorderState.isRecording} onPress={removeSession} />
    </>}
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { ...ui.page },
  title: { ...ui.title },
  prompt: { color: colors.text, fontSize: 20, lineHeight: 30, backgroundColor: colors.surface, borderRadius: 20, padding: 24 },
  notice: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 16, color: colors.text },
  editor: { ...ui.input, minHeight: 140, textAlignVertical: 'top' },
});
