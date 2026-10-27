import AsyncStorage from '@react-native-async-storage/async-storage';

export type Accent = 'en-US' | 'en-GB';
export const accentLabels: Record<Accent,string> = { 'en-US':'미국식 영어', 'en-GB':'영국식 영어' };
const key='speakloop:practice-accent';
export async function loadAccent(): Promise<Accent> {
  const value=await AsyncStorage.getItem(key);
  return value==='en-GB'?'en-GB':'en-US';
}
export async function saveAccent(value: Accent) { await AsyncStorage.setItem(key,value); }
