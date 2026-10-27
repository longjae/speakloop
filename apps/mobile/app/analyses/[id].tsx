import { Redirect, useLocalSearchParams } from 'expo-router';

export default function AnalysisEntry() {
  const {id}=useLocalSearchParams<{id:string}>();
  return <Redirect href={{pathname:'/feedback/[id]/[step]',params:{id,step:'overview'}}}/>;
}
