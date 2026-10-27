import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import * as Linking from 'expo-linking';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../lib/auth-context';
import { completeAuthFromUrl } from '../lib/auth';
import { Button, Text } from '../components/ui';
import { colors, ui } from '../lib/theme';

export default function Entry() {
  const {session,loading}=useAuth();
  const incomingUrl=Linking.useURL();
  const [handled,setHandled]=useState<string|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{
    if(!incomingUrl)return;
    let active=true;
    // Password recovery is handled only by its dedicated screen.
    try { if(new URL(incomingUrl).pathname==='/reset-password'){setHandled(incomingUrl);return;} }
    catch {setError('로그인 링크를 확인하지 못했습니다.');setHandled(incomingUrl);return;}
    completeAuthFromUrl(incomingUrl).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'로그인을 완료하지 못했습니다.');}).finally(()=>{if(active)setHandled(incomingUrl);});
    return ()=>{active=false;};
  },[incomingUrl]);
  if(loading||(incomingUrl&&handled!==incomingUrl))return <View style={ui.page}><ActivityIndicator color={colors.mint}/></View>;
  if(error&&!session)return <View style={ui.page}><Text style={ui.error}>{error}</Text><Button title="로그인 화면으로" onPress={()=>setError('')}/></View>;
  return <Redirect href={session?'/dashboard':'/login'}/>;
}
