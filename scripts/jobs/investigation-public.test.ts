import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publicInvestigation,publicResult,type AnalysisResult} from './types.ts';
const model='nvidia/nemotron-3.5-bolt-e4b';
const base={version:1,strategy:'adaptive',replay:false,plannerModel:model,outcome:'complete',
  steps:[{id:'s0',kind:'plan',tool:'probe_media',why:'Check the video bounds before selecting tools.',result:'Selected the media check.',
    status:'ok',models:[model],elapsedMs:12,observationIds:[],evidenceIds:[]}],budget:{maxHostedAttempts:10,hostedAttempts:4}};
test('additive trace survives the portable public boundary without raw trace or extra fields',()=>{
  const secret={prompt:'PRIVATE PROMPT',path:'/home/private.mp4',key:'nvapi-private',trace:['raw']};
  const investigation={...base,...secret,steps:base.steps.map(s=>({...s,...secret})),budget:{...base.budget,...secret}};
  const result={version:1,clipId:'fixture',mediaSha256:'a'.repeat(64),mode:'fresh',components:[],evidence:[],limitations:[],
    trace:[secret],elapsedMs:20,investigation} as unknown as AnalysisResult;
  const output=publicResult(result) as AnalysisResult;
  assert.deepEqual(output.investigation,base);assert.equal(output.trace,undefined);
  for(const forbidden of ['PRIVATE','/home','nvapi','prompt','key','path'])assert.ok(!JSON.stringify(output).includes(forbidden));
  assert.deepEqual(result.investigation,investigation);
});
test('unsafe strings, malformed fields, arbitrary tools and models fail closed',()=>{
  for(const why of ['/home/private','file:///secret','Bearer token','nvapi-secret','data:image/png','line\nsecret','', 'x'.repeat(241)])
    assert.equal(publicInvestigation({...base,steps:[{...base.steps[0],why}]}),undefined);
  for(const patch of [{elapsedMs:-1},{elapsedMs:Infinity},{models:['invented']},{tool:'shell'},{observationIds:['/tmp/private']},
    {evidenceIds:[null]},{kind:'thought'},{result:{}},{status:'verified'}])
    assert.equal(publicInvestigation({...base,steps:[{...base.steps[0],...patch}]}),undefined);
  for(const patch of [{steps:Array(25).fill(base.steps[0])},{steps:[base.steps[0],base.steps[0]]},{replay:'yes'},
    {budget:{maxHostedAttempts:10,hostedAttempts:11}},{plannerModel:'other'}])assert.equal(publicInvestigation({...base,...patch}),undefined);
});
test('replay, unavailable steps and partial final results remain explicit',()=>{
  const value={...base,replay:true,outcome:'partial',steps:[{...base.steps[0],kind:'replan',status:'unavailable',models:[]}]};
  assert.deepEqual(publicInvestigation(value),value);
  assert.equal(publicInvestigation(undefined),undefined);
  const clean=publicInvestigation(base)!;clean.steps[0].models.push('changed');assert.deepEqual(base.steps[0].models,[model]);
});

test("unknown historical admission totals are explicitly preserved",()=>{
 const value={...base,budget:{maxHostedAttempts:0,hostedAttempts:0,recorded:false}};
 assert.deepEqual(publicInvestigation(value),value);
 assert.equal(publicInvestigation({...base,budget:{...base.budget,recorded:"no"}}),undefined);
});
