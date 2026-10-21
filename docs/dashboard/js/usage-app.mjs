import {parseXlsx} from './xlsx-reader.mjs';
import {DEFINITIONS,readDataset,createModel,aggregate,weeklyTrend,counts,attribution,companyKey,accountKey,clean,redactSecrets} from './usage-model.mjs';

const $=id=>document.getElementById(id),nf=new Intl.NumberFormat('ko-KR');
const esc=value=>redactSecrets(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const icon=id=>`<svg aria-hidden="true"><use href="#i-${id}"/></svg>`;
const fmt=value=>value===null||value===undefined?'—':nf.format(value);
const pct=value=>value===null?'—':(value*100).toFixed(1)+'%';
const state={model:null,summary:null,tab:'summary',staff:{},busy:false,remember:false,filters:{customerSearch:'',customerScope:'all',customerSort:'days',customerLimit:'10',operatorBranch:'all',operatorLimit:'10',securityScope:'customerAccess'},dialog:null};
let loadRevision=0;
const sourceLabel=kind=>DEFINITIONS.find(def=>def.id===kind)?.label||kind;
const note=(message,type='')=>{$('statusNote').textContent=message;$('statusNote').className='status-note '+type;};
const available=(kind,value)=>state.summary?.has(kind)?value:null;
function company(name){return name||'고객사 미확인';}
function person(row){return row.user||row.userId||'사용자 미확인';}
function userId(value){return value?redactSecrets(value):'아이디 없음';}
function ip(value){return value?redactSecrets(value):'—';}
function sourceCards(){
  $('sourceCards').innerHTML=DEFINITIONS.map(def=>{const source=state.model?.sources[def.id];return `<div class="source-chip ${source?'ready':''}" title="${esc(source?.fileName||'아직 선택하지 않은 파일입니다.')}" data-source-kind="${def.id}"><div><strong>${def.label}</strong><b>${source?fmt(source.rows.length)+'행':'미제공'}</b></div><small>${source?(source.start?source.start.slice(5)+' ~ '+source.end.slice(5):'기록 0행 · 헤더 확인 완료'):'필요한 파일만 선택 가능'}</small></div>`;}).join('');
}
function limitOptions(value){return ['10','20','all'].map(v=>`<option value="${v}" ${v===value?'selected':''}>${v==='all'?'전체 보기':v+'개 보기'}</option>`).join('');}
function table(headers,body){return `<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th class="${h.numeric?'numeric':''}">${esc(h.label||h)}</th>`).join('')}</tr></thead><tbody>${body||`<tr><td class="empty-cell" colspan="${headers.length}">선택 조건에 해당하는 기록이 없습니다.</td></tr>`}</tbody></table></div>`;}
function logCount(kind,value,options={},label='변경 로그'){
  if(!state.summary.has(kind))return '미제공';
  if(!value)return fmt(value);
  const attributes=Object.entries(options).map(([key,value])=>`data-${key}="${esc(value)}"`).join(' ');
  return `<button class="log-count" data-open="${kind}" ${attributes} aria-label="${label} ${fmt(value)}행 상세 보기" title="선택 기간의 ${label} 상세 보기">${fmt(value)}</button>`;
}
function changeLogTable(rows){
  const value=content=>content?`<span class="change-value">${esc(content)}</span>`:'<span class="value-empty">원본 공란</span>';
  const body=rows.map(row=>`<tr>
    <td><span>${row.timestamp||'일시 미확인'}</span><button class="text-link row-detail-link" data-detail-row="${row.sourceRow}">행 상세 보기 ${icon('arrow')}</button><small>원본 ${row.sourceRow}행${row.duplicate?' · 동일 값 반복':''}</small></td>
    <td><span class="change-value">${row.company?esc(company(row.company)):'관리자 활동'}</span><small class="change-value">${esc(person(row))}<br>${esc(userId(row.userId))}</small></td>
    <td><span class="pill ${row.type==='등록'?'green':row.type==='삭제'?'red':'gray'}">${esc(row.type||'유형 미기록')}</span><span class="change-menu">${esc(row.menu||'메뉴 미기록')}</span></td>
    <td>${value(row.target)}<small class="change-field">변경 항목 · ${esc(row.field||'미기록')}</small></td>
    <td>${value(row.before)}</td><td>${value(row.after)}</td>
  </tr>`).join('');
  return `<div class="change-log-table">${table(['일시 / 상세','고객사 / 기록된 계정','유형 / 메뉴','변경 대상 / 항목','변경 전','변경 후'],body)}</div>`;
}
function panel(title,subtitle,body,extra=''){return `<section class="panel ${extra}"><div class="panel-head"><div><h2>${title}</h2>${subtitle?`<p>${subtitle}</p>`:''}</div></div>${body}</section>`;}
function kpi(label,value,unit,caption,kind,tone='',options={}){
  const enabled=value!==null,attributes=Object.entries(options).map(([key,value])=>`data-${key}="${esc(value)}"`).join(' ');
  return `<div class="kpi ${tone}" ${enabled&&kind?`role="button" tabindex="0" data-open="${kind}" ${attributes} aria-label="${label} 상세 보기"`:''}><span class="kpi-label">${label}</span><strong class="kpi-value">${fmt(value)}<small>${enabled?unit:''}</small></strong><span class="kpi-caption">${enabled?caption:'해당 로그 파일 미제공'}</span>${enabled&&kind?`<span class="kpi-arrow">${icon('arrow')}</span>`:''}</div>`;
}
function bars(items,{action='',field='label',maxRows=6}={}){
  if(!items.length)return '<p class="small-caption">해당 기간에 집계할 기록이 없습니다.</p>';
  const max=Math.max(...items.map(item=>item.count),1);return `<div class="bars">${items.slice(0,maxRows).map(item=>`<div class="bar-item"><span class="bar-name" title="${esc(item.label)}">${action?`<button data-bar-action="${action}" data-field="${field}" data-value="${esc(item.label)}">${esc(item.label)}</button>`:esc(item.label)}</span><span class="bar-track"><i class="bar-fill" style="width:${item.count/max*100}%"></i></span><b>${fmt(item.count)}</b></div>`).join('')}</div>`;
}
function trendChart(){
  const s=state.summary;if(!s.has('customerChanges'))return '<p class="small-caption">고객 데이터변경 로그를 추가하면 주간 추이가 표시됩니다.</p>';
  const bins=weeklyTrend(s),w=800,h=215,left=42,right=37,top=19,bottom=38,pw=w-left-right,ph=h-top-bottom;
  const leftMax=Math.max(4,Math.ceil(Math.max(...bins.map(b=>b.logs),0)/4)*4),rightMax=Math.max(4,Math.ceil(Math.max(...bins.map(b=>b.companies),0)/4)*4);
  const step=pw/Math.max(bins.length,1),x=i=>left+step*(i+.5),y=(v,max)=>top+ph*(1-v/max);
  const ticks=Array.from({length:5},(_,i)=>{const py=top+ph*i/4;return `<line x1="${left}" x2="${w-right}" y1="${py}" y2="${py}" stroke="#e6eee8"/><text x="${left-8}" y="${py+4}" text-anchor="end">${fmt(leftMax*(4-i)/4)}</text><text x="${w-right+8}" y="${py+4}">${fmt(rightMax*(4-i)/4)}</text>`;}).join('');
  const items=bins.map((b,i)=>`<g tabindex="0" role="button" aria-label="${b.start}부터 ${b.end} 변경 ${b.logs}행 상세" data-week-start="${b.start}" data-week-end="${b.end}"><rect class="chart-bar" x="${x(i)-Math.min(36,step*.45)/2}" y="${y(b.logs,leftMax)}" width="${Math.min(36,step*.45)}" height="${ph*b.logs/leftMax}" rx="5"/><text x="${x(i)}" y="${h-13}" text-anchor="middle">${b.start.slice(5).replace('-','.')}~${b.end.slice(5).replace('-','.')}</text></g>`).join('');
  return `<div class="legend"><span><i></i>변경 로그(행, 왼쪽)</span><span><i class="line"></i>작업 고객사(개, 오른쪽)</span></div><div class="chart-wrap"><svg class="trend-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="선택 기간 중 최근 최대 8주 변경 로그와 작업 고객사 추이">${ticks}${items}<polyline points="${bins.map((b,i)=>x(i)+','+y(b.companies,rightMax)).join(' ')}" stroke="#087a4b" stroke-width="2.5" fill="none"/>${bins.map((b,i)=>`<circle class="chart-dot" cx="${x(i)}" cy="${y(b.companies,rightMax)}" r="4"/>`).join('')}</svg></div>`;
}
function heatmap(){
  const matrix=Array.from({length:7},()=>Array(12).fill(0));
  for(const row of state.summary.period.customerChanges){const weekday=(new Date(row.date+'T00:00:00Z').getUTCDay()+6)%7;matrix[weekday][Math.floor(Number(row.timestamp.slice(11,13))/2)]++;}
  const max=Math.max(1,...matrix.flat());
  return `<div class="heatmap"><span></span>${Array.from({length:12},(_,i)=>`<span class="heat-label">${String(i*2).padStart(2,'0')}</span>`).join('')}${matrix.map((values,day)=>`<span>${['월','화','수','목','금','토','일'][day]}</span>${values.map((count,hour)=>`<button class="heat-cell" style="--heat:${count/max}" data-heat-day="${day}" data-heat-hour="${hour*2}" title="${['월','화','수','목','금','토','일'][day]}요일 ${hour*2}~${hour*2+2}시: ${count}행" aria-label="${['월','화','수','목','금','토','일'][day]}요일 ${hour*2}시부터 2시간, 변경 로그 ${count}행"></button>`).join('')}`).join('')}</div><p class="panel-foot">2시간 단위 · 변경 로그 행 수 · 대량 변경은 일괄 작업 여부 확인 필요</p>`;
}
function qualityBody(){
  const sources=Object.values(state.model.sources),duplicates=sources.reduce((n,s)=>n+s.duplicates,0),invalid=sources.reduce((n,s)=>n+s.invalidDates,0);
  return `<ul class="quality-list"><li><span class="pill gray">원본 보존</span><span>동일 값 반복 <b>${fmt(duplicates)}행</b> · 삭제하거나 실제 작업으로 묶지 않았습니다.</span></li><li><span class="pill ${invalid?'amber':'green'}">날짜 검증</span><span>${invalid?`일시를 읽지 못한 ${fmt(invalid)}행은 기간 집계에서 제외됩니다. 원본 상세에서 확인할 수 있습니다.`:'일시 형식 검증 완료. 파일별 기록 시작일은 서로 다를 수 있습니다.'}</span></li><li><span class="pill amber">주체 확인</span><span>고객 계정의 대리 이력 연관성은 참고 정보입니다. 직접·대리 작업을 확정하지 않습니다.</span></li></ul>`;
}
function customerTable(rows,limit='10'){
  const shown=limit==='all'?rows:rows.slice(0,+limit);return table(['고객사',{label:'작업일',numeric:true},{label:'로그인일',numeric:true},{label:'변경 로그',numeric:true},'최근 이용','확인'],shown.map(row=>`<tr><td><button class="cell-button" data-company="${esc(row.key)}">${esc(company(row.company))}</button><small>${state.summary.has('customerChanges')?row.menus.size+'개 작업 메뉴 · ':''}${row.users.size}개 계정</small></td><td class="numeric">${state.summary.has('customerChanges')?fmt(row.activityDays.size)+'일':'미제공'}</td><td class="numeric">${state.summary.has('customerAccess')?fmt(row.loginDays.size)+'일':'미제공'}</td><td class="numeric">${logCount('customerChanges',row.logs,{company:row.key})}</td><td>${row.latest.slice(0,16)}</td><td>${row.relatedAccounts.size?'<span class="pill amber">대리 이력 계정</span>':'<span class="pill gray">주체 미확인</span>'}</td></tr>`).join(''));
}
function renderSummary(){
  const s=state.summary;
  const cards=[kpi('로그인 고객사',available('customerAccess',s.customerAccess.companies),'개사','성공 로그인 기준','customerAccess','green',{'log-type':'로그인',result:'성공'}),kpi('데이터 작업 고객사',available('customerChanges',s.changeCompanies),'개사','고객 계정 기준 · 대리 가능','customerChanges'),kpi('재방문 고객사',available('customerAccess',s.customerAccess.returning),'개사','서로 다른 2일 이상 로그인','customerAccess','',{'customer-scope':'returning'}),kpi('작업 계정',available('customerChanges',s.changeUsers),'개','고객사 + 아이디 기준','customerChanges'),kpi('고객 변경이력',available('customerChanges',s.period.customerChanges.length),'행','등록·수정·삭제 원본 행','customerChanges'),kpi('대리 접속',available('proxy',s.period.proxy.length),'건','관리자의 고객 계정 접속 시작','proxy','blue')];
  const positive=s.has('customerChanges')?`${s.changeCompanies}개사에서 데이터 작업 관측`:'고객 변경 로그를 추가해 주세요';
  const concentration=s.has('customerChanges')&&s.topShare!==null?`상위 1개사 비중 ${pct(s.topShare)}`:'고객사별 이용 패턴 확인';
  return `<div class="kpi-grid">${cards.join('')}</div><section class="panel insight-panel"><div class="panel-head"><div><h2>이번 기간의 이용 인사이트</h2><p>계산된 사실과 확인이 필요한 해석을 구분합니다.</p></div><span class="section-tag">자동 집계 · AI 호출 없음</span></div><div class="insights"><article class="insight positive"><span class="pill green">이용 신호</span><h3>${positive}</h3><p>${s.has('customerChanges')?`그중 ${s.recurringChangeCompanies}개사는 서로 다른 2일 이상 작업했습니다. 로그 양과 함께 반복 이용 여부를 확인해 보세요.`:'로그인과 데이터 작업을 나눠서 고객 계정의 이용 신호를 확인합니다.'}</p><button class="text-link" data-tab="customers">고객사별 확인 ${icon('arrow')}</button></article><article class="insight"><span class="pill">이용 패턴</span><h3>${concentration}</h3><p>한 번에 많은 항목을 변경한 경우 로그 수가 크게 늘 수 있습니다. 작업일 수·메뉴 분포와 함께 확인합니다.</p><button class="text-link" data-open="customerChanges">변경 원본 확인 ${icon('arrow')}</button></article><article class="insight caution"><span class="pill amber">작업 주체</span><h3>직접·대리 작업 확정 불가</h3><p>${s.has('proxy')&&s.has('customerChanges')?`이번 기간 작업 계정 중 ${s.linkedAccounts}개는 업로드된 대리로그인 이력에도 등장합니다. 해당 계정의 모든 작업을 대리 작업으로 보지는 않습니다.`:'대리 접속 종료 시각·세션 연결번호가 없어 실제 작업 주체를 임의로 분류하지 않습니다.'}</p><button class="text-link" data-tab="support">운영지원 기록 확인 ${icon('arrow')}</button></article></div></section>
  <div class="grid-main">${panel('고객 계정의 주간 이용 추이','선택 기간 중 최근 최대 8주 · 막대를 누르면 해당 주 로그 확인',trendChart())}${panel('메뉴별 데이터 작업','조회·열람은 포함되지 않는 변경이력 기준',bars(counts(s.period.customerChanges,'menu'),{action:'customerChanges',field:'menu'}))}</div>
  <div class="grid-two">${panel('요일·시간대 이용 패턴','고객 변경이력 기준 · 진한 색일수록 기록이 많습니다.',s.has('customerChanges')?heatmap():'<p class="small-caption">고객 변경 로그가 미제공입니다.</p>')}${panel('데이터 해석 전 확인사항','선택 기간이 아닌 업로드 파일 전체의 품질 정보입니다.',qualityBody())}</div>`;
}
function renderCustomers(){
  const s=state.summary,f=state.filters,q=f.customerSearch.toLowerCase();
  const rows=s.customers.filter(row=>[row.company,company(row.company)].some(value=>value.toLowerCase().includes(q))&&(f.customerScope!=='returning'||row.loginDays.size>=2));
  if(f.customerSort==='logs')rows.sort((a,b)=>b.logs-a.logs);else if(f.customerSort==='latest')rows.sort((a,b)=>b.latest.localeCompare(a.latest));
  const companyKeys=new Set(rows.map(row=>row.key));
  const users=s.userRows.filter(row=>companyKeys.has(companyKey(row.company))&&[row.company,row.user,row.userId,company(row.company),person({...row,kind:'customerChanges'})].some(value=>value.toLowerCase().includes(q)));
  const shown=f.customerLimit==='all'?users:users.slice(0,+f.customerLimit);
  return `<div class="tab-heading"><div><h2>고객 계정의 이용 현황</h2><p>실제 작업 주체가 아니라 로그에 기록된 고객사·계정 기준입니다.</p></div><button class="button quiet" data-open="customerChanges">원본 로그</button></div><div class="info-box amber">대리 이력이 있는 계정도 집계에서 자동 제외하지 않습니다. ‘대리 이력 계정’은 해당 작업자가 관리자였다는 뜻이 아닙니다.</div>
  <section class="panel"><div class="panel-head"><div><h2>고객사별 이용</h2><p>작업일 수와 로그인일 수로 꾸준함을 함께 확인하세요.</p></div><span class="page-count">검색 ${rows.length}개사</span></div><div class="table-tools"><input class="search" id="customerSearch" data-filter="customerSearch" value="${esc(f.customerSearch)}" placeholder="고객사·표시명 검색" aria-label="고객사 검색"><select data-filter="customerSort" aria-label="고객사 정렬"><option value="days" ${f.customerSort==='days'?'selected':''}>작업일 많은 순</option><option value="logs" ${f.customerSort==='logs'?'selected':''}>변경 로그 많은 순</option><option value="latest" ${f.customerSort==='latest'?'selected':''}>최근 이용 순</option></select><select class="right" data-filter="customerLimit" aria-label="고객사 표시 개수">${limitOptions(f.customerLimit)}</select></div>${customerTable(rows,f.customerLimit)}</section>
  <section class="panel" style="margin-top:16px"><div class="panel-head"><div><h2>계정별 이용</h2><p>동일 아이디라도 고객사가 다르면 별도 계정으로 집계합니다. 변경 로그 숫자를 누르면 작업 내용을 확인할 수 있습니다.</p></div><span class="page-count">검색 ${users.length}개 계정</span></div>${table(['계정','고객사',{label:'작업일',numeric:true},{label:'로그인 성공',numeric:true},{label:'변경 로그',numeric:true},'최근 이용'],shown.map(row=>`<tr><td><button class="cell-button" data-account="${esc(row.key)}">${esc(person({...row,kind:'customerChanges'}))}</button><small>${esc(userId(row.userId))}</small></td><td>${esc(company(row.company))}</td><td class="numeric">${s.has('customerChanges')?row.activityDays.size+'일':'미제공'}</td><td class="numeric">${s.has('customerAccess')?fmt(row.logins):'미제공'}</td><td class="numeric">${logCount('customerChanges',row.logs,{account:row.key})}</td><td>${row.latest.slice(0,16)}</td></tr>`).join(''))}</section>`;
}
function renderSupport(){
  const s=state.summary,f=state.filters,branches=[...new Set(s.operators.map(op=>op.branch))].sort();
  const rows=s.operators.filter(op=>f.operatorBranch==='all'||op.branch===f.operatorBranch),shown=f.operatorLimit==='all'?rows:rows.slice(0,+f.operatorLimit);
  const mapping=s.period.adminChanges.filter(row=>row.menu==='고객사 계측기 매핑').length;
  const proxyShown=s.period.proxy.slice().sort((a,b)=>b.timestamp.localeCompare(a.timestamp)).slice(0,10);
  return `<div class="tab-heading"><div><h2>내부 운영지원</h2><p>관리자 활동과 대리 접속을 고객의 직접 이용 성과와 분리합니다.</p></div></div><div class="kpi-grid four">${kpi('관리자 활동',available('adminChanges',s.period.adminChanges.length),'행','원본 변경 행 · 계측기 대수 아님','adminChanges')}${kpi('계측기 매핑 로그',available('adminChanges',mapping),'행','매핑 건수·계측기 수와 다를 수 있음','adminChanges','green',{field:'menu',value:'고객사 계측기 매핑'})}${kpi('대리 접속 시작',available('proxy',s.period.proxy.length),'건','대리로그인 시작 이력','proxy','blue')}${kpi('지원 대상 고객사',available('proxy',s.proxyCompanies),'개사','대리 접속이 기록된 고객사','proxy')}</div>
  <div class="grid-two">${panel('관리자 메뉴별 활동','고객 변경이력과 합산하지 않습니다.',bars(counts(s.period.adminChanges,'menu'),{action:'adminChanges',field:'menu'}))}${panel('대리 접속과 작업 주체','접속 시작 기록은 실제 작업의 확정 증거가 아닙니다.',`<div class="info-box amber">대리 접속에는 종료 시각·세션 연결번호가 없습니다. 고객사·계정으로 참고 이력을 연결하지만, 고객의 모든 변경 작업을 관리자 작업으로 분류하지 않습니다.</div><ul class="quality-list"><li><b>확인 가능</b><span>어떤 관리자가 어떤 고객 계정으로 접속을 시작했는지</span></li><li><b>현재 미확인</b><span>개별 변경 작업이 고객 직접 작업인지, 대리 작업인지</span></li></ul><p class="panel-foot">직원 이름으로 지사를 연결하며 매칭되지 않은 소속은 ‘미확인’으로 유지합니다.</p>`)}</div>
  <section class="panel"><div class="panel-head"><div><h2>운영자별 지원 기록</h2><p>직원 JSON의 소속 지사 기준 · 숫자를 누르면 해당 운영자의 작업 내용을 확인합니다.</p></div><span class="page-count">${rows.length}개 운영 계정</span></div><div class="table-tools"><select data-filter="operatorBranch" aria-label="운영자 소속 지사"><option value="all">지사 전체</option>${branches.map(branch=>`<option value="${esc(branch)}" ${f.operatorBranch===branch?'selected':''}>${esc(branch)}</option>`).join('')}</select><select class="right" data-filter="operatorLimit" aria-label="운영자 표시 개수">${limitOptions(f.operatorLimit)}</select></div>${table(['운영자','소속 지사',{label:'관리자 활동',numeric:true},{label:'매핑 로그',numeric:true},{label:'대리 접속',numeric:true},'최근 기록'],shown.map(op=>`<tr><td><button class="cell-button" data-operator="${esc(op.key)}">${esc(person({...op,kind:'adminChanges'}))}</button><small>${esc(userId(op.userId))}</small></td><td>${esc(op.branch)}</td><td class="numeric">${logCount('adminChanges',op.logs,{operator:op.key},'관리자 활동')}</td><td class="numeric">${logCount('adminChanges',op.mapping,{operator:op.key,field:'menu',value:'고객사 계측기 매핑'},'매핑 로그')}</td><td class="numeric">${fmt(op.proxies)}</td><td>${op.latest.slice(0,16)}</td></tr>`).join(''))}</section>
  <section class="panel" style="margin-top:16px"><div class="panel-head"><div><h2>최근 대리 접속</h2><p>고객 계정 정보는 참조용이며 원본 변경 작업에 자동 귀속하지 않습니다.</p></div><button class="text-link" data-open="proxy">전체 이력 ${icon('arrow')}</button></div>${table(['접속 시작','관리자','대상 고객사','고객 계정','작업 연결'],proxyShown.map(row=>`<tr><td><button class="cell-button" data-single-kind="proxy" data-source-row="${row.sourceRow}">${row.timestamp.slice(0,16)}</button></td><td>${esc(person(row))}</td><td>${esc(company(row.company))}</td><td>${esc(userId(row.targetUserId))}</td><td><span class="pill gray">세션 연결정보 없음</span></td></tr>`).join(''))}</section>`;
}
function renderSecurity(){
  const s=state.summary,scope=state.filters.securityScope,stats=scope==='customerAccess'?s.customerAccess:s.adminAccess;
  const recent=stats.failures.slice().sort((a,b)=>b.timestamp.localeCompare(a.timestamp)).slice(0,10);
  const errorRows=s.period.errors.slice().sort((a,b)=>b.timestamp.localeCompare(a.timestamp)).slice(0,10);
  return `<div class="tab-heading"><div><h2>보안 접속·시스템 오류</h2><p>접속 실패는 보안사고 확정 건수가 아닙니다. 고객과 관리자 접속을 분리해 확인합니다.</p></div><select data-filter="securityScope" aria-label="보안 접속 분석 대상"><option value="customerAccess" ${scope==='customerAccess'?'selected':''}>고객 접속</option><option value="adminAccess" ${scope==='adminAccess'?'selected':''}>관리자 접속</option></select></div><div class="kpi-grid four">${kpi('로그인 시도',available(scope,stats.attempts),'행','로그아웃 제외',scope,'',{'log-type':'로그인'})}${kpi('로그인 성공',available(scope,stats.successCount),'행','결과 = 성공',scope,'green',{'log-type':'로그인',result:'성공'})}${kpi('로그인 실패',available(scope,stats.failureCount),'행','결과 = 실패',scope,'amber',{'log-type':'로그인',result:'실패'})}${kpi('반복 실패 아이디',available(scope,stats.repeatedIds.length),'개','기간 내 5회 이상 · 임시 점검 기준',scope,'',{'log-type':'로그인',result:'실패','repeated-only':'true'})}</div>
  <div class="info-box">${sourceLabel(scope)}만 집계 중입니다. ${scope==='customerAccess'?`고객사 미확인 실패 ${fmt(stats.unknownCompanyFailures)}행은 특정 고객사에 임의 배정하지 않습니다.`:'관리자 접속에는 고객사 컬럼이 없어 고객사 이용 지표에 포함하지 않습니다.'}</div>
  <section class="panel"><div class="panel-head"><div><h2>최근 로그인 실패</h2><p>선택한 접속 유형의 최근 10행 · 로그에 기록된 계정과 접속 IP를 표시합니다.</p></div><button class="text-link" data-open="${scope}" data-result="실패">실패 로그 전체 ${icon('arrow')}</button></div>${table(['일시','계정',...(scope==='customerAccess'?['고객사']:[]),'접속 IP','결과'],recent.map(row=>`<tr><td><button class="cell-button" data-single-kind="${scope}" data-source-row="${row.sourceRow}">${row.timestamp}</button></td><td>${esc(userId(row.userId))}</td>${scope==='customerAccess'?`<td>${esc(company(row.company))}</td>`:''}<td>${esc(ip(row.ip))}</td><td><span class="pill red">실패</span></td></tr>`).join(''))}</section>
  <div class="grid-two" style="margin-top:16px">${panel('시스템 오류 유형',s.has('errors')?`선택 기간 ${fmt(s.period.errors.length)}행 · 로그인 실패와 별개`:'시스템 오류 파일 미제공',bars(counts(s.period.errors,'type'),{action:'errors',field:'type'}))}${panel('오류 해석 기준','해결 상태나 장애 발생률을 임의로 만들지 않습니다.',`<ul class="quality-list"><li><span class="pill amber">처리 상태</span><span>${s.has('errors')?`상태가 비어 있는 기록 ${fmt(s.emptyErrorStatus)}행. 빈 값을 미해결로 간주하지 않습니다.`:'상태값을 확인할 오류 파일이 없습니다.'}</span></li><li><span class="pill gray">오류율</span><span>전체 요청 수가 없어 시스템 오류율은 계산하지 않습니다.</span></li><li><span class="pill gray">발생 위치</span><span>고객사·메뉴가 없는 오류는 별도 미확인 상태로 보존합니다.</span></li></ul>`)}</div>
  <section class="panel"><div class="panel-head"><div><h2>최근 시스템 오류</h2><p>오류 내용은 상세에서 확인하며 인증정보는 항상 숨깁니다.</p></div><button class="text-link" data-open="errors">원본 오류 확인 ${icon('arrow')}</button></div>${table(['발생 일시','오류 유형','발생 메뉴','고객사','처리 상태'],errorRows.map(row=>`<tr><td><button class="cell-button" data-single-kind="errors" data-source-row="${row.sourceRow}">${row.timestamp}</button></td><td>${esc(row.type)}</td><td>${esc(row.menu||'미확인')}</td><td>${esc(company(row.company))}</td><td>${row.status?esc(row.status):'<span class="pill gray">정보 없음</span>'}</td></tr>`).join(''))}</section>`;
}
function render(){
  sourceCards();
  const active=document.activeElement,saved=active?.id?{id:active.id,start:active.selectionStart,end:active.selectionEnd}:null;
  for(const button of document.querySelectorAll('.tabs [data-tab]')){const on=button.dataset.tab===state.tab;button.classList.toggle('active',on);button.setAttribute('aria-selected',String(on));button.tabIndex=on?0:-1;}
  $('analysisView').setAttribute('aria-labelledby','tab-'+state.tab);
  if(!state.model){$('analysisView').innerHTML=`<section class="empty-panel"><span class="soft-icon">${icon('chart')}</span><h2>로그를 넣으면 이용 분석이 시작됩니다</h2><p>고객 이용과 내부 지원을 나눠서 볼 수 있어요. 고객 데이터변경·접속 파일부터 시작하거나, 현재 내려받은 로그 6개를 함께 선택해 주세요.</p><button class="button primary" style="margin-top:18px" data-pick-files>로그 파일 선택</button></section>`;return;}
  $('selectionPeriod').textContent=state.summary.start+' ~ '+state.summary.end;
  $('analysisView').innerHTML=state.tab==='summary'?renderSummary():state.tab==='customers'?renderCustomers():state.tab==='support'?renderSupport():renderSecurity();
  if(state.tab==='customers'){
    const tools=$('analysisView').querySelector('.table-tools');
    tools.insertAdjacentHTML('afterbegin',`<select data-filter="customerScope" aria-label="고객사 이용 조건"><option value="all" ${state.filters.customerScope==='all'?'selected':''}>이용 고객사 전체</option><option value="returning" ${state.filters.customerScope==='returning'?'selected':''}>재방문 고객사</option></select>`);
  }
  if(saved){const element=$(saved.id);if(element){element.focus({preventScroll:true});try{element.setSelectionRange(saved.start,saved.end);}catch(_){}}}
}
function applyPeriod(start,end){
  if(!state.model)return;
  try{state.summary=aggregate(state.model,start,end);$('periodStart').value=start;$('periodEnd').value=end;render();}catch(error){note(error.message,'error');}
}
function adopt(model,{restored=false}={}){
  state.model=model;state.summary=aggregate(model);$('periodStart').value=model.start;$('periodEnd').value=model.end;
  $('periodStart').min=$('periodEnd').min=model.start;$('periodStart').max=$('periodEnd').max=model.end;
  $('availablePeriod').textContent=`업로드 범위 ${model.start} ~ ${model.end} · 파일별 시작일은 집계 기준에서 확인`;
  for(const element of document.querySelectorAll('.period-card input,.period-card button'))element.disabled=false;
  $('printBtn').disabled=false;render();note(restored?'이 브라우저에 보관한 로그를 복원했습니다.':'로그 분석 완료 · 원본 행 보존 · 외부 전송 없음','success');
}
async function importFiles(files){
  if(state.busy)return;if(!files.length)return;
  if(files.length>6){note('최대 6종의 로그 파일을 한 번에 선택해 주세요.','error');return;}
  const revision=++loadRevision;state.busy=true;$('logFiles').disabled=true;$('resetBtn').disabled=true;
  try{
    const datasets=[];
    for(const [index,file] of files.entries()){
      if(!/\.xlsx$/i.test(file.name))throw new Error('지원하는 형식은 .xlsx입니다. 원본은 변경하지 않습니다.');
      if(file.size>40*1024*1024)throw new Error(`${file.name}: 파일 한 개는 40MB 이하로 선택해 주세요.`);
      note(`${index+1}/${files.length} · ${file.name} 읽는 중…`);await new Promise(resolve=>setTimeout(resolve,0));
      datasets.push(readDataset(await parseXlsx(file),file.name));
    }
    const model=createModel(datasets,state.staff);if(revision!==loadRevision)return;
    adopt(model);if(state.remember)await persistData();
  }catch(error){if(revision===loadRevision)note(redactSecrets(error.message)+(state.model?' 기존 분석 데이터는 그대로 유지합니다.':''),'error');}
  finally{state.busy=false;$('logFiles').disabled=false;$('resetBtn').disabled=false;$('logFiles').value='';}
}

function dialogRows({controls=true}={}){
  const d=state.dialog;if(!d||!state.model)return[];let rows=state.model.sources[d.kind]?.rows||[];
  const repeated=d.repeatedOnly?new Set((d.kind==='customerAccess'?state.summary.customerAccess:state.summary.adminAccess).repeatedIds.map(item=>item.label)):null;
  return rows.filter(row=>(row.date?row.date>=d.start&&row.date<=d.end:d.includeInvalid)&&(!d.company||companyKey(row.company)===d.company)&&(!d.account||accountKey(row.company,row.userId)===d.account)&&(!d.operator||clean(row.userId||row.user).toLowerCase()===d.operator)&&(!d.result||row.result===d.result)&&(!d.logType||row.type===d.logType)&&(!repeated||repeated.has(clean(row.userId).toLowerCase()))&&(!d.field||row[d.field]===d.value)&&(!d.related||attribution(state.model,row).proxyReferences.length)&&
    (!controls||(!d.menuFilter||row.menu===d.menuFilter)&&(!d.typeFilter||row.type===d.typeFilter))&&
    (d.hour===undefined||Math.floor(Number(row.timestamp.slice(11,13))/2)*2===d.hour)&&
    (d.day===undefined||(new Date(row.date+'T00:00:00Z').getUTCDay()+6)%7===d.day)&&
    (!controls||!d.query||[row.timestamp,row.company,row.user,row.userId,row.menu,row.type,row.target,row.field,row.before,row.after,company(row.company),person(row)].some(value=>redactSecrets(value).toLowerCase().includes(d.query.toLowerCase()))))
    .slice().sort((a,b)=>b.timestamp.localeCompare(a.timestamp)||b.sourceRow-a.sourceRow);
}
function openLogs(kind,options={}){
  if(!state.model||!state.model.sources[kind]){note(`${sourceLabel(kind)} 파일을 추가해 주세요.`);return;}
  state.dialog={kind,start:state.summary.start,end:state.summary.end,query:'',limit:'10',...options};renderDialog();if(!$('detailDialog').open)$('detailDialog').showModal();
}
function dialogScope(){
  const d=state.dialog,parts=[];
  if(d.company)parts.push(state.summary.customers.find(row=>row.key===d.company)?.company||d.company);
  if(d.account){const row=state.summary.userRows.find(row=>row.key===d.account);if(row)parts.push(row.company+' · '+person(row)+' ('+userId(row.userId)+')');}
  if(d.operator){const row=state.summary.operators.find(row=>row.key===d.operator);if(row)parts.push('운영자 · '+person(row));}
  if(d.field)parts.push((d.field==='menu'?'메뉴':'필터')+' · '+d.value);
  return parts.join(' / ');
}
function renderDialog(){
  const d=state.dialog;if(!d)return;
  if(d.criteria){$('dialogTitle').textContent='집계 기준과 데이터 범위';$('dialogBody').innerHTML=`<div class="criteria-list"><section><h3>고객 계정 이용과 실제 작업 주체</h3><p>데이터 작업 고객사는 고객 변경이력이 1행 이상인 고유 고객사입니다. 고객사+아이디로 계정을 구분하며, 관리자 활동은 고객 이용에 합산하지 않습니다. 직접·대리 작업자는 현재 원본만으로 확정하지 않습니다.</p></section><section><h3>대리로그인 연관성</h3><p>고객사와 고객사 계정의 아이디가 같은 대리로그인 기록을 업로드 전체 기간에서 찾아 참고로 연결합니다. 접속 종료·세션 ID가 없으므로 해당 작업이 대리 접속으로 수행됐다고 단정하거나 계정의 모든 작업을 제외하지 않습니다.</p></section><section><h3>로그인·재방문·작업일</h3><p>로그인 성공은 유형=로그인, 결과=성공인 행만 집계합니다. 재방문은 선택 기간 중 서로 다른 날짜에 2일 이상 로그인한 고객사입니다. 작업일은 고객사별 변경이력 날짜의 고유 수입니다. 조회·체류시간·전체 고객사 대비 이용률은 산출하지 않습니다.</p></section><section><h3>원본 행·오류·기간</h3><p>같은 값의 반복 행도 실제 중복 여부를 알 수 없어 삭제하지 않습니다. 원본 행 수는 클릭 수·실제 작업 수·고유 계측기 수가 아닙니다. 오류 상태가 빈 값을 미해결로 간주하지 않으며, 전체 요청 수가 없어 오류율도 산출하지 않습니다. 시간은 엑셀에 기록된 시각 그대로 해석합니다.</p></section><section><h3>개인정보와 보관</h3><p>새 분석 화면에는 원본 파일을 외부로 보내는 기능이 없습니다. 고객사명·직원명과 원문은 로그에 기록된 값으로 표시하며, API 키·토큰 등 인증정보는 계속 숨깁니다. 데이터 보관은 명시적으로 선택한 경우에만 이 브라우저의 별도 저장소를 사용합니다.</p></section><section><h3>업로드된 원본의 범위</h3><div class="coverage-box">${state.model?Object.values(state.model.sources).map(source=>`<div class="coverage-row"><strong>${source.label}</strong><span>${esc(source.fileName)}<br>${source.start||'기간 없음'} ~ ${source.end||'기간 없음'}</span><span>${fmt(source.rows.length)}행<br>일시 미확인 ${source.invalidDates}행</span></div>`).join(''):'아직 업로드한 파일이 없습니다.'}</div></section></div>`;return;}
  const source=state.model.sources[d.kind],isChange=['customerChanges','adminChanges'].includes(d.kind);$('dialogTitle').textContent=source.label+' · '+(d.detail?'행 상세':isChange?'변경 작업 상세':'원본 로그');
  $('detailDialog').classList.toggle('change-dialog',isChange);
  if(d.detail){
    const row=source.rows.find(row=>row.sourceRow===d.detail);if(!row)return;
    const actor=attribution(state.model,row);
    $('dialogBody').innerHTML=`<button class="button quiet dialog-back" data-dialog-back>← 목록으로</button><div class="info-box ${row.kind==='customerChanges'?'amber':''}"><strong>${esc(actor.label)}</strong> · 원본 ${source.label}, ${row.sourceRow}행${row.duplicate?' · 동일 값 반복 행(제외하지 않음)':''}<br>${row.kind==='customerChanges'?'로그에 표시된 계정만 확인됩니다. 실제 작업 주체를 임의 확정하지 않습니다.':'이 파일의 기록 범위와 행 기준으로만 확인합니다.'}</div>${actor.proxyReferences.length?`<section class="panel" style="margin-bottom:16px"><h3>같은 고객사·계정의 대리 접속 시작 이력 ${actor.proxyReferences.length}건</h3><p class="small-caption">업로드 전체 기간의 참고 이력입니다. 접속 중 수행된 작업임을 증명하지는 않습니다.</p>${table(['접속 시작','접속 관리자','계정'],actor.proxyReferences.slice(0,10).map(reference=>`<tr><td>${reference.timestamp}</td><td>${esc(person(reference))}</td><td>${esc(userId(reference.targetUserId))}</td></tr>`).join(''))}</section>`:''}<p class="small-caption">${esc(source.fileName)} · 시트 ${esc(source.sheetName)} · 원본 ${row.sourceRow}행</p><dl class="detail-fields">${source.headers.map(header=>{const key=header.replace(/[\s*\uFEFF]/g,'').toLowerCase();return `<dt>${esc(header)}</dt><dd>${esc(row.raw[key]||'—')}</dd>`;}).join('')}</dl>`;return;
  }
  const rows=dialogRows(),shown=d.limit==='all'?rows:rows.slice(0,+d.limit),choices=isChange?dialogRows({controls:false}):[];
  const filter=(id,label,key,selected)=>`<select id="${id}" aria-label="${label}"><option value="">${label} 전체</option>${counts(choices,key).map(item=>`<option value="${esc(item.label)}" ${selected===item.label?'selected':''}>${esc(item.label)} (${fmt(item.count)})</option>`).join('')}</select>`;
  const ordinaryTable=()=>table(['일시','구분 / 메뉴','고객사','기록된 계정','결과 / 주체'],shown.map(row=>`<tr><td><button class="cell-button" data-detail-row="${row.sourceRow}">${row.timestamp||'일시 미확인'}</button><small>원본 ${row.sourceRow}행${row.duplicate?' · 동일 값 반복':''}</small></td><td>${esc(row.type||'—')}<small>${esc(row.menu||source.label)}</small></td><td>${row.company?esc(company(row.company)):'—'}</td><td>${esc(person(row))}<small>${esc(userId(row.userId))}</small></td><td>${row.result?`<span class="pill ${row.result==='실패'?'red':'green'}">${esc(row.result)}</span>`:row.kind==='proxy'?'<span class="pill">대리 접속 시작</span>':esc(row.status||'상태 정보 없음')}</td></tr>`).join(''));
  $('dialogBody').innerHTML=`<p class="small-caption">${d.start} ~ ${d.end}${d.includeInvalid?' · 일시 미확인 포함':''} · ${fmt(rows.length)}행 · 원본 행 보존${dialogScope()?' · '+esc(dialogScope()):''}</p>
    ${d.kind==='customerChanges'?'<div class="info-box amber">이 목록은 고객 계정에 기록된 변경입니다. 대리 이력 유무만으로 실제 작업자를 확정하지 않습니다.</div>':''}
    <div class="table-tools"><select id="dialogKind" aria-label="원본 로그 종류">${DEFINITIONS.filter(def=>state.model.sources[def.id]).map(def=>`<option value="${def.id}" ${def.id===d.kind?'selected':''}>${def.label}</option>`).join('')}</select>
    ${isChange?filter('dialogMenu','메뉴','menu',d.menuFilter)+filter('dialogType','변경 유형','type',d.typeFilter):''}
    <input class="search" id="dialogSearch" placeholder="${isChange?'대상·항목·변경 전후 검색':'고객사·계정·메뉴 검색'}" aria-label="원본 로그 검색" value="${esc(d.query)}"><select id="dialogLimit" class="right" aria-label="원본 로그 표시 개수">${limitOptions(d.limit)}</select><span class="page-count">${shown.length} / ${rows.length}행</span></div>
    ${isChange?'<p class="small-caption">변경 대상과 전후 값을 바로 확인하세요. 긴 값은 일부 표시되며 ‘행 상세 보기’에서 전체 원문을 볼 수 있습니다.</p>'+changeLogTable(shown):ordinaryTable()}`;
  if(source.invalidDates)$('dialogBody').querySelector('.table-tools').insertAdjacentHTML('beforeend',`<label class="small-caption"><input type="checkbox" id="includeInvalid" ${d.includeInvalid?'checked':''}>일시 미확인 ${source.invalidDates}행 포함</label>`);
}

async function cacheTransaction(mode,callback){
  return new Promise((resolve,reject)=>{const request=indexedDB.open('cwiz-usage-analysis-v1',1);request.onupgradeneeded=()=>request.result.createObjectStore('analysis');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;try{const transaction=db.transaction('analysis',mode);const query=callback(transaction.objectStore('analysis'));let value;query.onsuccess=()=>{value=query.result;};transaction.oncomplete=()=>{db.close();resolve(value);};transaction.onerror=transaction.onabort=()=>{db.close();reject(transaction.error||new Error('브라우저 저장이 중단됐습니다.'));};}catch(error){db.close();reject(error);}};});
}
async function persistData(){if(!state.model)return;try{await cacheTransaction('readwrite',store=>store.put({schema:1,datasets:Object.values(state.model.sources),savedAt:new Date().toISOString()},'current'));}catch(_){note('분석은 완료됐지만 브라우저 보관에 실패했습니다. 현재 화면은 유지합니다.','error');}}
async function clearStoredData(){try{await cacheTransaction('readwrite',store=>store.delete('current'));}catch(_){note('브라우저 보관 데이터를 삭제하지 못했습니다. 사이트 저장 권한을 확인해 주세요.','error');}}

document.addEventListener('click',event=>{
  const target=event.target.closest('button,[role="button"]');if(!target)return;
  if(target.hasAttribute('data-pick-files')){$('logFiles').click();return;}
  if(target.dataset.tab){state.tab=target.dataset.tab;render();return;}
  if(target.dataset.customerScope){state.filters.customerScope=target.dataset.customerScope;state.filters.customerSearch='';state.tab='customers';render();return;}
  if(target.dataset.open){
    const options={};for(const key of ['result','logType','field','value','company','account','operator'])if(target.dataset[key])options[key]=target.dataset[key];
    if(target.dataset.repeatedOnly)options.repeatedOnly=true;
    openLogs(target.dataset.open,options);return;
  }
  if(target.dataset.barAction){openLogs(target.dataset.barAction,{field:target.dataset.field,value:target.dataset.value});return;}
  if(target.dataset.company){openLogs(state.model.sources.customerChanges?'customerChanges':'customerAccess',{company:target.dataset.company});return;}
  if(target.dataset.account){openLogs(state.model.sources.customerChanges?'customerChanges':'customerAccess',{account:target.dataset.account});return;}
  if(target.dataset.operator){openLogs(state.model.sources.adminChanges?'adminChanges':'proxy',{operator:target.dataset.operator});return;}
  if(target.dataset.singleKind){openLogs(target.dataset.singleKind,{detail:+target.dataset.sourceRow});return;}
  if(target.dataset.weekStart){openLogs('customerChanges',{start:target.dataset.weekStart,end:target.dataset.weekEnd});return;}
  if(target.dataset.heatDay!==undefined){openLogs('customerChanges',{day:+target.dataset.heatDay,hour:+target.dataset.heatHour});return;}
  if(target.dataset.detailRow){state.dialog.detail=+target.dataset.detailRow;renderDialog();$('dialogBody').scrollTop=0;return;}
  if(target.hasAttribute('data-dialog-back')){delete state.dialog.detail;renderDialog();return;}
  if(target.dataset.preset&&state.model){const days=+target.dataset.preset;const end=state.model.end,start=target.dataset.preset==='all'?state.model.start:new Date(Date.parse(end+'T00:00:00Z')-(days-1)*86400000).toISOString().slice(0,10);applyPeriod(start<state.model.start?state.model.start:start,end);document.querySelectorAll('[data-preset]').forEach(button=>button.classList.toggle('selected',button===target));}
});
document.addEventListener('keydown',event=>{
  const target=event.target;if(target.matches('.tabs [role="tab"]')&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const buttons=[...document.querySelectorAll('.tabs button')],current=buttons.indexOf(target),index=event.key==='Home'?0:event.key==='End'?buttons.length-1:(current+(event.key==='ArrowRight'?1:buttons.length-1))%buttons.length;buttons[index].click();buttons[index].focus();return;}
  if(target.getAttribute('role')==='button'&&['Enter',' '].includes(event.key)){event.preventDefault();target.click();}
});
document.addEventListener('change',event=>{
  const target=event.target;
  if(target.dataset.filter){state.filters[target.dataset.filter]=target.value;render();}
  if(target.id==='dialogKind'){state.dialog={kind:target.value,start:state.summary.start,end:state.summary.end,query:'',limit:state.dialog.limit};renderDialog();}
  if(target.id==='dialogLimit'){state.dialog.limit=target.value;renderDialog();}
  if(target.id==='dialogMenu'){state.dialog.menuFilter=target.value;renderDialog();}
  if(target.id==='dialogType'){state.dialog.typeFilter=target.value;renderDialog();}
  if(target.id==='includeInvalid'){state.dialog.includeInvalid=target.checked;renderDialog();}
});
let searchTimer;
document.addEventListener('input',event=>{
  const target=event.target;if(!['customerSearch','dialogSearch'].includes(target.id))return;
  clearTimeout(searchTimer);searchTimer=setTimeout(()=>{
    if(target.id==='customerSearch'){state.filters.customerSearch=target.value;render();}
    else if(state.dialog){state.dialog.query=target.value;const cursor=target.selectionStart;renderDialog();$('dialogSearch')?.focus();$('dialogSearch')?.setSelectionRange(cursor,cursor);}
  },100);
});
$('logFiles').addEventListener('change',event=>importFiles([...event.target.files]));
$('dropZone').addEventListener('click',()=>$('logFiles').click());
for(const name of ['dragenter','dragover'])$('dropZone').addEventListener(name,event=>{event.preventDefault();$('dropZone').classList.add('over');});
for(const name of ['dragleave','drop'])$('dropZone').addEventListener(name,event=>{event.preventDefault();$('dropZone').classList.remove('over');if(name==='drop')importFiles([...event.dataTransfer.files]);});
$('queryBtn').addEventListener('click',()=>applyPeriod($('periodStart').value,$('periodEnd').value));
$('rememberData').addEventListener('change',async event=>{state.remember=event.target.checked;if(state.remember)await persistData();else await clearStoredData();});
$('resetBtn').addEventListener('click',async()=>{loadRevision++;state.model=null;state.summary=null;state.dialog=null;$('detailDialog').close();await clearStoredData();$('periodStart').value=$('periodEnd').value='';for(const element of document.querySelectorAll('.period-card input,.period-card button'))element.disabled=true;$('printBtn').disabled=true;$('availablePeriod').textContent='아직 로그가 없습니다.';$('selectionPeriod').textContent='';render();note('새 분석의 데이터만 초기화했습니다. 기존 운영현황 캐시는 변경하지 않았습니다.');});
$('criteriaBtn').addEventListener('click',()=>{state.dialog={criteria:true};$('detailDialog').classList.remove('change-dialog');renderDialog();$('detailDialog').showModal();});
$('dialogClose').addEventListener('click',()=>$('detailDialog').close());
$('detailDialog').addEventListener('click',event=>{if(event.target===$('detailDialog')){const bounds=$('detailDialog').getBoundingClientRect();if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)$('detailDialog').close();}});
$('printBtn').addEventListener('click',()=>{const previous=state.tab;state.tab='summary';render();document.body.classList.add('printing-summary');window.addEventListener('afterprint',()=>{document.body.classList.remove('printing-summary');state.tab=previous;render();},{once:true});requestAnimationFrame(()=>window.print());});

async function initialize(){
  const params=new URLSearchParams(location.search);if(params.get('tab')==='weekly'){location.replace('./legacy.html'+location.search);return;}
  render();document.documentElement.dataset.appReady='true';
  try{const response=await fetch('../data/staff-branch-map.json',{cache:'no-cache'});if(response.ok){state.staff=(await response.json()).staff||{};if(state.model){state.model.staff=state.staff;state.summary=aggregate(state.model,state.summary.start,state.summary.end);render();}}}catch(_){}
  try{const cached=await cacheTransaction('readonly',store=>store.get('current'));if(cached?.schema===1&&!loadRevision){adopt(createModel(cached.datasets,state.staff),{restored:true});state.remember=true;$('rememberData').checked=true;}}catch(_){note('이 브라우저의 보관 데이터를 읽지 못했습니다. 원본 파일을 다시 선택해 주세요.','error');}
}
initialize();
