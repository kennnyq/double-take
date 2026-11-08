import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicVerdict, publicResult, type AnalysisResult } from './types.ts';
const result = (verdict?: unknown): AnalysisResult => ({ version:1,clipId:'fixture',mediaSha256:'a'.repeat(64),mode:'fresh',
  components:[{component:'visuals',assessment:'unknown',decision:'indicators_found',summary:'Look at the highlighted moment.',evidenceIds:[]}],
  evidence:[],limitations:[],trace:[],elapsedMs:1,...(verdict === undefined ? {} : {verdict}) } as AnalysisResult);
const base = { label:'likely_ai',drivers:['Visible details point toward generated content.'] };
test('both binary labels survive without inventing confidence; component decision stays portable',()=>{
  for (const label of ['likely_ai','likely_real']) {
    const r=result({...base,label}), before=JSON.stringify(r), out=publicResult(r) as AnalysisResult;
    assert.deepEqual(out.verdict,{...base,label});assert.equal(out.components[0].decision,'indicators_found');
    assert.equal('confidence' in out.verdict!,false);assert.equal('calibration' in out.verdict!,false);assert.equal(JSON.stringify(r),before);
  }
  assert.equal((publicResult(result()) as AnalysisResult).verdict,undefined);
});
test('bounded feed-calibrated confidence retains exact probability including endpoints',()=>{
  for (const confidence of [0,.25,.75,1]) {
    assert.deepEqual(publicVerdict({...base,confidence,calibration:{version:'feed-v1.2',scope:'feed-domain'}}),{
      ...base,confidence,calibration:{version:'feed-v1.2',scope:'feed-domain'},
    });
  }
});
test('malformed label/drivers omit entire verdict without dropping result',()=>{
  for (const verdict of [null,[],{}, {...base,label:'unknown'},{...base,label:['likely_ai']},
    {...base,drivers:[]},{...base,drivers:'text'},{...base,drivers:[{}]},{...base,drivers:['']},{...base,drivers:['   ']},
    {...base,drivers:['x'.repeat(241)]},{...base,drivers:Array(9).fill('short')},{...base,drivers:['line\nprivate']},
    {...base,drivers:['control\u0000']}]) {
    assert.equal(publicVerdict(verdict),undefined);
    const out=publicResult(result(verdict)) as AnalysisResult;assert.equal(out.verdict,undefined);assert.equal(out.version,1);
  }
});
test('malformed or unsupported optional confidence is omitted, never coerced or clamped',()=>{
  for (const patch of [
    {confidence:NaN},{confidence:Infinity},{confidence:-.1},{confidence:1.1},{confidence:'0.9'},{confidence:null},
    {confidence:.9},{confidence:.9,calibration:{}},{confidence:.9,calibration:{version:'v1',scope:'general-world'}},
    {confidence:.9,calibration:{version:'',scope:'feed-domain'}},{confidence:.9,calibration:{version:'x'.repeat(129),scope:'feed-domain'}},
    {confidence:.9,calibration:{version:'/private/calibration.json',scope:'feed-domain'}},
    {calibration:{version:'v1',scope:'feed-domain'}},
  ]) assert.deepEqual(publicVerdict({...base,...patch}),base);
});
test('verdict and calibration expose only allowlisted fields; traces and custom private fields are stripped',()=>{
  const privateFields={rawScore:.93,trace:[{path:'/private/media',modelName:'private-model'}],modelName:'private-model',path:'/private/media',calibrationMediaSha256:['private-hash'],custom:{nested:'private-value'}};
  const raw={...base,...privateFields,confidence:.8,calibration:{version:'feed-v1',scope:'feed-domain',...privateFields}};
  const r={...result(raw),...privateFields,trace:[privateFields]} as unknown as AnalysisResult;
  const out=publicResult(r) as AnalysisResult;
  assert.deepEqual(out.verdict,{...base,confidence:.8,calibration:{version:'feed-v1',scope:'feed-domain'}});
  assert.equal(out.trace,undefined);
  const serialized=JSON.stringify(out);
  for(const forbidden of ['rawScore','trace','modelName','/private/','private-hash','private-value','custom','calibrationMediaSha256']) assert.equal(serialized.includes(forbidden),false,forbidden);
});
test('maximum valid driver envelope is accepted and copied, not aliased',()=>{
  const drivers=Array(8).fill('x'.repeat(240));const out=publicVerdict({...base,drivers})!;
  assert.equal(out.drivers.length,8);drivers[0]='changed';assert.equal(out.drivers[0].length,240);
});
