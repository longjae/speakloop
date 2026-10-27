import { Tabs } from 'expo-router/js-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Brand } from '../../components/ui';
import { TabIcon } from '../../components/TabIcon';
import { colors } from '../../lib/theme';

export default function TabLayout() {
  const insets=useSafeAreaInsets();
  return <Tabs screenOptions={{headerTitle:()=> <Brand compact/>,headerStyle:{backgroundColor:colors.background},headerTintColor:colors.silver,headerShadowVisible:false,tabBarActiveTintColor:colors.mint,tabBarInactiveTintColor:colors.muted,tabBarHideOnKeyboard:true,tabBarLabelStyle:{fontSize:11,fontWeight:'600'},tabBarStyle:{backgroundColor:colors.surface,borderTopColor:colors.border,height:64+insets.bottom,paddingTop:8,paddingBottom:Math.max(insets.bottom,8)},sceneStyle:{backgroundColor:colors.background}}}>
    <Tabs.Screen name="dashboard" options={{title:'대시보드',tabBarAccessibilityLabel:'메인 대시보드',tabBarIcon:({color})=><TabIcon name="dashboard" color={color??colors.muted}/>}}/>
    <Tabs.Screen name="opic" options={{title:'오픽',tabBarIcon:({color})=><TabIcon name="opic" color={color??colors.muted}/>}}/>
    <Tabs.Screen name="daily" options={{title:'일상 회화',tabBarIcon:({color})=><TabIcon name="daily" color={color??colors.muted}/>}}/>
    <Tabs.Screen name="settings" options={{title:'설정',tabBarIcon:({color})=><TabIcon name="settings" color={color??colors.muted}/>}}/>
  </Tabs>;
}
