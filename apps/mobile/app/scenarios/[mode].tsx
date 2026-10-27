import { Redirect, useLocalSearchParams } from 'expo-router';
export default function LegacyScenarioRoute(){const {mode}=useLocalSearchParams<{mode:string}>();return <Redirect href={mode==='opic'?'/opic':mode==='daily'?'/daily':'/dashboard'}/>;}
