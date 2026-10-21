import test from 'node:test';
import assert from 'node:assert/strict';
import {validateManifest,sharedDecision,sha256,fetchManifest,fetchSnapshot,publishSnapshot,SHARED_FILES,SHARED_PATH} from '../docs/dashboard/js/usage-sharing.mjs';
const A='a'.repeat(40),B='b'.repeat(40),C='c'.repeat(40),D='d'.repeat(40),E='e'.repeat(40);
const now=()=>new Date('2026-10-21T06:00:00.000Z'),revision=()=> 'fixture-revision-1';
const sample=()=>new File([new Uint8Array([80,75,3,4,5,6])],'fixture_2026-10-21.xlsx');
async function manifest(){const file=sample();return {schema:1,revision:revision(),basisDate:'2026-10-21',updatedAt:now().toISOString(),files:{customerChanges:{path:SHARED_FILES.customerChanges,name:file.name,size:file.size,sha256:await sha256(await file.arrayBuffer())}}};}
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
function githubMock({fail='',status=500}={}){
  const calls=[];
  const fetcher=async(url,options)=>{
    const path=new URL(url).pathname.replace('/repos/hikary83/kic-worktools','');const body=options.body?JSON.parse(options.body):null;
    calls.push({path,method:options.method,body});
    assert.equal(new URL(url).origin,'https://api.github.com');assert(options.headers.Authorization);assert.equal(options.redirect,'error');
    if(path===fail)return json({message:'private-server-message'},status);
    if(path==='/git/ref/heads/main')return json({object:{sha:A}});
    if(path==='/git/commits/'+A)return json({tree:{sha:B}});
    if(path==='/git/blobs')return json({sha:C},201);
    if(path==='/git/trees')return json({sha:D},201);
    if(path==='/git/commits')return json({sha:E},201);
    if(path==='/git/refs/heads/main')return json({object:{sha:E}});
    throw new Error('Unexpected mock route.');
  };
  return {fetcher,calls};
}
test('첫 공통 자료가 없으면 빈 목록을 정상 처리',()=>assert.equal(validateManifest({schema:1,files:{}}),null));
test('정상 6종 컬럼 키·고정 경로와 해시를 검증',async()=>assert.equal(validateManifest(await manifest()).files.customerChanges.path,SHARED_FILES.customerChanges));
for(const mutate of [m=>m.files.customerChanges.path='../../index.html',m=>m.files.customerChanges.path='https://other.invalid/data.xlsx',m=>m.files.unknown=m.files.customerChanges,m=>m.files.customerChanges.size=0,m=>m.files.customerChanges.sha256='bad',m=>m.revision='../bad',m=>m.updatedAt='bad',m=>m.files.customerChanges.name='../file.xlsx'])test('잘못된 공통 목록을 거부: '+mutate.toString(),async()=>{const value=await manifest();mutate(value);assert.throws(()=>validateManifest(value));});
test('새 브라우저는 공통 자료를 불러온다',async()=>assert.equal(sharedDecision(null,await manifest()),'load'));
test('Save 전 Upload 자료는 서버 최신 자료로 자동 덮지 않는다',async()=>assert.equal(sharedDecision({source:'local-upload'},await manifest()),'keep-local'));
test('Save 직후 서버 구버전이 로컬 최신 자료를 덮지 않는다',async()=>assert.equal(sharedDecision({source:'save-pending',revision:'new',contentUpdatedAt:'2026-10-22T00:00:00Z'},await manifest()),'keep-newer'));
test('같은 공유 버전은 재다운로드하지 않는다',async()=>assert.equal(sharedDecision({source:'save-pending',revision:revision()},await manifest()),'same'));
test('서버가 더 최신이면 공통 자료를 갱신한다',async()=>assert.equal(sharedDecision({source:'server',revision:'old',contentUpdatedAt:'2026-10-20T00:00:00Z'},await manifest()),'load'));
test('강제 다시 불러오기는 내 미저장 자료보다 공통 자료를 우선한다',async()=>assert.equal(sharedDecision({source:'local-upload'},await manifest(),{force:true}),'load'));
test('공통 목록은 인증정보 없이 캐시 무시로 읽는다',async()=>{const value=await manifest();const found=await fetchManifest('https://example.invalid/shared-data/',async(url,options)=>{assert(url.pathname.endsWith('/manifest.json'));assert.equal(options.credentials,'omit');assert.equal(options.cache,'no-store');assert(!options.headers);return json(value);});assert.equal(found.revision,value.revision);});
test('공통 목록 404는 미저장 상태',async()=>assert.equal(await fetchManifest('https://example.invalid/',async()=>new Response('',{status:404})),null));
test('캐시의 서버 시간이 손상되어도 최신 공통 자료 복원 가능',async()=>assert.equal(sharedDecision({source:'server',contentUpdatedAt:'invalid'},await manifest()),'load'));
test('대문자 XLSX 확장자도 업로드와 공통 보관에서 동일하게 지원',async()=>{const value=await manifest();value.files.customerChanges.name='fixture.XLSX';assert(validateManifest(value));});
test('잘못된 원본 파일명은 원격 쓰기 전에 거부',async()=>await assert.rejects(publishSnapshot({customerChanges:new File(['bytes'],'../file.xlsx')},'2026-10-21','fixture-token',{fetcher:()=>{assert.fail('Must not send any request.');}}),/파일 정보/));
test('공통 엑셀의 크기와 해시 일치 후 File로 복원',async()=>{const value=await manifest(),file=sample();const files=await fetchSnapshot('https://example.invalid/shared-data/',value,async(url,options)=>{assert.equal(options.credentials,'omit');assert.equal(url.searchParams.get('revision'),value.revision);return new Response(await file.arrayBuffer());});assert(files.customerChanges instanceof File);assert.equal(files.customerChanges.name,file.name);});
test('배포 중 옛 엑셀 또는 손상 파일은 채택하지 않는다',async()=>{const value=await manifest();await assert.rejects(fetchSnapshot('https://example.invalid/',value,async()=>new Response('wrong')),/일치하지/);});
test('토큰이 없으면 GitHub를 호출하지 않는다',async()=>{await assert.rejects(publishSnapshot({customerChanges:sample()},'2026-10-21','',{fetcher:()=>{throw new Error('Must not call');}}),/토큰/);});
test('알 수 없는 파일 종류는 원격 쓰기 전에 거부',async()=>{await assert.rejects(publishSnapshot({unexpected:sample()},'2026-10-21','fixture-token',{fetcher:()=>{throw new Error('Must not call');}}),/원본/);});
test('원본 파일과 목록을 하나의 커밋에 묶고 기존 트리를 보존',async()=>{
  const mock=githubMock(),files={customerChanges:sample(),adminAccess:sample()};
  const result=await publishSnapshot(files,'2026-10-21','fixture-token',{...mock,now,revision});
  const tree=mock.calls.find(call=>call.path==='/git/trees').body;assert.equal(tree.base_tree,B);assert.equal(tree.tree.length,3);assert(tree.tree.every(entry=>entry.path.startsWith(SHARED_PATH+'/')));assert(!tree.tree.some(entry=>entry.path.includes('/dashboard/data/')));
  const commit=mock.calls.find(call=>call.path==='/git/commits').body;assert.deepEqual(commit.parents,[A]);assert.equal(commit.tree,D);
  const update=mock.calls.at(-1);assert.equal(update.path,'/git/refs/heads/main');assert.deepEqual(update.body,{sha:E,force:false});assert.equal(result.commit,E);
  assert(!JSON.stringify(tree).includes('fixture-token'));assert(!JSON.stringify(result.manifest).includes('fixture-token'));
});
test('원본 바이트를 base64로 보존하며 조회용 이름도 보존',async()=>{const mock=githubMock(),file=sample();const result=await publishSnapshot({customerChanges:file},'2026-10-21','fixture-token',{...mock,now,revision});const blob=mock.calls.find(call=>call.path==='/git/blobs').body;assert.deepEqual(Buffer.from(blob.content,'base64'),Buffer.from(await file.arrayBuffer()));assert.equal(result.manifest.files.customerChanges.name,file.name);});
for(const step of ['/git/blobs','/git/trees','/git/commits'])test('중간 실패 시 공개 브랜치를 갱신하지 않음: '+step,async()=>{const mock=githubMock({fail:step});await assert.rejects(publishSnapshot({customerChanges:sample()},'2026-10-21','fixture-token',{...mock,now,revision}));assert(!mock.calls.some(call=>call.path==='/git/refs/heads/main'));});
test('동시 커밋 충돌은 강제로 덮지 않고 자동 재시도하지 않는다',async()=>{const mock=githubMock({fail:'/git/refs/heads/main',status:409});await assert.rejects(publishSnapshot({customerChanges:sample()},'2026-10-21','fixture-token',{...mock,now,revision}),/다른 변경/);assert.equal(mock.calls.filter(call=>call.path==='/git/refs/heads/main').length,1);});
test('권한 오류는 서버 원문·토큰 없이 안내',async()=>{const mock=githubMock({fail:'/git/ref/heads/main',status:403});try{await publishSnapshot({customerChanges:sample()},'2026-10-21','fixture-token',{...mock,now,revision});assert.fail('Must reject');}catch(error){assert.match(error.message,/권한/);assert.doesNotMatch(error.message,/private-server-message|fixture-token/);}});
