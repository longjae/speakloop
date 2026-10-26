import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Button, Platform, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioPlayer, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { File } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { editTranscript, getScenario, getSession, listUtterances, PracticeSession, reserveUpload, Scenario, transcribeUpload, Utterance } from '../../lib/api';
import { supabase } from '../../lib/supabase';

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

  async function startRecording() {
    setBusy(true);
    setError('');
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) throw new Error('마이크 권한이 필요합니다. 기기 설정에서 허용해 주세요.');
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
    {!session && !error && <ActivityIndicator />}
    {error && <Text accessibilityRole="alert">{error}</Text>}
    {session && <>
      <Text style={styles.title}>{scenario?.title ?? (session.mode === 'opic' ? 'OPIc 연습' : '일상 회화')}</Text>
      {scenario && <><Text style={styles.prompt}>{scenario.prompt}</Text><Text>목표: {scenario.goals.join(' · ')}</Text></>}
      {Platform.OS === 'web' ? <Text>녹음은 Android·iOS 앱에서 이용해 주세요.</Text> : <>
        <Text>녹음은 먼저 기기에 저장됩니다. 제출하면 비공개 저장소에 보관하고, 영어 전사를 위해 Google Vertex AI로 보냅니다.</Text>
        <Text>녹음 시간: {Math.round((recorderState.isRecording ? recorderState.durationMillis : durationMs) / 1000)}초</Text>
        {recorderState.isRecording ? <Button title="녹음 종료" disabled={busy} onPress={stopRecording} /> : <Button title={recordingUri ? '다시 녹음' : '녹음 시작'} disabled={busy} onPress={startRecording} />}
        {recordingUri && !recorderState.isRecording && <><Button title="내 녹음 듣기" disabled={busy} onPress={playRecording} /><Button title={busy ? '처리 중…' : '녹음 제출·영어 전사'} disabled={busy} onPress={submitRecording} /></>}
        {uploadMessage && <Text accessibilityLiveRegion="polite">{uploadMessage}</Text>}
        {utterance && <><Text>전사 상태: {utterance.stt_status}</Text><Text>원본: {utterance.transcript_raw || '인식한 말이 없습니다. 다시 녹음해 주세요.'}</Text><TextInput accessibilityLabel="전사 수정" multiline value={editedText} onChangeText={value => { setEditedText(value); setSaveMessage(''); }} style={styles.editor} /><Button title="수정한 전사 저장" disabled={busy || !editedText.trim()} onPress={saveTranscript} />{saveMessage && <Text accessibilityLiveRegion="polite">{saveMessage}</Text>}{utterance.transcript_edited && <Text>저장된 수정본: {utterance.transcript_edited}</Text>}</>}
      </>}
    </>}
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, padding: 24, justifyContent: 'center', gap: 16 },
  title: { fontSize: 24, fontWeight: 'bold' },
  prompt: { fontSize: 18, lineHeight: 26 },
  editor: { minHeight: 100, borderWidth: 1, borderColor: '#888', padding: 12, textAlignVertical: 'top' },
});
