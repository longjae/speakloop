import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './ui';
import { colors, ui } from '../lib/theme';
import { Accent, accentLabels } from '../lib/accent';

export function AccentSelector({ value,onChange,disabled=false }: { value:Accent;onChange:(value:Accent)=>void;disabled?:boolean }) {
  return <View style={styles.group}>
    <Text style={ui.label}>연습할 영어</Text>
    <View style={styles.options} accessibilityRole="radiogroup" accessibilityLabel="영어 발음 기준">
      {(['en-US','en-GB'] as const).map(accent=><Pressable key={accent} accessibilityRole="radio" accessibilityState={{checked:value===accent,disabled}} disabled={disabled} onPress={()=>onChange(accent)} style={({pressed})=>[styles.option,value===accent&&styles.selected,(disabled||pressed)&&styles.dim]}><Text style={value===accent?styles.selectedText:undefined}>{accentLabels[accent]}</Text></Pressable>)}
    </View>
    <Text>선택한 영어를 코칭과 예문 음성에 사용합니다. 다른 억양도 존중합니다.</Text>
  </View>;
}
const styles=StyleSheet.create({group:{gap:12},options:{flexDirection:'row',gap:12},option:{flex:1,minHeight:52,padding:14,borderRadius:14,borderWidth:1,borderColor:colors.border,alignItems:'center',justifyContent:'center',backgroundColor:colors.surface},selected:{borderColor:colors.mint,backgroundColor:colors.elevated},selectedText:{color:colors.mint,fontWeight:'700'},dim:{opacity:0.5}});
