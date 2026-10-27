import { Stack } from 'expo-router';
import { ActivityIndicator, StatusBar, View } from 'react-native';
import { Brand } from '../components/ui';
import { AuthProvider, useAuth } from '../lib/auth-context';
import { colors, ui } from '../lib/theme';

function Navigation() {
  const {session,loading}=useAuth();
  if(loading)return <View style={ui.page}><ActivityIndicator color={colors.mint}/></View>;
  return <Stack screenOptions={{headerTitle:()=> <Brand compact/>,headerStyle:{backgroundColor:colors.background},headerTintColor:colors.silver,headerShadowVisible:false,contentStyle:{backgroundColor:colors.background}}}>
    <Stack.Screen name="index" options={{headerShown:false}}/>
    <Stack.Protected guard={!session} redirectTo="/dashboard"><Stack.Screen name="login" options={{headerShown:false}}/></Stack.Protected>
    <Stack.Protected guard={!!session} redirectTo="/login">
      <Stack.Screen name="(tabs)" options={{headerShown:false}}/>
      <Stack.Screen name="scenarios/[mode]"/>
      <Stack.Screen name="sessions/[id]"/>
      <Stack.Screen name="analyses/[id]"/>
    </Stack.Protected>
    <Stack.Screen name="reset-password"/>
  </Stack>;
}
export default function Layout(){return <AuthProvider><StatusBar barStyle="light-content"/><Navigation/></AuthProvider>;}
