import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildMockQuestions,adjustMockQuestions,secondsLeft} from '../../apps/mobile/lib/opic-mock-plan.ts';
import type { Scenario } from '../../apps/mobile/lib/api';
import type { MockExam } from '../../apps/mobile/lib/opic-mock';
const bank=JSON.parse(readFileSync(new URL('../../content/scenarios.json',import.meta.url),'utf8')).filter((q:Scenario)=>q.mode==='opic') as Scenario[];
const makeExam=(count:12|15):MockExam=>({version:1,id:'fixture',owner:'fixture',accent:'en-US',count,index:7,phase:'adjust',deadline:100000,questions:buildMockQuestions(bank,['home','travel'],count,()=>0),answers:{},audio:{},listens:{},adjusted:false});
test('12 and 15 question plans have connected sets, role-play and no duplicates',()=>{
 for(const count of [12,15] as const){
  const questions=makeExam(count).questions;
  assert.equal(questions.length,count);assert.equal(new Set(questions.map(q=>q.id)).size,count);
  assert.equal(questions[0].question_type,'introduction');
  assert.deepEqual(questions.slice(1,4).map(q=>q.topic),['home','home','home']);
  assert.deepEqual(questions.slice(4,7).map(q=>q.topic),['travel','travel','travel']);
  assert.equal(questions.filter(q=>q.topic==='booking').length,3);
 }
});
test('difficulty adjustment preserves already answered and role-play questions',()=>{
 const exam=makeExam(15);
 for(const choice of ['easier','same','harder'] as const){
  const result=adjustMockQuestions(exam,bank,choice);
  assert.deepEqual(result.questions.slice(0,13),exam.questions.slice(0,13));
  assert.equal(new Set(result.questions.map(q=>q.id)).size,15);
  assert.equal(result.phase,'exam');
  if(choice==='easier')assert.ok(result.questions.slice(13).every(q=>['description','routine'].includes(q.question_type!)));
  if(choice==='harder')assert.ok(result.questions.slice(13).every(q=>q.question_type==='opinion'));
 }
});
test('40 minute timer uses wall time and does not pause in the background',()=>{
 const exam={...makeExam(12),deadline:2400000};
 assert.equal(secondsLeft(exam,0),2400);assert.equal(secondsLeft(exam,600000),1800);assert.equal(secondsLeft(exam,2500000),0);
});
test('invalid survey and incomplete question bank fail before the exam begins',()=>{
 assert.throws(()=>buildMockQuestions(bank,['home','home'],15));
 assert.throws(()=>buildMockQuestions([],['home','travel'],12));
});

test('all survey topic pairs produce complete unique question sets',()=>{
 const topics=['home','travel','park','music','exercise','technology'];
 for(let i=0;i<topics.length;i++)for(let j=i+1;j<topics.length;j++)for(const count of [12,15] as const)for(const value of [0,0.95]){
  const questions=buildMockQuestions(bank,[topics[i],topics[j]],count,()=>value);
  assert.equal(questions.length,count);assert.equal(new Set(questions.map(q=>q.id)).size,count);
 }
});
