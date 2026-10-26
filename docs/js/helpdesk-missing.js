/* 목록 이미지는 추천용입니다. 기존 등록 폼과 별개인 서버 승인 토큰으로만 중간 삽입합니다. */
(function () {
  'use strict';
  const state = { images: [], rows: [], existing: [], fingerprint: '', selected: null, filter: 'missing', generation: 0,
    busy: false, writing: false, marking: false, insertion: null, needsCompare: false, focus: null, drafts: {}, draftKey: '', autoPositionSupported: false, postImages: [] };
  const byId = id => document.getElementById(id);
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
  const labels = { missing: '누락 의심', review: '등록 후보 확인', registered: '등록 일치', excluded: '등록 확인 제외', reply: '답글 제외', otherDate: '다른 날짜' };
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
    modal.innerHTML = `<header class="hd-missing-head"><div><h2 id="hd-missing-heading"><i class="fas fa-list-check" aria-hidden="true"></i> 목록 캡처 누락 점검</h2><p>처리 상태와 무관하게 등록 여부를 비교합니다. 제목·접수일이 다른 기존 건은 확인 후보로 표시하며, Jira에 영향이 없는 경우에만 중간 등록합니다.</p></div><button type="button" data-close aria-label="누락 점검 닫기">✕</button></header>
      <div class="hd-missing-body"><div class="hd-missing-controls"><label>등록 준비 기준일<input type="date" id="hd-missing-date" readonly></label><button type="button" data-files><i class="fas fa-image" aria-hidden="true"></i> 목록 이미지 첨부</button><button type="button" id="hd-missing-analyze" class="hd-missing-primary" disabled>분석·대조</button><button type="button" id="hd-missing-clear" disabled>캡처 초기화</button><button type="button" id="hd-missing-compare" disabled>기존 결과 다시 비교</button></div>
      <input type="file" id="hd-missing-files" accept="image/png,image/jpeg,image/webp" multiple hidden>
      <p class="hd-missing-meta"><button type="button" id="hd-missing-recover">등록 결과 재확인</button> 응답이 끊겼거나 다시 접속한 경우, 저장 표식만 확인합니다. 행을 다시 등록하지 않습니다.</p>
      <div class="hd-missing-drop" id="hd-missing-drop" tabindex="0">목록 캡처를 여기에 끌어놓거나 Ctrl+V로 붙여넣으세요. 최대 3장 · Gemini 분석에 사용되며 이미지 파일은 서버에 보관하지 않습니다.<div id="hd-missing-thumbs" class="hd-missing-thumbs"></div></div>
      <div id="hd-missing-status" class="hd-missing-status" role="status" aria-live="polite"></div><div class="hd-missing-note">처리 상태와 무관하게 등록 여부를 비교합니다. 시간만 보이면 오늘 날짜(한국시간), 날짜·시간이 보이면 원문 작성일시를 사용합니다. 후보를 펼쳐 필요한 내용을 입력하면 작성시각 기준으로 삽입 위치를 확인합니다. 저장 정렬 시간은 앞뒤 사이값으로 유지하고 원문 작성시각은 별도로 보존합니다.</div>
      <div class="hd-missing-tabs" id="hd-missing-tabs" aria-label="비교 결과 분류"></div><div id="hd-missing-list" class="hd-missing-list"></div>
      <p class="hd-missing-meta">이미 등록된 원문은 ‘등록 확인’으로 누락 점검에서 제외할 수 있습니다. 팀 공통으로 유지되며 ‘등록 확인 제외’ 탭에서 해제할 수 있습니다. 실제 이슈 처리 상태는 바뀌지 않습니다.</p>
      <section id="hd-missing-editor" class="hd-missing-editor" hidden><h3>누락 이슈 등록</h3>
      <div class="hd-missing-post-capture"><strong>게시글 이미지 첨부 · 최대 3장</strong><div id="hd-missing-post-drop" class="hd-missing-drop" tabindex="0">게시글 본문 캡처를 여기에 붙여넣거나 끌어놓으세요. 목록 이미지와는 별도이며, 기존 입력 내용을 보존합니다.<div id="hd-missing-post-thumbs" class="hd-missing-thumbs"></div></div><input id="hd-missing-post-files" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden><div class="hd-missing-editor-actions"><button type="button" data-post-files>이미지 선택</button><button type="button" id="hd-missing-post-analyze">AI 분석 후 자동 입력</button><button type="button" id="hd-missing-post-clear">캡처 초기화</button></div><p id="hd-missing-post-status" class="hd-missing-meta" role="status">본문·원문 링크는 첨부한 게시글 캡처에서 확인한 값만 사용합니다. 이미지는 서버에 보관하지 않습니다.</p></div>
      <div class="hd-missing-fields hd-missing-form-grid">
      <label>원문 작성일 *<input type="date" id="hd-missing-source-date" required></label><label>원문 작성시각 *<input type="time" id="hd-missing-source-time" step="1" required></label><label>지사 *<select id="hd-missing-branch" required></select></label>
      <label>요청자 *<input id="hd-missing-requester" maxlength="80" required></label><label>담당 개발자<select id="hd-missing-dev"></select></label><label>시스템 구분<select id="hd-missing-system"></select></label>
      <label>유형<select id="hd-missing-type"></select></label><label>긴급도<select id="hd-missing-priority"></select></label><label>메뉴/기능<input id="hd-missing-menu" maxlength="200"></label>
      <label class="wide">제목 *<input id="hd-missing-title" maxlength="500" required></label><label class="wide">상세 내용 *<textarea id="hd-missing-details" rows="6" maxlength="12000" required placeholder="목록에는 본문이 없습니다. 원문을 확인하고 요청 내용을 입력해 주세요."></textarea></label>
      <label class="wide">원문/첨부 링크<input type="url" id="hd-missing-source-link" maxlength="2000" placeholder="하이웍스 게시글 또는 첨부파일 URL"></label><label class="wide">Jira 링크<input type="url" id="hd-missing-jira-link" maxlength="2000" placeholder="Jira 이슈 URL"></label></div>
      <p id="hd-missing-position-hint" class="hd-missing-meta"></p><label class="hd-missing-confirm"><input type="checkbox" id="hd-missing-confirm">원문 작성일시·요청자·제목·상세 내용을 직접 확인했습니다.</label><div class="hd-missing-editor-actions"><span class="hd-missing-meta">작성시각으로 삽입 위치를 계산하고, 변경될 번호를 Jira에서 확인합니다.</span><button type="button" id="hd-missing-prepare" class="hd-missing-primary">시간 기준 위치·Jira 확인</button></div><div id="hd-missing-block" class="hd-missing-note hd-missing-error" role="alert" hidden></div>
      <section id="hd-missing-preview" class="hd-missing-preview" hidden><div id="hd-missing-preview-text" class="hd-missing-note"></div><label class="hd-missing-confirm"><input type="checkbox" id="hd-insertion-approve">위 삽입 위치·원문 시각 보존·기존 번호 변경을 확인했으며 이 내용으로 등록합니다.</label><button type="button" id="hd-missing-submit" class="hd-missing-primary" disabled>이슈 중간 등록</button></section></section></div>
      <footer class="hd-missing-foot"><span>선택·분석만으로는 등록하거나 번호를 변경하지 않습니다.</span><button type="button" data-close>닫기</button></footer>`;
    document.body.appendChild(modal);
    const dock=document.createElement('div');dock.id='hd-missing-editor-dock';byId('hd-missing-editor').before(dock);dock.append(byId('hd-missing-editor'));
    modal.querySelectorAll('[data-close]').forEach(button=>button.onclick=close);
    modal.querySelector('[data-files]').onclick=()=>byId('hd-missing-files').click();
    modal.addEventListener('cancel',event=>{event.preventDefault();close();});
    modal.addEventListener('click',event=>{if(event.target===modal){const r=modal.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close();}});
    byId('hd-missing-files').onchange=event=>{const files=Array.from(event.target.files);event.target.value='';readFiles(files);};
    byId('hd-missing-analyze').onclick=analyze;
    byId('hd-missing-clear').onclick=()=>removeListImages();
    byId('hd-missing-compare').onclick=compare;
    byId('hd-missing-recover').onclick=recover;
    byId('hd-missing-prepare').onclick=prepare;
    modal.querySelector('[data-post-files]').onclick=()=>byId('hd-missing-post-files').click();
    byId('hd-missing-post-files').onchange=event=>readPostFiles(event.target.files);
    byId('hd-missing-post-analyze').onclick=analyzePostCapture;
    byId('hd-missing-post-clear').onclick=()=>{state.postImages=[];renderPostImages();rememberDraft();invalidateInline();byId('hd-missing-post-status').textContent='게시글 캡처를 초기화했습니다.';};
    byId('hd-missing-submit').onclick=()=>submit(inlineForm(),byId('hd-missing-submit'));
    byId('hd-insertion-approve').onchange=()=>{byId('hd-missing-submit').disabled=state.busy||state.writing||!state.insertion||!byId('hd-insertion-approve').checked;};
    byId('hd-missing-editor').querySelectorAll('input:not([type=checkbox]),select,textarea').forEach(field=>field.addEventListener('input',()=>{rememberDraft();resetInsertion();byId('hd-missing-confirm').checked=false;byId('hd-missing-prepare').disabled=true;}));
    byId('hd-missing-confirm').onchange=()=>{byId('hd-missing-prepare').disabled=state.busy||!byId('hd-missing-confirm').checked;};
    const drop=byId('hd-missing-drop');
    drop.addEventListener('dragover',event=>event.preventDefault());
    drop.addEventListener('drop',event=>{event.preventDefault();readFiles(event.dataTransfer.files);});
    const postDrop=byId('hd-missing-post-drop');postDrop.addEventListener('dragover',event=>event.preventDefault());postDrop.addEventListener('drop',event=>{event.preventDefault();readPostFiles(event.dataTransfer.files);});
    document.addEventListener('paste',event=>{if(!modal.open||state.busy)return;const files=Array.from(event.clipboardData?.items||[]).filter(item=>item.type.startsWith('image/')).map(item=>item.getAsFile()).filter(Boolean);if(files.length){event.preventDefault();if(event.target.closest?.('#hd-missing-editor'))readPostFiles(files);else readFiles(files);}});
  }
  function setBusy(value) {
    state.busy=value;
    ['hd-missing-recover','hd-missing-date','hd-missing-files'].forEach(id=>byId(id).disabled=value);
    byId('hd-missing-analyze').disabled=value||!state.images.length;
    byId('hd-missing-clear').disabled=value||!state.images.length;
    byId('hd-missing-compare').disabled=value||!state.rows.length;
    byId('hd-missing-thumbs').querySelectorAll('button').forEach(button=>button.disabled=value);
    byId('hd-missing-prepare').disabled=value||!byId('hd-missing-confirm').checked;
    byId('hd-missing-dialog').querySelector('[data-files]').disabled=value;
    byId('hd-missing-dialog').querySelectorAll('[data-close]').forEach(button=>button.disabled=state.writing||state.marking);
    byId('hd-missing-editor').querySelectorAll('input,select,textarea').forEach(field=>field.disabled=value);
    byId('hd-missing-editor').querySelectorAll('[data-post-files],#hd-missing-post-analyze,#hd-missing-post-clear').forEach(button=>button.disabled=value);
    byId('hd-missing-submit').disabled=value||state.writing||!state.insertion||!byId('hd-insertion-approve').checked;
    renderList();
  }
  function renderList() {
    const editor=byId('hd-missing-editor'),list=byId('hd-missing-list');if(list.contains(editor))byId('hd-missing-editor-dock').append(editor);
    const shown=state.rows.filter(row=>state.filter==='all'||row.kind===state.filter);
    list.innerHTML=shown.length?shown.map(row=>`<div class="hd-missing-row ${state.selected===row.key?'is-selected':''}"><span><span class="hd-missing-badge ${escape(row.kind)}">${labels[row.kind]||'확인 필요'}</span></span><div><strong>${escape(row.title||'제목 인식 확인 필요')}</strong><div class="hd-missing-meta"></div>${['review','excluded'].includes(row.kind)?`<div class="hd-missing-meta">${escape(row.reason)}</div>`:''}${row.kind==='review'&&row.related?.length?`<div class="hd-missing-related">${row.related.map(item=>`<div>등록 후보: ${escape(item.id)} · ${escape(item.date?.slice(0,10))} · ${escape(item.title)}</div>`).join('')}${row.relatedCount>row.related.length?`<div>외 ${row.relatedCount-row.related.length}건</div>`:''}</div>`:''}</div><div class="hd-missing-position hd-missing-meta">${escape(row.matches?.join(', ')||'작성시각 기준 자동 계산')}</div><div class="hd-missing-row-actions"><button type="button" data-row="${escape(row.key)}" ${state.busy||state.needsCompare||['registered','excluded','reply','otherDate'].includes(row.kind)?'disabled':''}>${row.kind==='registered'?'등록 일치':row.kind==='excluded'?'등록 확인됨':state.selected===row.key?'접기':'입력 펼치기'}</button>${['missing','review'].includes(row.kind)?`<button type="button" data-confirm-row="${escape(row.key)}" title="이미 등록된 원문으로 확인하고 누락 점검에서만 제외합니다" ${state.busy||state.needsCompare||!row.date?'disabled':''}>등록 확인</button>`:row.kind==='excluded'?`<button type="button" data-restore-row="${escape(row.key)}" ${state.busy?'disabled':''}>제외 해제</button>`:''}</div></div>`).join(''):`<div class="hd-missing-empty">${state.rows.length?'이 분류에 해당하는 항목이 없습니다.':'목록 캡처를 첨부하면 누락 후보를 표시합니다.'}</div>`;
    byId('hd-missing-list').querySelectorAll('[data-row]').forEach(button=>button.onclick=()=>selectRow(button.dataset.row));
    list.querySelectorAll('[data-confirm-row]').forEach(button=>button.onclick=()=>setConfirmed(button.dataset.confirmRow,true));
    list.querySelectorAll('[data-restore-row]').forEach(button=>button.onclick=()=>setConfirmed(button.dataset.restoreRow,false));
    byId('hd-missing-list').querySelectorAll('[data-row]').forEach(button=>{
      const row=state.rows.find(item=>item.key===button.dataset.row),meta=button.closest('.hd-missing-row').querySelector('strong + .hd-missing-meta');
      meta.textContent=`${row.requester||'요청자 확인 필요'} · ${row.date||'날짜 확인 필요'} ${row.time||'시각 미표시'}`;
      const confirmButton=button.closest('.hd-missing-row').querySelector('[data-confirm-row]');
      if(confirmButton&&(!row.date||!row.time)){confirmButton.disabled=true;confirmButton.title='원문 작성일시를 확인한 뒤 등록 확인할 수 있습니다.';}
      if(['missing','review'].includes(row.kind))button.closest('.hd-missing-row').querySelector('.hd-missing-position').textContent='작성시각 기준 자동 계산';
      const note=document.createElement('div');note.className='hd-missing-meta';note.textContent=(row.dateSource==='today'?'시간만 표시 → 오늘(한국시간)':row.dateSource==='year-assumed'?'원문 월일 + 올해 연도':row.dateSource==='visible'?'원문 날짜':'작성일시 확인 필요')+(row.dateWarning?' · '+row.dateWarning:'');meta.after(note);
    });
    const selected=Array.from(list.querySelectorAll('[data-row]')).find(button=>button.dataset.row===state.selected);
    editor.hidden=!selected;if(selected)selected.closest('.hd-missing-row').after(editor);
  }
  function render() {
    const keys=['missing','review','registered','excluded','reply','all'];
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
  function renderListImages() {
    byId('hd-missing-thumbs').replaceChildren(...state.images.map((item,index)=>{
      const box=document.createElement('div'),img=document.createElement('img'),remove=document.createElement('button');
      box.className='hd-missing-thumb';img.src=item.data;img.alt='목록 캡처 '+(index+1);
      remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','목록 캡처 '+(index+1)+' 삭제');remove.title='목록 이미지 삭제';remove.disabled=state.busy;
      remove.onclick=()=>removeListImages(index);box.append(img,remove);return box;
    }));
  }
  function resetListResults() {
    rememberDraft();invalidateInline();state.rows=[];state.existing=[];state.fingerprint='';state.selected=null;state.filter='missing';state.needsCompare=true;state.autoPositionSupported=false;state.draftKey='';state.postImages=[];
    byId('hd-missing-files').value='';byId('hd-missing-post-files').value='';byId('hd-missing-block').hidden=true;renderPostImages();render();
  }
  function removeListImages(index) {
    if(state.busy)return;
    if(index!==undefined&&(!Number.isInteger(index)||index<0||index>=state.images.length))return;
    state.generation++;state.images=index===undefined?[]:state.images.filter((_,i)=>i!==index);
    resetListResults();renderListImages();setBusy(false);
    status(state.images.length?'목록 이미지를 삭제하고 이전 비교 결과를 초기화했습니다. 남은 '+state.images.length+'장으로 분석·대조를 다시 눌러 주세요.':'목록 캡처와 비교 결과를 초기화했습니다. 새 이미지를 첨부하거나 붙여넣어 주세요.');
    const buttons=byId('hd-missing-thumbs').querySelectorAll('button');
    (buttons[Math.min(index||0,buttons.length-1)]||byId('hd-missing-dialog').querySelector('[data-files]')).focus({preventScroll:true});
  }
  async function readFiles(files) {
    if(state.busy)return;
    const items=Array.from(files||[]);if(!items.length)return;
    if(items.length>3){status('목록 캡처는 최대 3장까지 첨부할 수 있습니다.',true);return;}
    const generation=++state.generation;setBusy(true);status('목록 이미지를 준비 중입니다...');
    try{const images=await Promise.all(items.map(optimize));if(generation!==state.generation)return;state.images=images;resetListResults();renderListImages();setBusy(false);await analyze();
    }catch(error){if(generation===state.generation)status(apiError(error),true);}finally{if(generation===state.generation)setBusy(false);}
  }
  async function analyze() {
    if(state.busy)return;
    if(!state.images.length||!byId('hd-missing-date').value){status('비교할 날짜와 목록 이미지를 확인해 주세요.',true);return;}
    rememberDraft();resetInsertion();const generation=++state.generation;setBusy(true);status('목록의 원문 작성일시·답글을 확인하고 처리 상태와 무관하게 등록 건과 대조 중입니다...');
    try{const result=await callGASApi('analyzeListCapture',{receiptDate:byId('hd-missing-date').value,images:state.images});if(generation!==state.generation)return;acceptComparison(result);}
    catch(error){if(generation===state.generation)status(apiError(error),true);}finally{if(generation===state.generation)setBusy(false);}
  }
  function acceptComparison(result) {
    if(!result||!Array.isArray(result.rows)||!Array.isArray(result.existing)||!result.fingerprint)throw Error('목록 비교 결과가 올바르지 않습니다. 다시 분석해 주세요.');
    if(result.comparisonProtocol!==3||result.autoPositionSupported!==true||result.confirmationSupported!==true){
      rememberDraft();resetInsertion();state.rows=[];state.existing=[];state.fingerprint='';state.selected=null;state.autoPositionSupported=false;state.needsCompare=true;render();
      throw Error('현재 연결된 업무 API에는 최신 등록 비교·날짜·팀 공통 제외 기능이 아직 배포되지 않았습니다. 잘못된 누락 결과를 표시하지 않습니다. 화면과 업무 API를 함께 재배포한 뒤 다시 분석해 주세요.');
    }
    state.rows=result.rows;state.existing=result.existing;state.fingerprint=result.fingerprint;state.selected=null;state.needsCompare=false;state.autoPositionSupported=result.autoPositionSupported===true;
    const missing=result.rows.filter(row=>row.kind==='missing').length,review=result.rows.filter(row=>row.kind==='review').length;
    const registered=result.rows.filter(row=>row.kind==='registered').length,excluded=result.rows.filter(row=>row.kind==='excluded').length;
    state.filter=missing?'missing':review?'review':registered?'registered':excluded?'excluded':'all';
    render();status(`원문·답글 ${result.rows.length}행 비교 완료 · 누락 의심 ${missing}건 · 확인 필요 ${review}건 · 등록 일치 ${registered}건 · 등록 확인 제외 ${excluded}건. 등록 후보·일치·수동 확인 항목은 누락 의심과 분리합니다.`+(result.timeOrderWarning?'\n'+result.timeOrderWarning:''));
  }
  async function compare() {
    if(state.busy)return;
    if(!state.rows.length){status('먼저 목록 캡처를 분석해 주세요.',true);return;}
    rememberDraft();resetInsertion();const generation=++state.generation;setBusy(true);status('이미지 재분석 없이 원문 작성일시를 유지하며 최신 등록 목록으로 비교 중입니다...');
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
  const formFields={branch:'branch',requester:'requester',dev:'dev',system:'system',type:'type',priority:'priority',menu:'menu',sourceLink:'source-link',jiraLink:'jira-link',title:'title',details:'details'};
  function invalidateInline() {resetInsertion();byId('hd-missing-confirm').checked=false;byId('hd-missing-prepare').disabled=true;}
  function renderPostImages() {
    byId('hd-missing-post-thumbs').replaceChildren(...state.postImages.map((item,index)=>{
      const box=document.createElement('div'),img=document.createElement('img'),remove=document.createElement('button');box.className='hd-missing-post-thumb';img.src=item.data;img.alt='게시글 캡처 '+(index+1);remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','게시글 캡처 '+(index+1)+' 삭제');remove.onclick=()=>{if(state.busy)return;state.postImages.splice(index,1);renderPostImages();rememberDraft();invalidateInline();};box.append(img,remove);return box;
    }));
  }
  async function readPostFiles(files) {
    if(state.busy||state.selected===null)return;const items=Array.from(files||[]);if(!items.length)return;
    if(items.length+state.postImages.length>3){byId('hd-missing-post-status').textContent='게시글 캡처는 최대 3장입니다. 기존 이미지를 삭제한 뒤 추가해 주세요.';return;}
    const generation=++state.generation;setBusy(true);byId('hd-missing-post-status').textContent='게시글 이미지를 준비 중입니다...';
    try{const images=await Promise.all(items.map(optimize));if(generation!==state.generation)return;state.postImages.push(...images);renderPostImages();rememberDraft();invalidateInline();byId('hd-missing-post-status').textContent=`${state.postImages.length}장 첨부 완료 · AI 분석 후 자동 입력을 눌러 본문을 채울 수 있습니다.`;}
    catch(error){if(generation===state.generation)byId('hd-missing-post-status').textContent=apiError(error);}finally{if(generation===state.generation)setBusy(false);}
  }
  async function analyzePostCapture() {
    if(state.busy||state.selected===null)return;if(!state.postImages.length){byId('hd-missing-post-status').textContent='먼저 게시글 본문 이미지를 첨부해 주세요.';return;}
    const generation=++state.generation,selected=state.selected,before=inlineForm(),row=state.rows.find(item=>item.key===selected);setBusy(true);byId('hd-missing-post-status').textContent='게시글 캡처를 분석 중입니다. 입력해 둔 상세 내용·링크는 덮어쓰지 않습니다...';
    try{
      const answer=await runServerFunction('analyzeHelpdeskCapture',{images:state.postImages});if(generation!==state.generation)return;const data=answer?.data||answer||{};
      Object.entries(formFields).forEach(([name,suffix])=>{const field=byId('hd-missing-'+suffix),value=data[name];if(!value)return;
        const defaultCapture=(name==='title'&&before.title===row.title)||(name==='requester'&&before.requester===row.requester);
        if(!field.value||defaultCapture){if(field.tagName==='SELECT'&&!Array.from(field.options).some(option=>option.value===String(value)))return;field.value=String(value);}
      });
      if(data.receiptDate&&/^\d{4}-\d{2}-\d{2}$/.test(data.receiptDate)&&(!before.receiptDate||(before.receiptDate===row.date&&['today','unknown'].includes(row.dateSource))))byId('hd-missing-source-date').value=data.receiptDate;
      await loadHelpdeskStaffBranchMap();if(generation!==state.generation)return;if(!byId('hd-missing-branch').value){const branch=getHelpdeskBranchByStaffName(byId('hd-missing-requester').value);if(branch)byId('hd-missing-branch').value=branch;}
      rememberDraft();invalidateInline();const form=inlineForm(),clock=byId('hd-missing-source-time').value;
      state.rows=state.rows.map(item=>item.key===selected?{...item,title:form.title,requester:form.requester,sourceLink:form.sourceLink,
        rawDate:form.receiptDate&&form.receiptDate!==item.date?form.receiptDate:item.rawDate,rawTime:clock&&clock!==item.time?clock:item.rawTime}:item);
      const result=await callGASApi('compareListCapture',{receiptDate:byId('hd-missing-date').value,rows:state.rows});if(generation!==state.generation)return;
      acceptComparison(result);const current=state.rows.find(item=>item.key===selected);
      if(current){const oldDraft=state.drafts[state.draftKey];state.draftKey=JSON.stringify([current.title,current.requester,current.date,current.time]);if(oldDraft)state.drafts[state.draftKey]=oldDraft;}
      if(current&&!['registered','excluded','reply'].includes(current.kind)){state.selected=selected;render();}
      byId('hd-missing-post-status').textContent='자동 입력 완료 · 이미 입력한 상세 내용·링크는 유지했습니다. 요청자·지사·작성일시를 확인해 주세요.'+(Array.isArray(data.warnings)&&data.warnings.length?' '+data.warnings.slice(0,3).join(' / ').slice(0,600):'');
      if(current&&['registered','excluded'].includes(current.kind))status('게시글의 원문 링크·제목으로 기존 등록이 확인돼 누락 의심에서 분리했습니다. 등록 일치/제외 탭에서 확인할 수 있습니다.');
    }catch(error){if(generation===state.generation)byId('hd-missing-post-status').textContent='게시글 분석 또는 등록 재확인 실패: '+apiError(error);}finally{if(generation===state.generation)setBusy(false);}
  }
  async function setConfirmed(key,confirmed) {
    if(state.busy)return;const row=state.rows.find(item=>item.key===key);if(!row)return;rememberDraft();resetInsertion();const generation=++state.generation;state.marking=true;setBusy(true);status(confirmed?'실제 이슈 상태를 바꾸지 않고 팀 공통 등록 확인을 저장 중입니다...':'팀 공통 등록 확인 제외를 해제하고 재비교 중입니다...');
    try{const result=await callGASApi('setCaptureConfirmed',{receiptDate:byId('hd-missing-date').value,row,rows:state.rows,confirmed});if(generation!==state.generation)return;acceptComparison(result);status(confirmed?'등록 확인 완료 · 누락 의심에서 제외했습니다. 팀 공통으로 유지되며 등록 확인 제외 탭에서 해제할 수 있습니다. 실제 처리 상태는 바뀌지 않았습니다.':'제외를 해제했습니다. 최신 등록 정보로 다시 분류했습니다.');}
    catch(error){if(generation===state.generation)status('등록 확인 저장 여부를 확인하지 못했습니다. 기존 결과 다시 비교로 확인해 주세요. '+apiError(error),true);}finally{state.marking=false;if(generation===state.generation)setBusy(false);}
  }
  function inlineForm() {
    const form={receiptDate:byId('hd-missing-source-date').value};
    Object.entries(formFields).forEach(([key,suffix])=>form[key]=byId('hd-missing-'+suffix).value.trim());return form;
  }
  function rememberDraft() {
    if(state.selected!==null&&state.draftKey&&byId('hd-missing-source-date'))state.drafts[state.draftKey]={...inlineForm(),sourceTime:byId('hd-missing-source-time').value,images:state.postImages.slice()};
  }
  function populateInlineOptions() {
    if(typeof populateDevSelects==='function')populateDevSelects();
    ['branch','dev','system','type','priority'].forEach(suffix=>byId('hd-missing-'+suffix).replaceChildren(...Array.from(byId('add-'+suffix).options).map(option=>option.cloneNode(true))));
  }
  async function selectRow(key) {
    if(state.busy||state.needsCompare)return;
    const row=state.rows.find(item=>item.key===key);if(!row||['registered','excluded','reply','otherDate'].includes(row.kind))return;
    if(state.selected===key){rememberDraft();resetInsertion();state.selected=null;render();return;}
    rememberDraft();resetInsertion();state.selected=key;state.draftKey=JSON.stringify([row.title,row.requester,row.date,row.time]);populateInlineOptions();
    const form=state.drafts[state.draftKey]||{receiptDate:row.date,sourceTime:row.time,title:row.title,requester:row.requester,priority:'보통'};
    state.postImages=(form.images||[]).slice();renderPostImages();byId('hd-missing-post-status').textContent=state.postImages.length?state.postImages.length+'장 보관 중 · AI 분석 후 자동 입력을 사용할 수 있습니다.':'게시글 본문 캡처를 첨부하면 상세 내용·원문 링크를 분석할 수 있습니다.';
    Object.entries(formFields).forEach(([name,suffix])=>byId('hd-missing-'+suffix).value=form[name]||'');byId('hd-missing-source-date').value=form.receiptDate||'';byId('hd-missing-source-time').value=form.sourceTime||'';
    render();byId('hd-missing-confirm').checked=false;byId('hd-missing-prepare').disabled=true;byId('hd-missing-block').hidden=true;
    byId('hd-missing-position-hint').textContent=(row.kind==='review'?row.reason+' ':'')+'원문 작성시각을 기준으로 앞뒤 등록 원문을 찾아 위치를 계산합니다. 동일 시각·기존 순서 충돌은 자동 등록하지 않습니다.'+(row.dateWarning?' '+row.dateWarning:'');
    byId('hd-missing-post-drop').focus({preventScroll:true});byId('hd-missing-editor').previousElementSibling?.scrollIntoView({block:'start'});
    const draftKey=state.draftKey;try{await loadHelpdeskStaffBranchMap();if(state.draftKey===draftKey&&!byId('hd-missing-branch').value){const branch=getHelpdeskBranchByStaffName(byId('hd-missing-requester').value);if(branch)byId('hd-missing-branch').value=branch;}}catch(_){/* 지사는 직접 선택할 수 있습니다. */}
  }
  async function prepare() {
    if(state.busy||state.needsCompare)return;
    if(!state.autoPositionSupported){byId('hd-missing-block').hidden=false;byId('hd-missing-block').textContent='원문 날짜·시간 기준 자동 삽입은 업무 API 재배포 후 사용할 수 있습니다. 이전 서버로 등록 요청을 보내지 않습니다.';return;}
    const invalid=Array.from(byId('hd-missing-editor').querySelectorAll('input:not([type=checkbox]),select,textarea')).find(field=>!field.checkValidity());if(invalid){invalid.reportValidity();return;}
    if(!byId('hd-missing-confirm').checked){status('원문 작성일시와 필수 내용을 확인하고 확인란에 체크해 주세요.',true);return;
    }
    rememberDraft();resetInsertion();const form=inlineForm(),sourceTime=byId('hd-missing-source-time').value;
    const generation=++state.generation;setBusy(true);status('원문 작성시각으로 위치를 계산하고 Jira 연결·참조를 확인 중입니다...');byId('hd-missing-block').hidden=true;
    try{
      if(byId('hd-missing-date').value!==form.receiptDate){const current=await callGASApi('compareListCapture',{receiptDate:form.receiptDate,rows:state.rows});if(generation!==state.generation)return;state.rows=current.rows;state.existing=current.existing;state.fingerprint=current.fingerprint;byId('hd-missing-date').value=form.receiptDate;}
      const candidate={receiptDate:form.receiptDate,title:form.title,requester:form.requester,sourceLink:form.sourceLink,fingerprint:state.fingerprint,originalConfirmed:true,autoPosition:true,sourceDate:form.receiptDate,sourceTime,captureRows:state.rows,captureRow:state.rows.find(item=>item.key===state.selected)};
      const preview=await callGASApi('previewIssueInsertion',candidate);if(generation!==state.generation)return;
      if(!preview||preview.allowed!==true){const message=(preview&&preview.reason||'안전 여부를 확인하지 못해 등록할 수 없습니다.')+(preview?.blockedIds?.length?'\n영향 번호: '+preview.blockedIds.join(', '):'')+(preview?.jiraKeys?.length?'\nJira: '+preview.jiraKeys.join(', '):'');byId('hd-missing-block').hidden=false;byId('hd-missing-block').textContent=message;status('등록 준비를 중단했습니다. 펼침 영역의 안내를 확인해 주세요.',true);return;}
      if(!preview.token||!preview.id||!preview.receiptTime||!preview.originalPostedAt)throw Error('원문 시각이 포함된 중간 등록 미리보기를 확인하지 못했습니다. 업무 API 배포 상태를 확인해 주세요.');
      state.insertion={...preview,date:candidate.receiptDate,candidate,formSignature:JSON.stringify({form,sourceTime})};
      const basis=preview.positionBasis==='empty-day'?'등록된 이슈가 없는 일자의 첫 번호입니다.':'캡처에서 일치한 앞뒤 등록 원문의 작성시각으로 위치를 계산했습니다.';
      byId('hd-missing-preview-text').textContent=`중간 등록: ${preview.id}\n원문 작성일시: ${preview.originalPostedAt} (별도 보존)\n저장 정렬 시간: ${preview.receiptTime}\n${preview.older||'일자 시작'} → 신규 → ${preview.newer||'일자 마지막'}\n${basis}\n기존 번호 ${preview.changes.length}건 변경\n${preview.changes.map(item=>item.from+' → '+item.to).join('\n')}\n저장 직전에 중복·Jira를 다시 확인합니다.`;
      byId('hd-missing-preview').hidden=false;byId('hd-insertion-approve').checked=false;byId('hd-missing-preview').scrollIntoView({block:'nearest'});status('삽입 위치·원문 작성시각·번호 변경을 확인한 후 최종 등록해 주세요.');
    }catch(error){if(generation===state.generation){byId('hd-missing-block').hidden=false;byId('hd-missing-block').textContent=apiError(error);status(apiError(error),true);}}finally{if(generation===state.generation)setBusy(false);}
  }
  function resetInsertion() {
    state.insertion=null;if(byId('hd-missing-preview')){byId('hd-missing-preview').hidden=true;byId('hd-insertion-approve').checked=false;byId('hd-missing-submit').disabled=true;}
  }
  function closeRegistration() {
    if(state.writing)return false;
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
    if(insertion.formSignature!==JSON.stringify({form,sourceTime:byId('hd-missing-source-time').value})){resetInsertion();showToast('입력 내용이 변경됐습니다. 위치·Jira 확인을 다시 진행해 주세요.','error');return;}
    if(form.receiptDate!==insertion.date){showToast('중간 등록 날짜는 바꿀 수 없습니다. 점검을 다시 진행해 주세요.','error');return;}
    state.writing=true;setBusy(true);setButtonSaving(button,true,'확인·등록 중...');showToast('중복·Jira 연결을 다시 확인한 후 중간 등록합니다.','info');
    try{const result=await callGASApi('insertIssue',{token:insertion.token,renumberConfirmed:true,form});
      state.writing=false;delete state.drafts[state.draftKey];state.draftKey='';resetInsertion();state.needsCompare=true;state.selected=null;state.fingerprint='';render();
      try{applyResult(form,result);}catch(_){markDashboardServerChange();loadData(true);}
      showToast(`중간 등록 완료: ${result.id}. 번호가 변경된 화면은 새로 조회해 주세요.`);status('등록 완료. 다음 후보를 처리하려면 기존 결과 다시 비교를 눌러 주세요.');
    }catch(error){showToast('중간 등록 실패: '+apiError(error)+'\n자동 재등록하지 않습니다. 결과가 불명확하면 입력 내용을 유지한 채 같은 등록으로 재확인해 주세요.','error');markDashboardServerChange();loadData(true);}
    finally{state.writing=false;setButtonSaving(button,false);setBusy(false);}
  }
  function close() {
    if(!byId('hd-missing-dialog')?.open)return;
    if(state.writing||state.marking)return;rememberDraft();resetInsertion();state.generation++;state.busy=false;byId('hd-missing-dialog').close();setBusy(false);state.focus?.focus();
  }
  window.openHelpdeskMissingCheck=function(){mount();if(state.writing)return;state.focus=document.activeElement;
    if(!byId('hd-missing-date').value){const start=byId('startDate').value,end=byId('endDate').value;byId('hd-missing-date').value=start&&start===end?start:localDate();}
    byId('hd-missing-dialog').showModal();render();byId('hd-missing-date').focus();
  };
  window.HelpdeskMissingCheck={insertion:()=>state.insertion,saving:()=>state.writing||state.marking,resetInsertion,closeRegistration,submit,close};
})();
