const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const filename = path.resolve(__dirname, '../src/services/scientificSession.ts');
const unit = new Module(filename);unit.filename = filename;unit.paths = module.paths;
unit.require = name => {
  if (name !== './backendApi') return require(name);
  const target = path.resolve(__dirname, '../src/services/backendApi.ts');
  const adapter = new Module(target); adapter.filename = target; adapter.paths = module.paths;
  adapter._compile(ts.transpileModule(fs.readFileSync(target, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, target);
  return adapter.exports;
};
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
test('Scientific sessions follow the same-origin runtime proxy when public URLs are unset',()=>{
  const before=process.env.NEXT_PUBLIC_BACKEND_URL,other=process.env.NEXT_PUBLIC_API_URL,oldWindow=global.window;
  try{
    delete process.env.NEXT_PUBLIC_BACKEND_URL;delete process.env.NEXT_PUBLIC_API_URL;global.window={};
    assert.equal(scientificApiBase(),'/api/v1/scientific');
  }finally{
    if(before===undefined)delete process.env.NEXT_PUBLIC_BACKEND_URL;else process.env.NEXT_PUBLIC_BACKEND_URL=before;
    if(other===undefined)delete process.env.NEXT_PUBLIC_API_URL;else process.env.NEXT_PUBLIC_API_URL=other;
    if(oldWindow===undefined)delete global.window;else global.window=oldWindow;
  }
});

function loadScientificStatus() {
  const statusFile = path.resolve(__dirname, '../src/services/scientificStatus.ts');
  const statusMod = new Module(statusFile); statusMod.filename = statusFile; statusMod.paths = module.paths;
  statusMod._compile(ts.transpileModule(fs.readFileSync(statusFile, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, statusFile);
  return statusMod.exports;
}

test('describeScientificStatus classifies HTTP 503 unmounted catalog errors as retryable', () => {
  const { describeScientificStatus } = loadScientificStatus();
  const notice = describeScientificStatus(
    'Error: Scientific API 503: Verified catalog is not exported/mounted. Run the existing exporter manually.',
    0,
    false
  );
  assert.ok(notice);
  assert.equal(notice.kind, 'unmounted');
  assert.equal(notice.canRetry, true);
  assert.match(notice.title, /unavailable|not.*mounted/i);
  assert.match(notice.detail, /Scientific API 503/);
  assert.match(notice.detail, /Verified catalog is not exported\/mounted/);

  const withoutPrefix = describeScientificStatus('Scientific API 503: No verified catalog', 0, false);
  assert.ok(withoutPrefix);
  assert.equal(withoutPrefix.kind, 'unmounted');
  assert.equal(withoutPrefix.canRetry, true);
});

test('describeScientificStatus classifies empty ready catalog as retryable empty state', () => {
  const { describeScientificStatus } = loadScientificStatus();
  const notice = describeScientificStatus('', 0, true);
  assert.ok(notice);
  assert.equal(notice.kind, 'empty');
  assert.equal(notice.canRetry, true);
  assert.match(notice.title, /0 verified|no verified/i);
  assert.match(notice.detail, /0 verified NASA.*indexed/i);
});

test('describeScientificStatus preserves non-503 scientific API errors without catalog retry', () => {
  const { describeScientificStatus } = loadScientificStatus();
  const notice = describeScientificStatus('Error: Scientific API 409: Calibration differs', 24, true);
  assert.ok(notice);
  assert.equal(notice.kind, 'error');
  assert.equal(notice.canRetry, false);
  assert.ok(notice.title.length > 0);
  assert.match(notice.detail, /Error: Scientific API 409: Calibration differs/);
});

test('describeScientificStatus returns null when catalog has ready snapshots or is still loading without error', () => {
  const { describeScientificStatus } = loadScientificStatus();
  assert.equal(describeScientificStatus('', 24, true), null);
  assert.equal(describeScientificStatus('', 0, false), null);
  assert.equal(describeScientificStatus('   ', 1, true), null);
});
