import { Alert, Linking, Platform } from 'react-native';
import { AudioModule } from 'expo-audio';

export type MicrophonePermission={granted:boolean;canAskAgain:boolean;status:string};
export async function getMicrophonePermission():Promise<MicrophonePermission> {
  if(Platform.OS==='web')return {granted:false,canAskAgain:false,status:'unavailable'};
  return AudioModule.getRecordingPermissionsAsync();
}
export async function openMicrophoneSettings() {
  if(Platform.OS==='web')return;
  await Linking.openSettings();
}
export async function ensureMicrophoneAccess(fromSettings=false):Promise<boolean> {
  const permission=await getMicrophonePermission();
  if(permission.granted)return true;
  if(permission.status==='unavailable')return false;
  if(permission.canAskAgain)return (await AudioModule.requestRecordingPermissionsAsync()).granted;
  if(fromSettings)await openMicrophoneSettings();
  else Alert.alert('마이크 사용 허용이 필요해요','기기 설정에서 SpeakLoop의 마이크 권한을 허용한 뒤 다시 시작해 주세요.',[
    {text:'나중에',style:'cancel'},
    {text:'기기 설정 열기',onPress:()=>{void openMicrophoneSettings().catch(()=>Alert.alert('설정을 열지 못했습니다','기기 설정 → 앱 → SpeakLoop → 권한에서 마이크를 허용해 주세요.'));}},
  ]);
  return false;
}
