/* 목록 이미지는 추천용입니다. 기존 등록 폼과 별개인 서버 승인 토큰으로만 중간 삽입합니다. */
(function () {
  'use strict';
  const state = { images: [], rows: [], existing: [], fingerprint: '', selected: null, filter: 'missing', generation: 0,
    busy: false, writing: false, insertion: null, needsCompare: false, focus: null };
  const byId = id => document.getElementById(id);
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
  const labels = { missing: '누락 의심', review: '확인 필요', registered: '등록 일치', reply: '답글 제외', otherDate: '다른 날짜' };
  const localDate = () => { const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'); };
  function apiError(error) {
    const message = error && error.message || String(error);
    return /Invalid post action|is not defined/.test(message) ? '업무 API에 누락 점검 기능이 아직 배포되지 않았습니다. 백엔드 재배포 후 사용할 수 있습니다.' : message;
  }
  function status(message, error) {
    byId('hd-missing-status').textContent = message || '';
    byId('hd-missing-status').setAttribute('role', error ? 'alert' : 'status');
  }
  function mount() {
    if (byId('hd-missing-dialog')) return;
    const modal = document.createElement('dialog');
    modal.id = 'hd-missing-dialog'; modal.className = 'hd-missing-dialog'; modal.setAttribute('aria-labelledby','hd-missing-heading');
    modal.innerHTML = `<header class="hd-missing-head"><div><h2 id="hd-missing-heading"><i class="fas fa-list-check" aria-hidden="true"></i> 목록 캡처 누락 점검</h2><p>같은 날짜의 원문 제목과 작성자를 비교합니다. 답글은 제외하고, Jira에 영향이 없는 경우에만 중간 등록합니다.</p></div><button type="button" data-close aria-label="누락 점검 닫기">✕</button></header>
      <div class="hd-missing-body"><div class="hd-missing-controls"><label>비교할 날짜<input type="date" id="hd-missing-date"></label><button type="button" data-files><i class="fas fa-image" aria-hidden="true"></i> 목록 이미지 첨부</button><button type="button" id="hd-missing-analyze" class="hd-missing-primary">분석·대조</button><button type="button" id="hd-missing-compare">기존 결과 다시 비교</button></div>
      <input type="file" id="hd-missing-files" accept="image/png,image/jpeg,image/webp" multiple hidden>
      <p class="hd-missing-meta"><button type="button" id="hd-missing-recover">등록 결과 재확인</button> 응답이 끊겼거나 다시 접속한 경우, 저장 표식만 확인합니다. 행을 다시 등록하지 않습니다.</p>
      <div class="hd-missing-drop" id="hd-missing-drop" tabindex="0">목록 캡처를 여기에 끌어놓거나 Ctrl+V로 붙여넣으세요. 최대 3장 · Gemini 분석에 사용되며 이미지 파일은 서버에 보관하지 않습니다.<div id="hd-missing-thumbs" class="hd-missing-thumbs"></div></div>
      <div id="hd-missing-status" class="hd-missing-status" role="status" aria-live="polite"></div><div class="hd-missing-note">시간만 보이는 캡처는 위에서 선택한 날짜로 비교합니다. 같은 제목의 별도 요청은 원문으로 확인하세요. 목록에 없는 본문·URL은 만들지 않습니다.</div>
      <div class="hd-missing-tabs" id="hd-missing-tabs" aria-label="비교 결과 분류"></div><div id="hd-missing-list" class="hd-missing-list"></div>
      <section id="hd-missing-editor" class="hd-missing-editor" hidden><h3>누락 후보 확인·삽입 위치</h3><div class="hd-missing-fields"><label>원문 제목<input id="hd-missing-title" maxlength="500"></label><label>작성자<input id="hd-missing-requester" maxlength="80"></label><label class="wide">이 항목 다음에 삽입 (기존 번호 오름차순)<select id="hd-missing-after"></select></label></div>
      <p id="hd-missing-position-hint" class="hd-missing-meta"></p><label class="hd-missing-confirm"><input type="checkbox" id="hd-missing-confirm">캡처의 원문 제목·작성자·날짜와 삽입 위치를 직접 확인했습니다.</label><div class="hd-missing-editor-actions"><span class="hd-missing-meta">번호가 바뀌는 기존 건 전체와 새 번호를 Jira에서 확인합니다.</span><button type="button" id="hd-missing-prepare" class="hd-missing-primary">Jira 확인 후 등록 준비</button></div><div id="hd-missing-block" class="hd-missing-note hd-missing-error" role="alert" hidden></div></section></div>
      <footer class="hd-missing-foot"><span>선택·분석만으로는 등록하거나 번호를 변경하지 않습니다.</span><button type="button" data-close>닫기</button></footer>`;
    document.body.appendChild(modal);
    modal.querySelectorAll('[data-close]').forEach(button=>button.onclick=close);
    modal.querySelector('[data-files]').onclick=()=>byId('hd-missing-files').click();
    modal.addEventListener('cancel',event=>{event.preventDefault();close();});
    modal.addEventListener('click',event=>{if(event.target===modal){const r=modal.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close();}});
    byId('hd-missing-date').onchange=()=>{state.generation++;state.rows=[];state.existing=[];state.fingerprint='';state.selected=null;state.needsCompare=true;render();status('날짜가 변경됐습니다. 분석·대조를 다시 실행해 주세요.');};
    byId('hd-missing-files').onchange=event=>readFiles(event.target.files);
    byId('hd-missing-analyze').onclick=analyze;
    byId('hd-missing-compare').onclick=compare;
    byId('hd-missing-recover').onclick=recover;
    byId('hd-missing-prepare').onclick=prepare;
    byId('hd-missing-confirm').onchange=()=>{byId('hd-missing-prepare').disabled=state.busy||!byId('hd-missing-confirm').checked;};
    const drop=byId('hd-missing-drop');
    drop.addEventListener('dragover',event=>event.preventDefault());
    drop.addEventListener('drop',event=>{event.preventDefault();readFiles(event.dataTransfer.files);});
    document.addEventListener('paste',event=>{if(!modal.open||state.busy)return;const files=Array.from(event.clipboardData?.items||[]).filter(item=>item.type.startsWith('image/')).map(item=>item.getAsFile()).filter(Boolean);if(files.length){event.preventDefault();readFiles(files);}});
  }
  function setBusy(value) {
    state.busy=value;
    ['hd-missing-analyze','hd-missing-compare','hd-missing-recover','hd-missing-date','hd-missing-files'].forEach(id=>byId(id).disabled=value);
    byId('hd-missing-prepare').disabled=value||!byId('hd-missing-confirm').checked;
    byId('hd-missing-dialog').querySelector('[data-files]').disabled=value;
    renderList();
  }
  function renderList() {
    const shown=state.rows.filter(row=>state.filter==='all'||row.kind===state.filter);
    byId('hd-missing-list').innerHTML=shown.length?shown.map(row=>`<div class="hd-missing-row ${state.selected===row.key?'is-selected':''}"><span><span class="hd-missing-badge ${escape(row.kind)}">${labels[row.kind]||'확인 필요'}</span></span><div><strong>${escape(row.title||'제목 인식 확인 필요')}</strong><div class="hd-missing-meta">${escape(row.requester||'작성자 확인 필요')} · ${escape(row.date||byId('hd-missing-date').value)} ${escape(row.time)}</div></div><div class="hd-missing-position hd-missing-meta">${escape(row.matches?.join(', ')|| (row.positionKnown?'삽입 위치 추천 있음':'위치 직접 확인'))}</div><button type="button" data-row="${escape(row.key)}" ${state.busy||state.needsCompare||['registered','reply','otherDate'].includes(row.kind)?'disabled':''}>확인</button></div>`).join(''):`<div class="hd-missing-empty">${state.rows.length?'이 분류에 해당하는 항목이 없습니다.':'목록 캡처를 첨부하면 누락 후보를 표시합니다.'}</div>`;
    byId('hd-missing-list').querySelectorAll('[data-row]').forEach(button=>button.onclick=()=>selectRow(button.dataset.row));
  }
  function render() {
    const keys=['missing','review','registered','reply','otherDate','all'];
    byId('hd-missing-tabs').innerHTML=keys.map(key=>`<button type="button" aria-pressed="${state.filter===key}" data-filter="${key}">${labels[key]||'전체'} ${state.rows.filter(row=>key==='all'||row.kind===key).length}</button>`).join('');
    byId('hd-missing-tabs').querySelectorAll('[data-filter]').forEach(button=>button.onclick=()=>{state.filter=button.dataset.filter;render();});
    byId('hd-missing-editor').hidden=state.selected===null;
    renderList();
  }
  async function optimize(file) {
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>12*1024*1024)throw Error('PNG·JPEG·WebP 이미지(장당 최대 12MB)만 사용할 수 있습니다.');
    const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('이미지를 읽지 못했습니다.'));reader.readAsDataURL(file);});
    const img=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('손상된 이미지입니다.'));image.src=data;});
    const edge=Math.max(img.naturalWidth,img.naturalHeight),scale=Math.min(1,2600/edge);
    if(scale===1&&file.size<1500000)return {data,mimeType:file.type};
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
    return {data:canvas.toDataURL('image/jpeg',.92),mimeType:'image/jpeg'};
  }
  async function readFiles(files) {
    if(state.busy)return;
    const items=Array.from(files||[]);if(!items.length)return;
    if(items.length>3){status('목록 캡처는 최대 3장까지 첨부할 수 있습니다.',true);return;}
    const generation=++state.generation;setBusy(true);status('목록 이미지를 준비 중입니다...');
    try{const images=await Promise.all(items.map(optimize));if(generation!==state.generation)return;state.images=images;state.rows=[];state.selected=null;state.fingerprint='';state.needsCompare=true;
      byId('hd-missing-thumbs').replaceChildren(...images.map((image,index)=>{const img=document.createElement('img');img.src=image.data;img.alt='목록 캡처 '+(index+1);return img;}));render();setBusy(false);await analyze();
    }catch(error){if(generation===state.generation)status(apiError(error),true);}finally{if(generation===state.generation)setBusy(false);}
  }
  async function analyze() {
    if(state.busy)return;
    if(!state.images.length||!byId('hd-missing-date').value){status('비교할 날짜와 목록 이미지를 확인해 주세요.',true);return;}
    const generation=++state.generation;setBusy(true);status('목록에서 원문·답글을 구분하고 해당 날짜의 등록 건과 대조 중입니다...');
    try{const result=await callGASApi('analyzeListCapture',{receiptDate:byId('hd-missing-date').value,images:state.images});if(generation!==state.generation)return;acceptComparison(result);}
    catch(error){if(generation===state.generation)status(apiError(error),true);}finally{if(generation===state.generation)setBusy(false);}
  }
  function acceptComparison(result) {
    if(!result||!Array.isArray(result.rows)||!Array.isArray(result.existing)||!result.fingerprint)throw Error('목록 비교 결과가 올바르지 않습니다. 다시 분석해 주세요.');
    state.rows=result.rows;state.existing=result.existing;state.fingerprint=result.fingerprint;state.selected=null;state.needsCompare=false;state.filter='missing';
    render();status(`원문·답글 ${result.rows.length}행 비교 완료 · 누락 의심 ${result.rows.filter(row=>row.kind==='missing').length}건. 캡처에 보이는 범위만 확인한 결과입니다.`);
  }
  async function compare() {
    if(state.busy)return;
    if(!state.rows.length){status('먼저 목록 캡처를 분석해 주세요.',true);return;}
    const generation=++state.generation;setBusy(true);status('이미지 재분석 없이 최신 등록 목록으로 다시 비교 중입니다...');
    try{const result=await callGASApi('compareListCapture',{receiptDate:byId('hd-missing-date').value,rows:state.rows});if(generation===state.generation)acceptComparison(result);}
    catch(error){if(generation===state.generation)status(apiError(error),true);}finally{if(generation===state.generation)setBusy(false);}
  }
  async function recover() {
    if(state.busy)return;
    const generation=++state.generation;setBusy(true);status('행을 다시 등록하지 않고 이전 작업의 저장 표식을 확인 중입니다...');
    try{const answer=await callGASApi('checkIssueInsertion');if(generation!==state.generation)return;
      if(answer.recovered){state.needsCompare=true;state.selected=null;state.fingerprint='';render();markDashboardServerChange();loadData(true);status('저장 확인 완료: '+answer.result.id+'. 최신 목록으로 다시 비교해 주세요.');}
      else status(answer.message||'확인 대기 중인 중간 등록이 없습니다.');
    }catch(error){if(generation===state.generation)status(apiError(error),true);}finally{if(generation===state.generation)setBusy(false);}
  }
  function selectRow(key) {
    if(state.busy||state.needsCompare)return;
    const row=state.rows.find(item=>item.key===key);if(!row||['registered','reply','otherDate'].includes(row.kind))return;
    state.selected=key;render();byId('hd-missing-title').value=row.title;byId('hd-missing-requester').value=row.requester;byId('hd-missing-confirm').checked=false;byId('hd-missing-prepare').disabled=true;byId('hd-missing-block').hidden=true;
    byId('hd-missing-after').innerHTML='<option value="?">삽입 위치를 직접 선택해 주세요</option><option value="">해당 날짜의 첫 번째 번호 앞</option>'+state.existing.map(item=>`<option value="${escape(item.id)}">${escape(item.id)} · ${escape(item.title)} 다음</option>`).join('');
    byId('hd-missing-after').value=row.positionKnown?row.suggestedAfterId:'?';
    byId('hd-missing-position-hint').textContent=row.positionKnown?'캡처의 앞뒤 등록 원문을 기준으로 추천한 위치입니다. 실제 순서를 확인해 주세요.':'캡처에서 앞뒤 등록 원문이 모두 확인되지 않습니다. 시간만으로 순서를 확정하지 말고 위치를 직접 선택해 주세요.';
    byId('hd-missing-editor').scrollIntoView({block:'nearest'});byId('hd-missing-title').focus();
  }
  async function prepare() {
    if(state.busy||state.needsCompare)return;
    if(!byId('hd-missing-confirm').checked||byId('hd-missing-after').value==='?'||!byId('hd-missing-title').value.trim()||!byId('hd-missing-requester').value.trim()){
      status('원문 제목·작성자·삽입 위치를 확인하고 확인란에 체크해 주세요.',true);return;
    }
    const candidate={receiptDate:byId('hd-missing-date').value,title:byId('hd-missing-title').value.trim(),requester:byId('hd-missing-requester').value.trim(),afterId:byId('hd-missing-after').value,fingerprint:state.fingerprint,originalConfirmed:true};
    const generation=++state.generation;setBusy(true);status('변경될 기존 번호와 새 번호의 Jira 연결·참조를 확인 중입니다...');byId('hd-missing-block').hidden=true;
    try{const preview=await callGASApi('previewIssueInsertion',candidate);if(generation!==state.generation)return;
      if(!preview||preview.allowed!==true){const message=(preview&&preview.reason||'안전 여부를 확인하지 못해 등록할 수 없습니다.')+(preview?.blockedIds?.length?'\n영향 번호: '+preview.blockedIds.join(', '):'')+(preview?.jiraKeys?.length?'\nJira: '+preview.jiraKeys.join(', '):'');byId('hd-missing-block').hidden=false;byId('hd-missing-block').textContent=message;status('등록 차단: 기존 연결에 영향을 줄 수 있습니다.',true);return;}
      if(!preview.token||!preview.id||!preview.receiptTime)throw Error('중간 등록 미리보기 응답이 올바르지 않습니다.');
      setBusy(false);byId('hd-missing-dialog').close();
      openAddModal();state.insertion={...preview,date:candidate.receiptDate,candidate};
      byId('add-date').value=candidate.receiptDate;byId('add-date').disabled=true;byId('add-title').value=candidate.title;byId('add-requester').value=candidate.requester;
      await loadHelpdeskStaffBranchMap();if(!state.insertion||state.insertion.token!==preview.token)return;
      const branch=getHelpdeskBranchByStaffName(candidate.requester);if(branch&&!byId('add-branch').value)byId('add-branch').value=branch;
      const notice=byId('add-insertion-notice');notice.hidden=false;notice.replaceChildren();
      const description=document.createElement('div');description.textContent=`중간 등록: ${preview.id} · 정렬 시간 ${preview.receiptTime}\n${preview.older||'일자 시작'} → 신규 → ${preview.newer||'일자 마지막'}\n기존 번호 ${preview.changes.length}건이 변경됩니다. 본문과 원문 링크를 확인해 주세요. 저장 직전에 Jira를 다시 확인합니다.`;notice.appendChild(description);
      if(preview.changes.length){const changes=document.createElement('div');changes.className='hd-missing-changes';changes.textContent=preview.changes.map(item=>item.from+' → '+item.to).join('\n');notice.appendChild(changes);}
      const label=document.createElement('label');label.className='hd-missing-confirm';const check=document.createElement('input');check.type='checkbox';check.id='hd-insertion-approve';label.append(check,document.createTextNode('위 삽입 위치와 번호 변경을 확인했으며, 이 내용으로 등록합니다.'));notice.appendChild(label);byId('add-title').focus();
    }catch(error){if(generation===state.generation)status(apiError(error),true);}finally{if(generation===state.generation)setBusy(false);}
  }
  function resetInsertion() {
    state.insertion=null;const date=byId('add-date');if(date)date.disabled=false;const note=byId('add-insertion-notice');if(note){note.hidden=true;note.replaceChildren();}
  }
  function closeRegistration() {
    if(state.writing)return false;
    if(state.insertion){resetInsertion();byId('hd-missing-dialog').showModal();state.focus=byId('hd-missing-title');render();}
    return true;
  }
  function applyResult(form,result) {
    if(!result||!result.id||!Number.isFinite(result.identityRevision))throw Error('저장은 응답했지만 변경 번호를 확인하지 못했습니다. 목록을 다시 조회해 주세요.');
    if(window.fullIssueData){
      const mapping=new Map((result.changes||[]).map(item=>[item.from,item.to]));
      window.fullIssueData.issues=window.fullIssueData.issues.map(item=>({...item,id:mapping.get(item.id)||item.id,identityRevision:result.identityRevision}));
      const item={...buildLocalIssueFromAddData(form,result),identityRevision:result.identityRevision};window.fullIssueData.issues.push(item);
      onSuccess(buildStatsForCurrentRange(),false);
    }
    markDashboardServerChange();loadData(true);
  }
  async function submit(form,button) {
    if(state.writing||!state.insertion)return;
    if(!byId('hd-insertion-approve')?.checked){showToast('삽입 위치와 기존 번호 변경을 확인한 후 체크해 주세요.','error');return;}
    const insertion=state.insertion;
    if(form.receiptDate!==insertion.date){showToast('중간 등록 날짜는 바꿀 수 없습니다. 점검을 다시 진행해 주세요.','error');return;}
    state.writing=true;setButtonSaving(button,true,'확인·등록 중...');showToast('중복·Jira 연결을 다시 확인한 후 중간 등록합니다.','info');
    try{const result=await callGASApi('insertIssue',{token:insertion.token,renumberConfirmed:true,form});
      state.writing=false;resetInsertion();closeAddModal();state.needsCompare=true;state.selected=null;state.fingerprint='';render();
      try{applyResult(form,result);}catch(_){markDashboardServerChange();loadData(true);}
      showToast(`중간 등록 완료: ${result.id}. 번호가 변경된 화면은 새로 조회해 주세요.`);status('등록 완료. 다음 후보를 처리하려면 기존 결과 다시 비교를 눌러 주세요.');
    }catch(error){showToast('중간 등록 실패: '+apiError(error)+'\n자동 재등록하지 않습니다. 결과가 불명확하면 입력 내용을 유지한 채 같은 등록으로 재확인해 주세요.','error');markDashboardServerChange();loadData(true);}
    finally{state.writing=false;setButtonSaving(button,false);}
  }
  function close() {
    if(!byId('hd-missing-dialog')?.open)return;
    state.generation++;state.busy=false;byId('hd-missing-dialog').close();setBusy(false);state.focus?.focus();
  }
  window.openHelpdeskMissingCheck=function(){mount();if(state.writing)return;state.focus=document.activeElement;
    if(!byId('hd-missing-date').value){const start=byId('startDate').value,end=byId('endDate').value;byId('hd-missing-date').value=start&&start===end?start:localDate();}
    byId('hd-missing-dialog').showModal();render();byId('hd-missing-date').focus();
  };
  window.HelpdeskMissingCheck={insertion:()=>state.insertion,saving:()=>state.writing,resetInsertion,closeRegistration,submit,close};
})();
