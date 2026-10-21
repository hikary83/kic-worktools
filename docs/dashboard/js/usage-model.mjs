// 집계는 원본 행을 보존합니다. 대리 계정 연관성은 작업 주체의 확정 근거가 아닙니다.
export const DEFINITIONS = [
  {id:'customerChanges',label:'고객 데이터변경',required:['일시','고객사','사용자','아이디','메뉴','로그 유형','대상','변경 항목','변경 전','변경 후'],time:'일시'},
  {id:'customerAccess',label:'고객 접속',required:['일시','고객사','사용자','아이디','로그 유형','결과','접속 IP'],time:'일시'},
  {id:'adminChanges',label:'관리자 활동',required:['일시','사용자','아이디','메뉴','로그 유형','대상','변경 항목','변경 전','변경 후'],forbidden:['고객사'],time:'일시'},
  {id:'adminAccess',label:'관리자 접속',required:['일시','사용자','아이디','로그 유형','결과','접속 IP'],forbidden:['고객사'],time:'일시'},
  {id:'proxy',label:'대리로그인',required:['접속 시작','관리자','아이디','고객사','고객사 계정','접속 사유','접속 IP'],time:'접속 시작'},
  {id:'errors',label:'시스템 오류',required:['일시','오류 유형','발생 메뉴','오류 대상','상태','고객사','실행 사용자','아이디','사용자 IP','오류 내용','예외 클래스'],time:'일시'}
];
export const clean = v => String(v ?? '').trim();
export const headerKey = v => clean(v).replace(/[\s*\uFEFF]/g,'').toLowerCase();
export const companyKey = v => clean(v).replace(/\s+/g,' ').toLocaleLowerCase('ko-KR');
export const identityKey = v => clean(v).toLowerCase();
export const accountKey = (company,id) => companyKey(company) && identityKey(id) ? `${companyKey(company)}|${identityKey(id)}` : '';
export function isoTime(value) {
  const m=clean(value).match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if(!m) return '';
  const [year,month,day,hour,minute,second]=[+m[1],+m[2],+m[3],+(m[4]||0),+(m[5]||0),+(m[6]||0)];
  const test=new Date(Date.UTC(year,month-1,day));
  if(test.getUTCFullYear()!==year||test.getUTCMonth()!==month-1||test.getUTCDate()!==day||hour>23||minute>59||second>59) return '';
  return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')} ${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:${String(second).padStart(2,'0')}`;
}
export function parseProxyAccount(value) {
  const match=clean(value).match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  return match ? {name:clean(match[1]),id:identityKey(match[2])} : {name:clean(value),id:''};
}

export function readDataset(sheets,fileName) {
  let found=null;
  for(const sheet of sheets) for(let h=0;h<Math.min(sheet.rows.length,10);h++) {
    const headers=sheet.rows[h].map(clean),keys=headers.map(headerKey);
    for(const definition of DEFINITIONS) {
      if(!definition.required.every(key=>keys.includes(headerKey(key)))||definition.forbidden?.some(key=>keys.includes(headerKey(key)))) continue;
      if(found && (found.sheet!==sheet||found.headerRow!==h||found.definition.id!==definition.id)) throw new Error(`${fileName}: 인식 가능한 로그 시트가 여러 개입니다. 한 종류의 로그만 포함해 주세요.`);
      found={sheet,headers,keys,headerRow:h,definition};
    }
  }
  if(!found) throw new Error(`${fileName}: 지원하는 로그 컬럼을 찾지 못했습니다. 파일명이 아닌 컬럼으로 종류를 구분합니다.`);
  const {sheet,headers,keys,headerRow,definition}=found;
  if(new Set(keys.filter(Boolean)).size!==keys.filter(Boolean).length) throw new Error(`${fileName}: 같은 이름의 컬럼이 중복됩니다.`);
  const seen=new Map();
  const rows=sheet.rows.slice(headerRow+1).map((values,index)=>({values,index})).filter(({values})=>values.some(v=>clean(v))).map(({values,index})=>{
    const raw=Object.fromEntries(keys.filter(Boolean).map(key=>[key,clean(values[keys.indexOf(key)])]));
    const get=key=>raw[headerKey(key)]||'';
    const signature=JSON.stringify(keys.map((key,i)=>[key,clean(values[i])]));
    const duplicate=seen.has(signature);seen.set(signature,true);
    const timestamp=isoTime(get(definition.time));
    const proxyAccount=definition.id==='proxy'?parseProxyAccount(get('고객사 계정')):null;
    return {kind:definition.id,sourceRow:headerRow+index+2,timestamp,date:timestamp.slice(0,10),company:get('고객사'),
      user:get('사용자')||get('관리자')||get('실행 사용자'),userId:get('아이디'),menu:get('메뉴')||get('발생 메뉴'),
      type:get('로그 유형')||get('오류 유형')||(definition.id==='proxy'?'대리 접속':''),result:get('결과'),
      target:get('대상')||get('오류 대상'),field:get('변경 항목'),before:get('변경 전'),after:get('변경 후'),
      ip:get('접속 IP')||get('사용자 IP'),reason:get('접속 사유'),status:get('상태'),message:get('오류 내용'),exception:get('예외 클래스'),
      targetUser:proxyAccount?.name||'',targetUserId:proxyAccount?.id||'',raw,duplicate};
  });
  const times=rows.map(row=>row.timestamp).filter(Boolean).sort();
  return {kind:definition.id,label:definition.label,fileName,sheetName:sheet.name,headers,headerRow:headerRow+1,rows,
    start:times[0]?.slice(0,10)||'',end:times.at(-1)?.slice(0,10)||'',invalidDates:rows.filter(row=>!row.timestamp).length,
    duplicates:rows.filter(row=>row.duplicate).length};
}

export function createModel(datasets,staff={}) {
  const sources={};
  for(const dataset of datasets) {
    if(!DEFINITIONS.some(def=>def.id===dataset.kind)||!Array.isArray(dataset.rows)) throw new Error('호환되지 않는 로그 데이터입니다.');
    if(sources[dataset.kind]) throw new Error(`${dataset.label}: 같은 종류의 파일을 두 번 선택했습니다. 최신 파일 한 개만 선택해 주세요.`);
    sources[dataset.kind]=dataset;
  }
  if(!datasets.length) throw new Error('분석할 로그 파일을 선택해 주세요.');
  const starts=datasets.map(d=>d.start).filter(Boolean).sort(),ends=datasets.map(d=>d.end).filter(Boolean).sort();
  const exportDates=datasets.map(d=>d.fileName.match(/\d{4}-\d{2}-\d{2}/)?.[0]).filter(Boolean).sort();
  const start=starts[0]||exportDates[0],end=ends.at(-1)||exportDates.at(-1);
  if(!start||!end) throw new Error('로그와 파일명에서 분석 기간을 확인할 수 없습니다.');
  const proxyByAccount=new Map();
  for(const row of sources.proxy?.rows||[]) {
    const key=accountKey(row.company,row.targetUserId);if(!key) continue;
    if(!proxyByAccount.has(key)) proxyByAccount.set(key,[]);
    proxyByAccount.get(key).push(row);
  }
  for(const values of proxyByAccount.values()) values.sort((a,b)=>b.timestamp.localeCompare(a.timestamp));
  return {sources,start,end,staff,proxyByAccount};
}

export function attribution(model,row) {
  if(row.kind==='adminChanges') return {label:'관리자 활동 기록',confirmedActor:row.user||row.userId,proxyReferences:[],confirmedCustomerAction:false,confirmedProxyAction:false};
  if(row.kind==='proxy') return {label:'대리 접속 시작 기록',confirmedActor:row.user||row.userId,proxyReferences:[],confirmedCustomerAction:false,confirmedProxyAction:false};
  const references=row.kind==='customerChanges'?(model.proxyByAccount.get(accountKey(row.company,row.userId))||[]):[];
  return {label:'작업 주체 미확인',confirmedActor:'',proxyReferences:references,confirmedCustomerAction:false,confirmedProxyAction:false};
}
export const inRange = (rows,start,end) => rows.filter(row=>row.date&&row.date>=start&&row.date<=end);
export function counts(rows,key) {
  const map=new Map();for(const row of rows){const value=typeof key==='function'?key(row):row[key];if(value)map.set(value,(map.get(value)||0)+1);}
  return [...map].map(([label,count])=>({label,count})).sort((a,b)=>b.count-a.count||clean(a.label).localeCompare(clean(b.label),'ko'));
}
export function accessStats(rows) {
  const logins=rows.filter(r=>r.type==='로그인'),successes=logins.filter(r=>r.result==='성공'),failures=logins.filter(r=>r.result==='실패');
  const companies=new Map();for(const row of successes){const key=companyKey(row.company);if(!key)continue;if(!companies.has(key))companies.set(key,new Set());companies.get(key).add(row.date);}
  return {logins,successes,failures,attempts:logins.length,successCount:successes.length,failureCount:failures.length,
    companies:companies.size,returning:[...companies.values()].filter(days=>days.size>=2).length,
    users:new Set(successes.map(row=>accountKey(row.company,row.userId)||(!row.company?identityKey(row.userId):'')).filter(Boolean)).size,
    repeatedIds:counts(failures,row=>identityKey(row.userId)).filter(item=>item.count>=5),unknownCompanyFailures:failures.filter(r=>!r.company).length};
}
export function aggregate(model,start=model.start,end=model.end) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||start>end) throw new Error('시작일과 종료일을 확인해 주세요.');
  const period=Object.fromEntries(DEFINITIONS.map(def=>[def.id,inRange(model.sources[def.id]?.rows||[],start,end)]));
  const customerAccess=accessStats(period.customerAccess),adminAccess=accessStats(period.adminAccess);
  const groups=new Map(),users=new Map();
  const groupFor=row=>{
    const key=companyKey(row.company);if(!key)return null;
    if(!groups.has(key))groups.set(key,{key,company:row.company,logs:0,loginCount:0,activityDays:new Set(),loginDays:new Set(),users:new Set(),menus:new Set(),latest:'',proxyCount:0,relatedAccounts:new Set()});
    return groups.get(key);
  };
  const userFor=row=>{
    const identity=row.userId;if(!row.company||!identity)return null;
    const key=accountKey(row.company,identity);if(!users.has(key))users.set(key,{key,company:row.company,user:row.user,userId:row.userId,logs:0,logins:0,activityDays:new Set(),loginDays:new Set(),latest:''});
    return users.get(key);
  };
  for(const row of period.customerChanges) {
    const group=groupFor(row),user=userFor(row);
    if(group){group.logs++;group.activityDays.add(row.date);group.menus.add(row.menu);group.latest=group.latest>row.timestamp?group.latest:row.timestamp;if(row.userId)group.users.add(accountKey(row.company,row.userId));if(attribution(model,row).proxyReferences.length)group.relatedAccounts.add(accountKey(row.company,row.userId));}
    if(user){user.logs++;user.activityDays.add(row.date);user.latest=user.latest>row.timestamp?user.latest:row.timestamp;}
  }
  for(const row of customerAccess.successes) {
    const group=groupFor(row),user=userFor(row);
    if(group){group.loginCount++;group.loginDays.add(row.date);group.latest=group.latest>row.timestamp?group.latest:row.timestamp;if(row.userId)group.users.add(accountKey(row.company,row.userId));}
    if(user){user.logins++;user.loginDays.add(row.date);user.latest=user.latest>row.timestamp?user.latest:row.timestamp;}
  }
  for(const row of period.proxy){const group=groups.get(companyKey(row.company));if(group)group.proxyCount++;}
  const customers=[...groups.values()].sort((a,b)=>b.activityDays.size-a.activityDays.size||b.loginDays.size-a.loginDays.size||b.logs-a.logs||a.key.localeCompare(b.key));
  const userRows=[...users.values()].sort((a,b)=>b.activityDays.size-a.activityDays.size||b.logs-a.logs);
  const changeCompanies=counts(period.customerChanges,row=>companyKey(row.company));
  const operators=new Map();
  for(const row of [...period.adminChanges,...period.proxy]) {
    const key=identityKey(row.userId)||row.user;if(!key)continue;
    if(!operators.has(key))operators.set(key,{key,user:row.user,userId:row.userId,branch:model.staff[clean(row.user).replace(/\s+/g,'').replace(/님$/,'')]||'미확인',logs:0,mapping:0,proxies:0,companies:new Set(),latest:''});
    const op=operators.get(key);op.latest=op.latest>row.timestamp?op.latest:row.timestamp;
    if(row.kind==='adminChanges'){op.logs++;if(row.menu==='고객사 계측기 매핑')op.mapping++;}else{op.proxies++;if(row.company)op.companies.add(companyKey(row.company));}
  }
  return {start,end,period,customerAccess,adminAccess,customers,userRows,operators:[...operators.values()].sort((a,b)=>b.logs-a.logs||b.proxies-a.proxies),
    has:id=>Boolean(model.sources[id]),changeCompanies:changeCompanies.length,changeUsers:new Set(period.customerChanges.map(row=>accountKey(row.company,row.userId)).filter(Boolean)).size,
    recurringChangeCompanies:customers.filter(row=>row.activityDays.size>=2).length,topShare:period.customerChanges.length?(changeCompanies[0]?.count||0)/period.customerChanges.length:null,
    linkedAccounts:new Set(period.customerChanges.filter(row=>attribution(model,row).proxyReferences.length).map(row=>accountKey(row.company,row.userId))).size,
    proxyCompanies:new Set(period.proxy.map(row=>companyKey(row.company)).filter(Boolean)).size,
    emptyErrorStatus:period.errors.filter(row=>!row.status).length};
}

export function weeklyTrend(summary,max=8) {
  const monday=date=>{const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10);};
  const shift=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
  const last=monday(summary.end),bins=[];
  for(let i=max-1;i>=0;i--){const week=shift(last,-7*i),until=shift(week,6);if(until<summary.start)continue;const start=week<summary.start?summary.start:week,end=until>summary.end?summary.end:until;const rows=inRange(summary.period.customerChanges,start,end);bins.push({start,end,logs:rows.length,companies:new Set(rows.map(row=>companyKey(row.company)).filter(Boolean)).size});}
  return bins;
}
export function redactSecrets(value) {
  return clean(value).replace(/AIza[A-Za-z0-9_-]{20,}/g,'[인증정보 숨김]').replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi,'Bearer [숨김]')
    .replace(/([?&](?:key|api_key|access_token|token|password)=)[^&\s]+/gi,'$1[숨김]')
    .replace(/((?:api[_ -]?key|access[_ -]?token|password|authorization)\s*[=:]\s*)[^\s,;]+/gi,'$1[숨김]');
}
