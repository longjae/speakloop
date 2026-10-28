import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Linking, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { RecordingPresets, setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { FlowScreen } from '../../components/FlowScreen';
import { Button, Text } from '../../components/ui';
import { RecordingPlayback } from '../../components/RecordingPlayback';
import { useAuth } from '../../lib/auth-context';
import { loadAccent } from '../../lib/accent';
import { createSession, getQuestionAudio, listScenarios, reserveUpload, Scenario, transcribeUpload } from '../../lib/api';
import { adjustMockQuestions, buildMockQuestions, clearMock, MockAnswer, MockExam, readMock, saveMock, secondsLeft, surveyTopics, topicLabels } from '../../lib/opic-mock';
import { ensureMicrophoneAccess } from '../../lib/microphone';
import { supabase } from '../../lib/supabase';
import { colors, ui } from '../../lib/theme';

export default function OpicMock() {
  const {session}=useAuth();
  const owner=session?.user.id;
  const [bank,setBank]=useState<Scenario[]>([]);
  const [exam,setExam]=useState<MockExam|null>(null);
  const [loading,setLoading]=useState(true);
  const [reload,setReload]=useState(0);
  const [resume,setResume]=useState(false);
  const [topics,setTopics]=useState<string[]>(['home','travel']);
  const [count,setCount]=useState<12|15>(15);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const [remaining,setRemaining]=useState(2400);
  const [readMode,setReadMode]=useState(false);
  const [showText,setShowText]=useState(false);
  const [review,setReview]=useState<{uri:string;key:number}|null>(null);
  const examRef=useRef<MockExam|null>(null);
  const focused=useRef(true);
  const stopping=useRef(false);
  const started=useRef(0);
  const queue=useRef(Promise.resolve());
  const autoPlayed=useRef('');
  const player=useAudioPlayer(null);
  const playback=useAudioPlayerStatus(player);
  // 32 kbps mono keeps even a very long answer within the 10 MB upload limit.
  const recorder=useAudioRecorder({...RecordingPresets.HIGH_QUALITY,bitRate:32000,sampleRate:24000,numberOfChannels:1,directory:'document'});
  const recording=useAudioRecorderState(recorder);
  const q=exam?.questions[exam.index];
  async function commit(next:MockExam) {
    examRef.current=next;setExam(next);setRemaining(secondsLeft(next));
    queue.current=queue.current.catch(()=>{}).then(()=>saveMock(next));
    await queue.current;
  }
  useEffect(()=>{
    let active=true;
    if(!owner)return;
    void Promise.all([listScenarios('opic'),readMock(owner).catch(()=>{if(active)setError('이전 시험 기록을 읽지 못했습니다. 새 시험을 준비할 수 있습니다.');return null;})]).then(([result,saved])=>{
      if(!active)return;setBank(result.items);
      if(saved){examRef.current=saved;setExam(saved);setRemaining(secondsLeft(saved));setResume(saved.phase!=='finished');setReadMode(saved.reading??false);}
    }).catch(cause=>{if(active)setError(cause.message);}).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[owner,reload]);
  async function storeAnswer() {
    const current=examRef.current;
    if(!current||!recorder.isRecording||stopping.current)return;
    stopping.current=true;
    try {
      const duration=Math.min(2400000,Math.max(0,Date.now()-started.current));
      await recorder.stop();await setAudioModeAsync({playsInSilentMode:true,allowsRecording:false});
      if(recorder.uri&&duration>=1000){await commit({...current,answers:{...current.answers,[current.index]:{uri:recorder.uri,duration}}});}
      else {if(recorder.uri)try{new File(recorder.uri).delete();}catch{};throw new Error('녹음이 너무 짧아 저장하지 못했습니다. 1초 이상 답변해 주세요.');}
    }finally{stopping.current=false;}
  }
  async function finish() {
    player.pause();
    if(stopping.current)return;
    try{await storeAnswer();}catch(cause){setError(cause instanceof Error?cause.message:'마지막 녹음을 저장하지 못했습니다.');}
    const current=examRef.current;if(current)await commit({...current,phase:'finished'});
  }
  useFocusEffect(useCallback(()=>{
    focused.current=true;
    return ()=>{focused.current=false;player.pause();setReview(null);void storeAnswer().catch(()=>{});};
    // The mutable exam ref keeps the current answer available to blur cleanup.
  },[player,recorder]));
  useEffect(()=>{
    if(!exam?.deadline||exam.phase==='finished'||resume)return;
    const tick=()=>{
      const current=examRef.current;if(!current||current.phase==='finished')return;
      const left=secondsLeft(current);setRemaining(left);
      if(left===0)void finish().catch(()=>setError('종료 상태를 저장하지 못했습니다. 앱을 닫지 말고 다시 시도해 주세요.'));
    };
    tick();const timer=setInterval(tick,1000);
    const listener=AppState.addEventListener('change',state=>{if(state!=='active'){player.pause();void storeAnswer().catch(()=>{});}else tick();});
    return ()=>{clearInterval(timer);listener.remove();};
  },[exam?.deadline,exam?.phase,resume]);
  useEffect(()=>{if(playback.error)setError('질문 음성을 재생하지 못했습니다. 읽기 보조를 켜거나 음성을 다시 확인해 주세요.');},[playback.error]);
  async function playQuestion() {
    const current=examRef.current;if(!current||recorder.isRecording)return;
    const question=current.questions[current.index];const uri=current.audio[question.id];
    if(!uri)throw new Error('질문 음성이 없습니다. 읽기 보조를 이용해 주세요.');
    if((current.listens[current.index]??0)>=2)return;
    await setAudioModeAsync({playsInSilentMode:true,allowsRecording:false});
    const latest=examRef.current;
    if(!focused.current||!latest||latest.index!==current.index||latest.phase!=='exam'||secondsLeft(latest)===0)return;
    player.replace({uri});player.play();
    await commit({...latest,listens:{...latest.listens,[latest.index]:(latest.listens[latest.index]??0)+1}});
  }
  useEffect(()=>{
    if(!exam||exam.phase!=='exam'||resume||readMode)return;
    const token=`${exam.id}:${exam.index}`;
    if(autoPlayed.current===token)return;autoPlayed.current=token;setShowText(false);
    if((exam.listens[exam.index]??0)===0)void playQuestion().catch(cause=>setError(cause.message));
  },[exam?.phase,exam?.index,resume,readMode]);
  async function prepareAudio(current:MockExam) {
    let next=current;
    for(let i=0;i<next.questions.length;i++) {
      if(!focused.current)break;
      if(next.deadline&&secondsLeft(next)===0)return examRef.current??next;
      const question=next.questions[i];if(next.audio[question.id]&&new File(next.audio[question.id]).exists)continue;
      setMessage(`질문 음성 준비 ${i+1} / ${next.questions.length}`);
      let guide=await getQuestionAudio(question.id,next.accent);
      for(let attempt=0;guide.status==='processing'&&attempt<45;attempt++){
        await new Promise(resolve=>setTimeout(resolve,2000));if(!focused.current)return next;
        guide=await getQuestionAudio(question.id,next.accent);
      }
      if(guide.status!=='ready'||!guide.playback_url)throw new Error('질문 음성을 준비하지 못했습니다. 다시 준비하거나 읽기 보조로 시작해 주세요.');
      const file=await File.downloadFileAsync(guide.playback_url,new File(Paths.document,`opic-${next.id}-${question.id}.wav`),{idempotent:true});
      if(examRef.current?.phase==='finished')return examRef.current;
      next={...next,audio:{...next.audio,[question.id]:file.uri}};await commit(next);
    }
    setMessage('질문 음성을 준비했습니다. 시작하면 40분 타이머가 작동합니다.');return next;
  }
  async function prepare() {
    if(!owner)return;setBusy(true);setError('');
    try{
      if(!await ensureMicrophoneAccess()){setError('모의시험에는 마이크 사용 허용이 필요합니다.');return;}
      let next=examRef.current;
      if(!next){next={version:1,id:randomUUID(),owner,accent:await loadAccent(),questions:buildMockQuestions(bank,topics,count),count,index:0,phase:'ready',deadline:null,answers:{},audio:{},listens:{},adjusted:false};await commit(next);}
      await prepareAudio(next);
    }catch(cause){setError(cause instanceof Error?cause.message:'시험 준비에 실패했습니다.');}
    finally{setBusy(false);}
  }
  async function begin() {
    const current=examRef.current;if(!current)return;
    setError('');setBusy(true);player.pause();
    try{if(!await ensureMicrophoneAccess()||!focused.current)return;await commit({...current,phase:'exam',reading:readMode,deadline:Date.now()+2400000});}
    catch(cause){setError(cause instanceof Error?cause.message:'시험을 시작하지 못했습니다.');}
    finally{setBusy(false);}
  }
  async function record() {
    if(secondsLeft(examRef.current!)===0){await finish();return;}
    setBusy(true);setError('');player.pause();
    try{
      if(!await ensureMicrophoneAccess())return;
      if(!focused.current||examRef.current?.phase!=='exam'||secondsLeft(examRef.current)===0)return;
      await setAudioModeAsync({playsInSilentMode:true,allowsRecording:true});await recorder.prepareToRecordAsync();
      if(!focused.current||examRef.current?.phase!=='exam'||secondsLeft(examRef.current)===0){await recorder.stop();await setAudioModeAsync({playsInSilentMode:true,allowsRecording:false});return;}
      started.current=Date.now();recorder.record();
    }catch{setError('녹음을 시작하지 못했습니다. 마이크 설정을 확인해 주세요.');}
    finally{setBusy(false);}
  }
  async function advance(skip=false) {
    setBusy(true);setError('');player.pause();
    try{
      await storeAnswer();let current=examRef.current;if(!current)return;
      if(skip&&!current.answers[current.index])current={...current,answers:{...current.answers,[current.index]:{skipped:true,duration:0}}};
      if(current.index===current.questions.length-1||secondsLeft(current)===0){await commit({...current,phase:'finished'});return;}
      const index=current.index+1;
      await commit({...current,index,phase:index===7&&!current.adjusted?'adjust':'exam'});
    }catch(cause){setError(cause instanceof Error?cause.message:'다음 문항으로 이동하지 못했습니다.');}
    finally{setBusy(false);}
  }
  function skip(){Alert.alert('답변 없이 넘어갈까요?','이전 문항으로 돌아가 다시 녹음할 수 없습니다.',[{text:'취소',style:'cancel'},{text:'건너뛰기',onPress:()=>void advance(true)}]);}
  async function adjust(choice:'easier'|'same'|'harder') {
    const current=examRef.current;if(!current)return;
    setBusy(true);setError('');
    try{const next=adjustMockQuestions(current,bank,choice);const prepared=readMode?next:await prepareAudio(next);if(secondsLeft(prepared)>0)await commit({...prepared,phase:'exam'});else await finish();}
    catch(cause){setError(cause instanceof Error?cause.message:'문항을 조정하지 못했습니다.');}
    finally{setBusy(false);}
  }
  function reset() {
    Alert.alert('새 모의시험을 준비할까요?','현재 시험과 기기에 보관된 답변 녹음이 삭제됩니다. 이미 제출한 코칭 기록은 남습니다.',[{text:'취소',style:'cancel'},{text:'새로 준비',onPress:()=>{
      const current=examRef.current;if(!current||!owner)return;
      player.pause();setReview(null);
      Object.values(current.answers).forEach(a=>{if(a.uri)try{new File(a.uri).delete();}catch{}});
      Object.values(current.audio).forEach(uri=>{try{new File(uri).delete();}catch{}});
      void queue.current.catch(()=>{}).then(()=>clearMock(owner)).then(()=>{examRef.current=null;setExam(null);setResume(false);setReadMode(false);autoPlayed.current='';setError('');setMessage('');}).catch(()=>setError('기록을 초기화하지 못했습니다.'));
    }}]);
  }
  async function submit(index:number) {
    if(!supabase)return;setBusy(true);setError('');setMessage('선택한 답변을 업로드하고 전사를 준비합니다…');setReview(null);
    const patch=async(changes:Partial<MockAnswer>)=>{const current=examRef.current!;await commit({...current,answers:{...current.answers,[index]:{...current.answers[index],...changes}}});};
    try{
      const current=examRef.current!;let answer=current.answers[index];
      if(!answer?.uri)throw new Error('이 문항의 녹음이 없습니다.');
      if(!answer.sessionId){const s=await createSession('opic',current.questions[index].id);await patch({sessionId:s.id});}
      answer=examRef.current!.answers[index];
      if(!answer.uploadId){
        const bytes=new Uint8Array(await new File(answer.uri!).arrayBuffer());
        if(!answer.uploadKey){await patch({uploadKey:randomUUID()});answer=examRef.current!.answers[index];}
        const reserved=await reserveUpload(answer.sessionId!,bytes.length,answer.duration,answer.uploadKey!);
        const uploaded=await supabase.storage.from('recordings').upload(reserved.path,bytes,{contentType:'audio/mp4',upsert:false});
        if(uploaded.error&&uploaded.error.message.toLowerCase().indexOf('already exists')<0)throw new Error('답변 업로드에 실패했습니다. 다시 시도해 주세요.');
        await patch({uploadId:reserved.upload_id});
      }
      answer=examRef.current!.answers[index];
      if(!answer.utteranceId){const u=await transcribeUpload(answer.sessionId!,answer.uploadId!);if(u.stt_status!=='ready')throw new Error('말소리를 인식하지 못했습니다. 이 문항은 다시 연습해 주세요.');await patch({utteranceId:u.id});}
      answer=examRef.current!.answers[index];
      if(focused.current)router.push({pathname:'/sessions/[id]/review',params:{id:answer.sessionId!,utteranceId:answer.utteranceId!}});
    }catch(cause){setError(cause instanceof Error?cause.message:'답변을 제출하지 못했습니다.');}
    finally{setBusy(false);setMessage('');}
  }
  const ready=!!exam&&(readMode||exam.questions.every(item=>exam.audio[item.id]));
  const result=exam?.phase==='finished';
  const active=!!exam&&exam.phase==='exam'&&!resume;
  const time=`${Math.floor(remaining/60).toString().padStart(2,'0')}:${(remaining%60).toString().padStart(2,'0')}`;
  return <FlowScreen key={resume?'resume':exam?`${exam.phase}-${exam.index}`:'setup'} eyebrow={active?`OPIc MOCK · 남은 시간 ${time}`:'OPIc MOCK TEST'} title={loading?'연습 자료를 불러와요':resume?'진행하던 시험이 있어요':result?'시험을 마쳤어요':exam?.phase==='adjust'?'남은 질문을 조정할까요?':active?`질문 ${exam.index+1} / ${exam.questions.length}`:'실전처럼, 40분 동안.'} description={active?'중간 피드백 없이 한 문항씩 답합니다.':undefined} footer={active?<>
    {recording.isRecording?<Button variant="primary" title="답변 종료 · 다음 문항" loading={busy} onPress={()=>void advance()}/>:exam.answers[exam.index]?.uri?<Button variant="primary" title="저장된 답변으로 다음 문항" loading={busy} onPress={()=>void advance()}/>:<Button variant="primary" title="답변 녹음 시작" loading={busy} disabled={playback.playing||playback.isBuffering} onPress={()=>void record()}/>}
    {!recording.isRecording&&!exam.answers[exam.index]?.uri?<Button title="답변 건너뛰기" variant="quiet" disabled={busy} onPress={skip}/>:null}
  </>:!loading&&!resume&&!result&&exam?.phase!=='adjust'?<>
    {ready?<Button variant="primary" title={`${count===12||exam?.count===12?12:15}문항 · 40분 시작`} loading={busy} onPress={()=>void begin()}/>:<Button variant="primary" title={exam?'질문 음성 다시 준비':'마이크 허용 · 질문 음성 준비'} loading={busy} disabled={!bank.length||topics.length!==2} onPress={()=>void prepare()}/>}
  </>:undefined}>
    {error?<Text accessibilityRole="alert" style={ui.error}>{error}</Text>:null}
    {message?<Text accessibilityLiveRegion="polite">{message}</Text>:null}
    {!loading&&!bank.length?<Button title="시나리오 다시 불러오기" onPress={()=>{setLoading(true);setReload(value=>value+1);}}/>:null}
    {loading?<ActivityIndicator color={colors.mint}/>:null}
    {resume&&exam?<><Text>{exam.questions.length}문항 중 {exam.index+1}번 · {exam.deadline?`남은 시간 ${time}`:'시작 전 준비 기록'}</Text><Text>시험을 시작한 뒤에는 앱 밖에서도 시간이 흐릅니다. 마이크는 화면을 떠나면 정지합니다.</Text><Button variant="primary" title="기존 시험 이어가기" onPress={()=>{setResume(false);if(exam.deadline&&secondsLeft(exam)===0)void finish();}}/><Button title="새 시험 준비" onPress={reset}/></>:null}
    {!loading&&!exam?<>
      <Text>관심 주제 2개를 선택하세요. 묘사·일상·경험 질문이 연결되고, 선택하지 않은 주제와 롤플레이도 나옵니다.</Text>
      {surveyTopics.map(topic=><Button key={topic} variant={topics.includes(topic)?'primary':'secondary'} title={`${topics.includes(topic)?'선택 · ':''}${topicLabels[topic]}`} onPress={()=>setTopics(values=>values.includes(topic)?values.filter(v=>v!==topic):values.length<2?[...values,topic]:[values[1],topic])}/>)}
      <Button title={`12문항${count===12?' · 선택됨':''}`} onPress={()=>setCount(12)}/><Button title={`15문항${count===15?' · 선택됨':''}`} onPress={()=>setCount(15)}/>
      <Text>15문항은 마지막 비교·의견 질문을 포함합니다. 12문항에서는 중간 선택 후 난이도를 유지합니다. 이는 앱의 연습 구성입니다.</Text>
    </>:null}
    {exam?.phase==='ready'&&!resume?<><Text>{exam.questions.length}개 연습 문항을 준비했습니다. 질문을 듣고 답변한 뒤에는 이전 문항으로 돌아갈 수 없습니다.</Text><Text>시작 전 마이크를 허용하고 이어폰·미디어 볼륨을 확인하세요. 질문은 자동으로 한 번 재생하며 한 번 더 들을 수 있습니다.</Text>{ready&&exam.audio[exam.questions[0].id]?<Button title="스피커 확인 · 첫 질문 미리 듣기" onPress={()=>{player.replace({uri:exam.audio[exam.questions[0].id]});player.play();}}/>:null}<Button title={`${readMode?'음성 시험으로 바꾸기':'음성 준비가 어려우면 읽기 보조로 연습'}`} disabled={busy} onPress={()=>setReadMode(value=>!value)}/><Button variant="quiet" title="주제 다시 선택하기" disabled={busy} onPress={reset}/></>:null}
    {!active&&!resume&&!result?<><Text>공식 시험 문항을 복제하지 않은 SpeakLoop 연습용 모의시험입니다. 공식 등급을 산출하지 않습니다. 녹음은 기기에 보관하고, 종료 후 선택한 답변만 제출합니다.</Text><Button variant="quiet" title="공식 OPIc 시험 안내" onPress={()=>void Linking.openURL('https://www.opic.or.kr/opics/servlet/controller.opic.site.about.AboutServlet?p_process=move-introduce-opic').catch(()=>setError('공식 안내를 열지 못했습니다.'))}/></>:null}
    {active&&q?<>
      <View style={ui.card}><Text style={ui.label}>INTERVIEWER</Text><Text style={ui.cardTitle}>{playback.playing?'질문을 듣고 있어요':recording.isRecording?'나의 답변을 녹음하고 있어요':'질문을 듣고 답해 주세요'}</Text><Text>{recording.isRecording?`${Math.floor(recording.durationMillis/1000)}초 녹음 중`:'질문 음성도 전체 40분에 포함됩니다.'}</Text></View>
      <Button title={`질문 다시 듣기 · ${Math.max(0,2-(exam.listens[exam.index]??0))}회 남음`} disabled={busy||recording.isRecording||playback.playing||(exam.listens[exam.index]??0)>=2} onPress={()=>void playQuestion().catch(cause=>setError(cause.message))}/>
      <Button variant="quiet" title={showText?'읽기 보조 닫기':'질문 글로 보기 · 읽기 보조'} onPress={()=>setShowText(value=>!value)}/>
      {showText||readMode?<View style={ui.card}><Text>{q.prompt}</Text><Text>읽기 보조를 켠 학습 모드입니다.</Text></View>:null}
      {exam.answers[exam.index]?.uri?<Text>화면을 떠나기 전에 녹음한 답변이 보관되어 있습니다. 다음 문항으로 이어가세요.</Text>:null}
      <Button variant="quiet" title="지금 시험 마치기" disabled={busy} onPress={()=>Alert.alert('시험을 마칠까요?','저장된 답변을 복습할 수 있습니다.',[{text:'계속 응시',style:'cancel'},{text:'마치기',onPress:()=>void finish()}])}/>
    </>:null}
    {exam?.phase==='adjust'&&!resume?<><Text>남은 시간 {time}. 묶음 질문과 롤플레이는 유지합니다. 15문항 모드에서는 마지막 두 문항의 유형을 바꿉니다.</Text>{(['easier','same','harder'] as const).map((choice,i)=><Button key={choice} title={['조금 쉽게','비슷하게','더 도전하기'][i]} loading={busy} onPress={()=>void adjust(choice)}/>)}<Text>중간 선택 중에도 시간은 흐릅니다.</Text></>:null}
    {result&&exam?<>
      <View style={ui.card}><Text style={ui.cardTitle}>{Object.values(exam.answers).filter(a=>a.uri).length}개 답변 녹음</Text><Text>녹음은 이 기기에 보관돼 있습니다. 복습할 답변을 골라 제출하면 전사 확인 후 코칭을 시작할 수 있습니다.</Text></View>
      {review?<RecordingPlayback key={review.key} url={review.uri} label="내 답변" startMs={0} endMs={null} onError={setError} onClose={()=>setReview(null)}/>:null}
      {exam.questions.map((question,i)=>{const answer=exam.answers[i];return <View key={question.id} style={ui.card}><Text style={ui.label}>QUESTION {i+1} · {question.title}</Text><Text>{question.prompt}</Text>{answer?.uri?<><Text>{Math.round(answer.duration/1000)}초 · {answer.utteranceId?'제출 완료':'기기에 보관됨'}</Text><Button title="내 답변 듣기" disabled={busy} onPress={()=>setReview({uri:answer.uri!,key:Date.now()})}/><Button variant="primary" title={answer.utteranceId?'전사·코칭 확인':'이 답변 제출하고 코칭받기'} loading={busy} onPress={()=>void submit(i)}/></>:<Text>{answer?.skipped?'건너뛴 문항':'답변하지 않은 문항'}</Text>}</View>;})}
      <Button title="새 모의시험 준비하기" disabled={busy} onPress={reset}/><Button title="OPIc 주제 연습으로" disabled={busy} onPress={()=>router.dismissTo('/opic')}/>
    </>:null}
  </FlowScreen>;
}
