import type { ColorValue } from 'react-native';
import { StyleSheet, View } from 'react-native';

export function TabIcon({name,color}:{name:'dashboard'|'opic'|'daily'|'settings';color:ColorValue}) {
  if(name==='dashboard')return <View style={styles.grid}>{[0,1,2,3].map(n=><View key={n} style={[styles.square,{borderColor:color}]}/>)}</View>;
  if(name==='opic')return <View style={[styles.paper,{borderColor:color}]}>{[0,1,2].map(n=><View key={n} style={{height:2,width:n===2?8:12,backgroundColor:color,borderRadius:1}}/>)}</View>;
  if(name==='daily')return <View style={styles.frame}><View style={[styles.bubble,{borderColor:color,left:1,top:1}]}/><View style={[styles.bubble,{borderColor:color,left:8,top:8,backgroundColor:'transparent'}]}/></View>;
  return <View style={styles.sliders}>{[0,1,2].map(n=><View key={n} style={{height:2,width:22,backgroundColor:color,borderRadius:1}}><View style={{position:'absolute',top:-3,left:n===1?12:4,width:7,height:7,borderRadius:2,backgroundColor:color}}/></View>)}</View>;
}
const styles=StyleSheet.create({grid:{width:24,height:24,flexDirection:'row',flexWrap:'wrap',gap:4},square:{width:10,height:10,borderWidth:2,borderRadius:3},paper:{width:21,height:25,borderWidth:2,borderRadius:5,padding:3,justifyContent:'space-evenly'},frame:{width:26,height:26},bubble:{position:'absolute',width:18,height:15,borderWidth:2,borderRadius:5,borderBottomLeftRadius:1},sliders:{width:24,height:24,justifyContent:'space-around',paddingVertical:2}});
