import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from './ui';
import { colors, ui } from '../lib/theme';

export function FlowScreen({eyebrow,title,description,step,total=4,footer,children}:{eyebrow:string;title:string;description?:string;step?:number;total?:number;footer?:ReactNode;children:ReactNode}) {
  const insets=useSafeAreaInsets();
  return <View style={styles.screen}>
    <ScrollView contentContainerStyle={ui.page} keyboardShouldPersistTaps="handled">
      <Text style={ui.label}>{eyebrow}{step?` · ${step} / ${total}`:''}</Text>
      {step?<View style={styles.progress} accessibilityLabel={`${total}단계 중 ${step}단계`}>{Array.from({length:total},(_,index)=><View key={index} style={[styles.segment,{backgroundColor:index<step?colors.mint:colors.border}]}/>)}</View>:null}
      <Text accessibilityRole="header" style={ui.title}>{title}</Text>
      {description?<Text>{description}</Text>:null}
      {children}
    </ScrollView>
    {footer?<View style={[styles.footer,{paddingBottom:Math.max(insets.bottom,16)}]}>{footer}</View>:null}
  </View>;
}
const styles=StyleSheet.create({screen:{flex:1,backgroundColor:colors.background},footer:{padding:16,gap:8,borderTopWidth:1,borderTopColor:colors.border,backgroundColor:colors.surface},progress:{flexDirection:'row',gap:6},segment:{height:4,borderRadius:4,flex:1}});
