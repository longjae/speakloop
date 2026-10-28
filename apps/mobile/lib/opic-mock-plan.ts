import type { Scenario } from './api';
import type { MockExam } from './opic-mock';
export const surveyTopics=['home','travel','park','music','exercise','technology'];
export function buildMockQuestions(bank:Scenario[],topics:string[],count:12|15,random:()=>number=Math.random):Scenario[]{
 const pick=(values:Scenario[])=>values[Math.min(values.length-1,Math.floor(random()*values.length))];
 const exact=(topic:string,kind:string)=>{const item=pick(bank.filter(s=>s.topic===topic&&s.question_type===kind));if(!item)throw new Error('필요한 시험 문항이 없습니다. 시나리오를 새로 불러와 주세요.');return item;};
 const chosen=[...new Set(topics)].filter(t=>surveyTopics.includes(t)).slice(0,2);
 if(chosen.length!==2)throw new Error('관심 주제를 2개 선택해 주세요.');
 const rest=surveyTopics.filter(t=>!chosen.includes(t));const surprise=rest[Math.floor(random()*rest.length)];
 const intro=bank.find(s=>s.question_type==='introduction');if(!intro)throw new Error('자기소개 문항이 없습니다.');
 const result=[intro,...chosen.flatMap(t=>['description','routine','past'].map(k=>exact(t,k)))];
 result.push(...(count===15?['description','routine','past']:['description','past']).map(k=>exact(surprise,k)));
 result.push(...['roleplay_question','roleplay_solution','roleplay_experience'].map(k=>exact('booking',k)));
 if(count===15){const compare=pick(bank.filter(s=>s.question_type==='comparison'));const opinion=pick(bank.filter(s=>s.question_type==='opinion'));if(!compare||!opinion)throw new Error('심화 문항이 없습니다.');result.push(compare,opinion);}
 return result;
}
export function adjustMockQuestions(exam:MockExam,bank:Scenario[],choice:'easier'|'same'|'harder'):MockExam{
 if(choice==='same')return {...exam,adjusted:true,phase:'exam'};
 const used=new Set(exam.questions.slice(0,7).map(q=>q.id));
 const tail=exam.questions.slice(7);
 const available=bank.filter(q=>!used.has(q.id)&&!tail.some(t=>t.id===q.id));
 const replacements=available.filter(q=>choice==='easier'?['description','routine'].includes(q.question_type??''):q.question_type==='opinion');
 const questions=[...exam.questions];
 // Keep each connected topic/role-play set intact. Adjust only the final pair.
 if(exam.count===15&&replacements.length>=2){questions[13]=replacements[0];questions[14]=replacements[1];}
 return {...exam,questions,adjusted:true,phase:'exam'};
}
export function secondsLeft(exam:MockExam,now=Date.now()){return exam.deadline===null?2400:Math.max(0,Math.ceil((exam.deadline-now)/1000));}
