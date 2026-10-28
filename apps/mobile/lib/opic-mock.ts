import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Scenario } from './api';
import type { Accent } from './accent';

export const topicLabels:Record<string,string>={self:'자기소개',home:'집',travel:'여행',park:'공원',music:'음악',exercise:'운동',technology:'기술',booking:'예약·롤플레이',food:'음식',work:'직장',shopping:'쇼핑',daily:'일상',general:'기타'};
export const typeLabels:Record<string,string>={introduction:'자기소개',description:'묘사',routine:'일상 습관',past:'과거 경험',comparison:'비교',opinion:'의견',roleplay_question:'질문하기',roleplay_solution:'문제 해결',roleplay_experience:'관련 경험',situation:'상황 연습'};
export { surveyTopics,buildMockQuestions,adjustMockQuestions,secondsLeft } from './opic-mock-plan';
export type MockAnswer={uri?:string;duration:number;skipped?:boolean;sessionId?:string;uploadId?:string;uploadKey?:string;utteranceId?:string};
export type MockExam={version:1;id:string;owner:string;accent:Accent;questions:Scenario[];count:12|15;index:number;phase:'ready'|'exam'|'adjust'|'finished';deadline:number|null;answers:Record<number,MockAnswer>;audio:Record<string,string>;listens:Record<number,number>;adjusted:boolean;reading?:boolean};
const key=(owner:string)=>`speakloop:opic-mock:v1:${owner}`;
export async function saveMock(exam:MockExam){await AsyncStorage.setItem(key(exam.owner),JSON.stringify(exam));}
export async function readMock(owner:string):Promise<MockExam|null>{const raw=await AsyncStorage.getItem(key(owner));if(!raw)return null;const value=JSON.parse(raw) as MockExam;if(value.version!==1||value.owner!==owner||![12,15].includes(value.count)||!Array.isArray(value.questions)||value.questions.length!==value.count||!Number.isInteger(value.index)||value.index<0||value.index>=value.count||!['ready','exam','adjust','finished'].includes(value.phase)||!value.answers||!value.audio||!value.listens||(value.deadline!==null&&!Number.isFinite(value.deadline)))throw new Error('모의시험 기록을 읽지 못했습니다.');return value;}
export async function clearMock(owner:string){await AsyncStorage.removeItem(key(owner));}

