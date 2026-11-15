const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const filename = path.resolve(__dirname, '../src/services/scientificSession.ts');
const unit = new Module(filename);unit.filename = filename;unit.paths = module.paths;
unit._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
const {decodeArray,scientificApiBase,prepareScientificSession}=unit.exports;
test('Scientific binary transport retains valid zero and missing; rejects truncated data',()=>{
  const fixture={isMock:true,values:Float32Array.from([0,NaN,2])};
  const wire={dtype:'float32-le',length:3,data:Buffer.from(fixture.values.buffer).toString('base64')};
  const result=decodeArray(wire);assert.equal(result[0],0);assert.ok(Number.isNaN(result[1]));assert.equal(result[2],2);
  assert.throws(()=>decodeArray({...wire,length:4}),/length/);
});
test('Scientific endpoint normalizes existing URL convention without a synthetic fallback',async()=>{
  const before=process.env.NEXT_PUBLIC_BACKEND_URL,other=process.env.NEXT_PUBLIC_API_URL;
  const original=global.fetch;
  try{
    process.env.NEXT_PUBLIC_BACKEND_URL='http://example.invalid/api/v1/';assert.equal(scientificApiBase(),'http://example.invalid/api/v1/scientific');
    global.fetch=async()=>({ok:false,status:503,json:async()=>({detail:'No verified catalog'})});
    await assert.rejects(prepareScientificSession({},new AbortController().signal),/503.*No verified catalog/);
  }finally{global.fetch=original;if(before===undefined)delete process.env.NEXT_PUBLIC_BACKEND_URL;else process.env.NEXT_PUBLIC_BACKEND_URL=before;if(other===undefined)delete process.env.NEXT_PUBLIC_API_URL;else process.env.NEXT_PUBLIC_API_URL=other;}
});
test('Audio renderer consumes the server arrangement rather than rebuilding it',async()=>{
  const {ContextSynth}=await import('../public/audio/geos-cf-orchestration.mjs');
  const fixture={isMock:true,steps:1,lanes:1,mean:Float32Array.of(0),positions:Float32Array.of(.5),audioMax:100,
    contextPlan:{version:'synthetic-fixture',windowSteps:1,windows:[],gradient:Float32Array.of(0),curvature:Float32Array.of(0)}};
  const synth=new ContextSynth(fixture,48000,180);assert.equal(synth.plan,fixture.contextPlan);
});
