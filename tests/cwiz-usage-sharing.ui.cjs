// GitHub writes and shared hosting are fully mocked. No real log is published.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const [origin,sourceDir]=process.argv.slice(2);
if(!origin||!sourceDir||!['127.0.0.1','localhost'].includes(new URL(origin).hostname))throw new Error('Use a local preview and the supplied source directory.');
const names=['관리자활동이력_2026-10-21.xlsx','대리로그인이력_2026-10-21.xlsx','시스템오류이력_2026-10-21.xlsx','보안접속이력_2026-10-21.xlsx','데이터변경이력_2026-10-21.xlsx','보안접속이력_2026-10-21 (1).xlsx'];
const paths=names.map(name=>path.join(sourceDir,name));
const HEAD='a'.repeat(40),TREE='b'.repeat(40),NEW_TREE='d'.repeat(40),COMMIT='e'.repeat(40),fakeToken='test-only-token-not-real';
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const blobs=new Map(),errors=[],contexts=[];let treeEntries=[],pending=null,active=null,wrongHash=false,writes=0,updates=0,forbid=false;
  const makeContext=async()=>{
    const context=await browser.newContext({viewport:{width:1500,height:1000}});contexts.push(context);
    await context.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.origin==='https://api.github.com'){
        assert.equal(request.headers().authorization,'Bearer '+fakeToken);const endpoint=url.pathname.replace('/repos/hikary83/kic-worktools','');
        const reply=(value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
        if(forbid)return reply({message:'private-upstream-error'},403);
        if(request.method()!=='GET')writes++;
        const body=request.postDataJSON();
        if(endpoint==='/git/ref/heads/main')return reply({object:{sha:HEAD}});
        if(endpoint==='/git/commits/'+HEAD)return reply({tree:{sha:TREE}});
        if(endpoint==='/git/blobs'){const sha=(blobs.size+1).toString(16).padStart(40,'0');blobs.set(sha,Buffer.from(body.content,'base64'));return reply({sha},201);}
        if(endpoint==='/git/trees'){treeEntries=body.tree;assert.equal(body.base_tree,TREE);return reply({sha:NEW_TREE},201);}
        if(endpoint==='/git/commits')return reply({sha:COMMIT},201);
        if(endpoint==='/git/refs/heads/main'){
          assert.equal(body.force,false);updates++;
          const manifest=JSON.parse(treeEntries.find(entry=>entry.path.endsWith('manifest.json')).content),files={};
          for(const entry of treeEntries.filter(entry=>entry.sha))files[entry.path.split('/').at(-1)]=blobs.get(entry.sha);
          assert(!JSON.stringify(manifest).includes(fakeToken));pending={manifest,files};return reply({object:{sha:COMMIT}});
        }
        throw new Error('Unexpected GitHub route.');
      }
      if(url.origin===new URL(origin).origin){
        if(url.pathname.includes('/shared-data/')){
          assert(!request.headers().authorization,'Shared reads must not carry the token.');
          if(url.pathname.endsWith('/manifest.json'))return route.fulfill({contentType:'application/json',body:JSON.stringify(active?.manifest||{schema:1,files:{}})});
          const bytes=active?.files[url.pathname.split('/').at(-1)];
          return route.fulfill({status:bytes?200:404,contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',body:wrongHash?Buffer.from('wrong'):bytes||Buffer.alloc(0)});
        }
        return route.continue();
      }
      throw new Error('Unexpected external request.');
    });
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.name));page.on('dialog',dialog=>dialog.accept());return {context,page};
  };
  const upload=async(page,files)=>{if(!await page.locator('#uploadDetails').isVisible())await page.locator('#toggleUpload').click();await page.locator('#logFiles').setInputFiles(files);await page.locator('#applyBtn').click();await page.waitForFunction(()=>document.querySelector('#cacheState').dataset.state==='saved'&&!document.querySelector('#applyBtn').disabled);};
  try{
    const first=await makeContext();await first.page.goto(origin+'/dashboard/');await first.page.waitForSelector('html[data-app-ready="true"]');
    await upload(first.page,paths);assert.equal(writes,0,'Upload must not publish.');
    await first.page.reload();await first.page.waitForFunction(()=>document.querySelectorAll('.source-chip.ready').length===6);assert.equal(writes,0);
    await first.page.locator('#toggleUpload').click();assert(await first.page.locator('#saveBtn').isEnabled());
    await first.page.locator('#saveBtn').click();assert(await first.page.locator('#tokenDialog').evaluate(el=>el.open));
    await first.page.locator('#ghTokenInput').fill(fakeToken);await first.page.locator('#tokenSaveBtn').click();
    await first.page.locator('#saveBtn').click();await first.page.locator('#saveCancel').click();assert.equal(writes,0,'Cancel must not publish.');
    await first.page.locator('#saveBtn').click();await first.page.locator('#saveConfirm').click();
    await first.page.waitForFunction(()=>document.querySelector('#statusNote').textContent.includes('보관한 분석 자료를 복원'));
    assert.equal(updates,1);assert(pending);assert.equal(await first.page.locator('.source-chip.ready').count(),6);
    assert((await first.page.locator('#statusNote').innerText()).includes('Save 완료'),'Old/missing hosted data must not replace the pending Save.');
    active=pending;
    const second=await makeContext();await second.page.goto(origin+'/dashboard/');await second.page.waitForFunction(()=>document.querySelectorAll('.source-chip.ready').length===6);await second.page.waitForFunction(()=>document.querySelector('#cacheState').dataset.state==='saved');
    assert.equal(await second.page.evaluate(()=>localStorage.getItem('kic_gh_token')),null);
    assert.equal((await second.page.locator('.kpi').filter({hasText:'고객 변경이력'}).locator('.kpi-value').innerText()).replace(/\D/g,''),'3306');
    await second.page.reload();await second.page.waitForFunction(()=>document.querySelectorAll('.source-chip.ready').length===6);
    await upload(second.page,[paths[3]]);assert.equal(await second.page.locator('.source-chip.ready').count(),1);
    active={...active,manifest:{...active.manifest,revision:'newer-server-version',updatedAt:'2099-01-01T00:00:00Z'}};
    await second.page.reload();await second.page.waitForFunction(()=>document.querySelector('#statusNote').textContent.includes('복원'));assert.equal(await second.page.locator('.source-chip.ready').count(),1,'An unsaved Upload should not be overwritten.');
    await second.page.locator('#toggleUpload').click();await second.page.locator('#reloadSharedBtn').click();await second.page.waitForFunction(()=>document.querySelectorAll('.source-chip.ready').length===6);
    wrongHash=true;await second.page.locator('#toggleUpload').click();await second.page.locator('#reloadSharedBtn').click();await second.page.waitForFunction(()=>document.querySelector('#statusNote').classList.contains('error'));assert.equal(await second.page.locator('.source-chip.ready').count(),6);wrongHash=false;
    await second.page.locator('#ghTokenBtn').click();await second.page.locator('#ghTokenInput').fill(fakeToken);await second.page.locator('#tokenSaveBtn').click();forbid=true;
    await second.page.locator('#saveBtn').click();await second.page.locator('#saveConfirm').click();await second.page.waitForFunction(()=>document.querySelector('#saveProgress').textContent.includes('권한'));
    assert.equal(updates,1);assert.equal(await second.page.locator('.source-chip.ready').count(),6);assert(!(await second.page.locator('#saveProgress').innerText()).includes('private-upstream-error'));
    assert.deepEqual(errors,[]);console.log('PASS: local Upload, automatic File restore, token reuse, confirmation/cancel, one-commit Save, deploy-lag protection, second browser auto-load without token, newer shared data, local draft protection, checksum failure and permission failure. No real GitHub writes.');
  }finally{await Promise.all(contexts.map(context=>context.close()));await browser.close();}
})().catch(error=>{console.error('Sharing UI check failed:',error.message);process.exitCode=1;});
