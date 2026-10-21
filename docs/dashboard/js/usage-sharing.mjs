// Upload stays local. Only an explicit, confirmed Save publishes to GitHub.
export const REPOSITORY='hikary83/kic-worktools';
export const BRANCH='main';
export const SHARED_PATH='docs/dashboard/shared-data';
export const SHARED_FILES=Object.freeze({customerChanges:'customer-changes.xlsx',customerAccess:'customer-access.xlsx',adminChanges:'admin-changes.xlsx',adminAccess:'admin-access.xlsx',proxy:'proxy-logins.xlsx',errors:'system-errors.xlsx'});
const MAX_SIZE=40*1024*1024;
const SHA=/^[a-f0-9]{40}$/;
const failure=message=>new Error(message);
export async function sha256(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');}
export function validateManifest(value){
  if(!value||value.schema!==1||!value.files||typeof value.files!=='object'||Array.isArray(value.files))throw failure('공통 자료 목록 형식이 올바르지 않습니다.');
  const entries=Object.entries(value.files);
  if(!entries.length)return null;
  if(!/^[A-Za-z0-9._-]{1,100}$/.test(value.revision||'')||!Number.isFinite(Date.parse(value.updatedAt||'')))throw failure('공통 자료 버전 정보가 올바르지 않습니다.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value.basisDate||''))throw failure('공통 자료 기준일을 확인하지 못했습니다.');
  for(const [kind,file] of entries){
    if(!Object.hasOwn(SHARED_FILES,kind)||!file||file.path!==SHARED_FILES[kind]||!Number.isInteger(file.size)||file.size<1||file.size>MAX_SIZE||!/^[a-f0-9]{64}$/.test(file.sha256||'')||typeof file.name!=='string'||!/\.xlsx$/i.test(file.name)||file.name.length>255||/[\/\\\x00-\x1f]/.test(file.name))throw failure('공통 자료의 파일 정보가 올바르지 않습니다.');
  }
  return value;
}
export function sharedDecision(cached,manifest,{force=false}={}){
  if(!manifest)return 'missing';
  if(force||!cached)return 'load';
  if(cached.source==='local-upload')return 'keep-local';
  if(cached.revision===manifest.revision)return 'same';
  const cachedTime=Date.parse(cached.contentUpdatedAt||'');
  if(!Number.isFinite(cachedTime)||Date.parse(manifest.updatedAt)>cachedTime)return 'load';
  return 'keep-newer';
}
export async function fetchManifest(base,fetcher=fetch){
  const response=await fetcher(new URL('manifest.json?t='+Date.now(),base),{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(20000)});
  if(response.status===404)return null;
  if(!response.ok)throw failure('공통 자료 목록을 불러오지 못했습니다. (HTTP '+response.status+')');
  try{return validateManifest(await response.json());}catch(error){throw failure(error.message?.startsWith('공통 자료')?error.message:'공통 자료 목록을 읽지 못했습니다.');}
}
export async function fetchSnapshot(base,manifest,fetcher=fetch){
  validateManifest(manifest);const result={};
  for(const [kind,info] of Object.entries(manifest.files)){
    const response=await fetcher(new URL(info.path+'?revision='+encodeURIComponent(manifest.revision),base),{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw failure('공통 엑셀을 불러오지 못했습니다. 잠시 후 다시 불러오기를 눌러 주세요. (HTTP '+response.status+')');
    const bytes=await response.arrayBuffer();
    if(bytes.byteLength!==info.size||await sha256(bytes)!==info.sha256)throw failure('공통 파일의 배포가 아직 완료되지 않았거나 파일이 일치하지 않습니다. 현재 자료는 유지하며, 잠시 후 다시 불러와 주세요.');
    result[kind]=new File([bytes],info.name,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }
  return result;
}
function base64(bytes){let binary='';const array=new Uint8Array(bytes);for(let i=0;i<array.length;i+=16384)binary+=String.fromCharCode(...array.subarray(i,i+16384));return btoa(binary);}
export async function publishSnapshot(files,basisDate,token,{fetcher=fetch,onProgress=()=>{},now=()=>new Date(),revision=()=>crypto.randomUUID()}={}){
  if(!token?.trim())throw failure('GitHub 토큰을 먼저 설정해 주세요.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(basisDate||''))throw failure('저장할 자료의 기준일을 확인하지 못했습니다.');
  const entries=Object.entries(files);
  if(!entries.length||entries.some(([kind,file])=>!Object.hasOwn(SHARED_FILES,kind)||!file||file.size<1||file.size>MAX_SIZE))throw failure('저장할 원본 엑셀을 다시 Upload해 주세요.');
  const manifest={schema:1,revision:revision(),basisDate,updatedAt:now().toISOString(),files:Object.fromEntries(entries.map(([kind,file])=>[kind,{path:SHARED_FILES[kind],name:file.name,size:file.size,sha256:'0'.repeat(64)}]))};
  validateManifest(manifest);
  const api=async(path,method='GET',body)=>{
    let response;
    try{response=await fetcher('https://api.github.com/repos/'+REPOSITORY+path,{method,headers:{Authorization:'Bearer '+token.trim(),Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(60000)});}
    catch(_){throw failure(method==='PATCH'?'저장 결과를 확인하지 못했습니다. 공통 자료를 확인한 뒤 다시 시도해 주세요.':'GitHub 통신에 실패했습니다. 자동 재시도하지 않았으며 현재 자료는 유지합니다.');}
    if(!response.ok){
      const status=response.status;
      throw failure([401,403].includes(status)?'GitHub 토큰 또는 저장소 Contents 쓰기 권한을 확인해 주세요. (HTTP '+status+')':[409,422].includes(status)?'저장소에 다른 변경이 있거나 저장 요청이 거부됐습니다. 현재 자료를 유지하며, 공통 자료를 확인한 뒤 다시 Save해 주세요. (HTTP '+status+')':'GitHub 저장 요청에 실패했습니다. (HTTP '+status+')');
    }
    try{return await response.json();}catch(_){throw failure('GitHub 저장 응답을 읽지 못했습니다. 공통 자료를 확인해 주세요.');}
  };
  onProgress('공통 저장 위치 확인 중…');
  const head=(await api('/git/ref/heads/'+BRANCH)).object?.sha;
  if(!SHA.test(head||''))throw failure('저장소의 현재 버전을 확인하지 못했습니다.');
  const treeSha=(await api('/git/commits/'+head)).tree?.sha;
  if(!SHA.test(treeSha||''))throw failure('기존 저장소 파일 목록을 확인하지 못했습니다.');
  const tree=[];
  for(const [index,[kind,file]] of entries.entries()){
    onProgress(`원본 엑셀 저장 준비 중… ${index+1}/${entries.length}`);
    const bytes=await file.arrayBuffer(),blob=await api('/git/blobs','POST',{encoding:'base64',content:base64(bytes)});
    if(!SHA.test(blob.sha||''))throw failure('엑셀 저장 준비 결과를 확인하지 못했습니다.');
    manifest.files[kind]={path:SHARED_FILES[kind],name:file.name,size:bytes.byteLength,sha256:await sha256(bytes)};
    tree.push({path:SHARED_PATH+'/'+SHARED_FILES[kind],mode:'100644',type:'blob',sha:blob.sha});
  }
  validateManifest(manifest);
  tree.push({path:SHARED_PATH+'/manifest.json',mode:'100644',type:'blob',content:JSON.stringify(manifest,null,2)+'\n'});
  onProgress('엑셀과 공통 목록을 하나의 버전으로 저장 중…');
  const newTree=await api('/git/trees','POST',{base_tree:treeSha,tree});
  if(!SHA.test(newTree.sha||''))throw failure('공통 자료 버전을 준비하지 못했습니다.');
  const commit=await api('/git/commits','POST',{message:'data: update CWIZ usage logs for '+basisDate,tree:newTree.sha,parents:[head]});
  if(!SHA.test(commit.sha||''))throw failure('공통 자료 커밋 결과를 확인하지 못했습니다.');
  await api('/git/refs/heads/'+BRANCH,'PATCH',{sha:commit.sha,force:false});
  return {manifest,commit:commit.sha};
}
