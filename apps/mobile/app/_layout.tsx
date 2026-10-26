import { Stack } from 'expo-router';
import { StatusBar } from 'react-native';
import { Brand } from '../components/ui';
import { colors } from '../lib/theme';

export default function Layout() {
  return <><StatusBar barStyle="light-content" /><Stack screenOptions={{ headerTitle: () => <Brand compact />, headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.silver, headerShadowVisible: false, contentStyle: { backgroundColor: colors.background } }} /></>;
}
