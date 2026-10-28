import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Button, Text } from './ui';

export function RecordingPlayback({ url,startMs,endMs,onError,onClose,label='원본',playbackRate=1 }: {url:string;startMs:number;endMs:number|null;label?:string;playbackRate?:number;onError:(message:string)=>void;onClose:()=>void}) {
  const player=useAudioPlayer({uri:url}, {updateInterval:100});
  const status=useAudioPlayerStatus(player);
  const mounted=useRef(false);
  const started=useRef(false);
  const [failed,setFailed]=useState(false);
  const reportError=useRef(onError);
  reportError.current=onError;
  useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;};},[]);
  useEffect(()=>{
    if (!status.isLoaded || started.current) return;
    // Android seekTo temporarily makes isLoaded false. Do not cancel the
    // pending play or seek again when it becomes true after buffering.
    started.current=true;
    async function start() {
      try {
        await setAudioModeAsync({playsInSilentMode:true,allowsRecording:false});
        if(!mounted.current)return;
        if(startMs>0)await player.seekTo(startMs/1000);
        if(mounted.current)player.play();
      } catch {
        if(mounted.current){setFailed(true);reportError.current(`${label} 음성을 재생하지 못했습니다. 듣기를 다시 눌러 주세요.`);}
      }
    }
    void start();
  },[status.isLoaded,player,startMs]);
  useEffect(()=>{
    if(status.isLoaded || failed)return;
    const timer=setTimeout(()=>{setFailed(true);reportError.current('녹음 로딩이 지연되고 있습니다. 연결을 확인하고 듣기를 다시 눌러 주세요.');},20000);
    return ()=>clearTimeout(timer);
  },[status.isLoaded,failed]);
  useEffect(()=>{if(endMs!==null && status.currentTime*1000>=endMs && status.playing)player.pause();},[status.currentTime,status.playing,endMs,player]);
  useEffect(()=>{if(status.error){setFailed(true);reportError.current(`${label} 음성을 불러오지 못했습니다. 듣기를 다시 눌러 주세요.`);}},[status.error]);
  useEffect(()=>{if(status.isLoaded)player.setPlaybackRate(playbackRate);},[status.isLoaded,playbackRate,player]);
  async function toggle() {
    if(status.playing) {player.pause();return;}
    try {
      if(status.didJustFinish || (endMs!==null && status.currentTime*1000>=endMs))await player.seekTo(startMs/1000);
      player.play();
    } catch {reportError.current(`${label} 음성을 재생하지 못했습니다. 다시 눌러 주세요.`);}
  }
  return <View style={{gap:8}}>
    <Text accessibilityLiveRegion="polite">{failed?`${label} 음성을 재생하지 못했습니다.`:!status.isLoaded?`${label} 음성을 불러오고 있습니다…`:status.playing?`${label} 재생 중`:`${label} 일시정지`} · {Math.floor(status.currentTime)}초{endMs!==null?` / 약 ${Math.ceil(endMs/1000)}초`:''}</Text>
    <Button title={status.playing?`${label} 일시정지`:`${label} 이어듣기`} loading={!status.isLoaded&&!failed} disabled={!status.isLoaded||failed} onPress={toggle}/>
    <Button title={`${label} 듣기 닫기`} variant="quiet" onPress={onClose}/>
  </View>;
}
