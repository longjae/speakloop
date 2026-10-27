import { createContext, useContext, useEffect, useState } from 'react';
import type { PropsWithChildren } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

const AuthContext=createContext<{session:Session|null;loading:boolean;error:string}>({session:null,loading:true,error:''});
export function AuthProvider({children}:PropsWithChildren) {
  const [session,setSession]=useState<Session|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  useEffect(()=>{
    if(!supabase){setLoading(false);return;}
    let active=true;
    let authEvents=0;
    const {data}=supabase.auth.onAuthStateChange((_event,value)=>{authEvents++;if(active){setSession(value);setLoading(false);}});
    supabase.auth.getSession().then(({data,error:failure})=>{
      if(!active)return;
      if(authEvents===0)setSession(data.session);
      if(failure)setError('로그인 정보를 확인하지 못했습니다. 다시 로그인해 주세요.');
      setLoading(false);
    }).catch(()=>{if(active){setError('로그인 정보를 불러오지 못했습니다.');setLoading(false);}});
    return ()=>{active=false;data.subscription.unsubscribe();};
  },[]);
  return <AuthContext.Provider value={{session,loading,error}}>{children}</AuthContext.Provider>;
}
export function useAuth(){return useContext(AuthContext);}
