import { useEffect } from 'react';
import { View } from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Button, Text } from './ui';

export function RecordingPlayback({ url,startMs,endMs,onError,onClose }: {url:string;startMs:number;endMs:number|null;onError:(message:string)=>void;onClose:()=>void}) {
  const player=useAudioPlayer({uri:url});
  const status=useAudioPlayerStatus(player);
  useEffect(()=>{
    if (!status.isLoaded) return;
    let active=true;
    player.seekTo(startMs/1000).then(()=>{if(active)player.play();}).catch(()=>onError('원본 녹음을 재생하지 못했습니다. 다시 눌러 주세요.'));
    return ()=>{active=false;};
  },[status.isLoaded,player,startMs,onError]);
  useEffect(()=>{if(endMs!==null && status.currentTime*1000>=endMs && status.playing)player.pause();},[status.currentTime,status.playing,endMs,player]);
  useEffect(()=>{if(status.error)onError('원본 녹음을 불러오지 못했습니다. 다시 눌러 주세요.');},[status.error,onError]);
  async function toggle() {
    if(status.playing) {player.pause();return;}
    try {if(endMs!==null && status.currentTime*1000>=endMs)await player.seekTo(startMs/1000);player.play();}
    catch {onError('원본 녹음을 재생하지 못했습니다. 다시 눌러 주세요.');}
  }
  return <View style={{gap:8}}><Text>원본 녹음 · {Math.floor(status.currentTime)}초{endMs!==null?` / 약 ${Math.ceil(endMs/1000)}초`:''}</Text><Button title={status.playing?'원본 일시정지':'원본 이어듣기'} disabled={!status.isLoaded} onPress={toggle}/><Button title="원본 듣기 닫기" variant="quiet" onPress={onClose}/></View>;
}
