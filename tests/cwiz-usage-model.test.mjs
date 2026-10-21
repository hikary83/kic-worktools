import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DEFINITIONS,readDataset,createModel,aggregate,attribution,isoTime,parseProxyAccount,weeklyTrend,accessStats,redactSecrets} from '../docs/dashboard/js/usage-model.mjs';

const change=['2026-10-20 09:00:00','예시 고객사','예시 사용자','demo@example.invalid','계측기 통합 대장','수정','예시 장비','설치 위치','A','B'];
const proxy=['2026-10-20 08:00:00','예시 운영자','operator@example.invalid','예시 고객사','예시 사용자 (demo@example.invalid)','기능 확인','192.0.2.1'];
function dataset(kind,rows=[]){const definition=DEFINITIONS.find(d=>d.id===kind);return readDataset([{name:'데이터변경이력',rows:[definition.required,...rows]}],'같은파일명_2026-10-21.xlsx');}
const customerChanges=()=>dataset('customerChanges',[change,[...change],['2026-10-21 10:00:00',...change.slice(1)]]);
test('아이디 누락을 사용자 이름으로 임의 대체하지 않는다',()=>{
  const missing=[...change];missing[3]='';const summary=aggregate(createModel([dataset('customerChanges',[missing])]));
  assert.equal(summary.period.customerChanges.length,1);assert.equal(summary.changeUsers,0);assert.equal(summary.userRows.length,0);
});
const customerAccess=()=>dataset('customerAccess',[
  ['2026-10-20 08:00:00','예시 고객사','예시 사용자','demo@example.invalid','로그인','성공','192.0.2.1'],
  ['2026-10-21 08:00:00','예시 고객사','예시 사용자','demo@example.invalid','로그인','성공','192.0.2.1'],
  ['2026-10-21 08:10:00','예시 고객사','예시 사용자','demo@example.invalid','로그아웃','성공','192.0.2.1'],
  ['2026-10-21 09:00:00','','','unknown','로그인','실패','192.0.2.2']]);

for(const definition of DEFINITIONS)test(`컬럼으로 ${definition.label} 인식, 파일명·시트명에 의존하지 않음`,()=>assert.equal(dataset(definition.id).kind,definition.id));
test('고객과 관리자 변경 로그를 같은 종류로 인식하지 않는다',()=>{assert.equal(customerChanges().kind,'customerChanges');assert.equal(dataset('adminChanges').kind,'adminChanges');});
test('두 접속 로그는 고객사 컬럼으로 분리한다',()=>assert.notEqual(dataset('customerAccess').kind,dataset('adminAccess').kind));
test('헤더 별표·공백·BOM을 허용하고 앞부분 안내 행을 찾는다',()=>{const definition=DEFINITIONS[0];const parsed=readDataset([{name:'Sheet',rows:[['설명'],definition.required.map(h=>'\uFEFF '+h+' *'),change]}],'log.xlsx');assert.equal(parsed.headerRow,2);assert.equal(parsed.rows[0].sourceRow,3);});
test('알 수 없는 컬럼은 이전 데이터를 덮어쓸 수 있는 정상 파일로 채택하지 않는다',()=>assert.throws(()=>readDataset([{name:'Sheet',rows:[['알수없는컬럼'],['값']]}],'x.xlsx'),/컬럼/));
test('중복 컬럼명을 거부한다',()=>assert.throws(()=>readDataset([{name:'Sheet',rows:[[...DEFINITIONS[0].required,'아이디'],[...change,'other']]}],'x.xlsx'),/컬럼이 중복/));
test('한 파일에 여러 로그 시트가 있으면 사용자가 구분하도록 거부한다',()=>assert.throws(()=>readDataset([{name:'A',rows:[DEFINITIONS[0].required,change]},{name:'B',rows:[DEFINITIONS[0].required,change]}],'x.xlsx'),/여러 개/));
test('동일 종류의 파일 두 개를 합산하지 않는다',()=>assert.throws(()=>createModel([customerChanges(),customerChanges()]),/두 번/));
test('파일이 없으면 분석을 시작하지 않는다',()=>assert.throws(()=>createModel([]),/선택/));
test('원본 동일행 반복을 보존하며 별도로 표시한다',()=>{const data=customerChanges();assert.equal(data.rows.length,3);assert.equal(data.duplicates,1);assert.equal(aggregate(createModel([data])).period.customerChanges.length,3);});
test('헤더만 있는 파일은 미제공과 구분해 0행으로 지원한다',()=>{const s=aggregate(createModel([dataset('errors')]));assert.equal(s.has('errors'),true);assert.equal(s.period.errors.length,0);assert.equal(s.has('customerChanges'),false);});
test('로그 범위와 파일 기준일을 구분한다',()=>{const m=createModel([customerChanges()]);assert.equal(m.start,'2026-10-20');assert.equal(m.end,'2026-10-21');});
test('잘못된 일시는 원본에 보존하고 기간 집계에서 제외한다',()=>{const data=dataset('customerChanges',[['2026-02-30',...change.slice(1)],change]);assert.equal(data.invalidDates,1);assert.equal(data.rows.length,2);assert.equal(aggregate(createModel([data])).period.customerChanges.length,1);});
test('일시의 날짜·시각 경계를 검증한다',()=>{assert.equal(isoTime('2026-10-21 23:59:59'),'2026-10-21 23:59:59');assert.equal(isoTime('2026-10-21 24:00:00'),'');assert.equal(isoTime('2026-13-01'),'');assert.equal(isoTime('2026/1/2 3:04'),'2026-01-02 03:04:00');});
test('기간 마지막 날 전체를 포함한다',()=>{const m=createModel([customerChanges()]);const s=aggregate(m,'2026-10-21','2026-10-21');assert.equal(s.period.customerChanges.length,1);});
test('역전 기간은 기존 모델을 수정하지 않고 거부한다',()=>{const m=createModel([customerChanges()]);assert.throws(()=>aggregate(m,'2026-10-22','2026-10-20'),/시작일/);assert.equal(m.sources.customerChanges.rows.length,3);});
test('고객 직접 작업 또는 대리 작업을 임의 확정하지 않는다',()=>{const m=createModel([customerChanges(),dataset('proxy',[proxy])]);const a=attribution(m,m.sources.customerChanges.rows[0]);assert.equal(a.label,'작업 주체 미확인');assert.equal(a.proxyReferences.length,1);assert.equal(a.confirmedActor,'');assert.equal(a.confirmedProxyAction,false);assert.equal(a.confirmedCustomerAction,false);});
test('대리 이력이 없는 계정도 직접 작업으로 확정하지 않는다',()=>assert.equal(attribution(createModel([customerChanges()]),customerChanges().rows[0]).confirmedCustomerAction,false));
test('대리 계정은 고객사와 아이디가 모두 같아야 연결한다',()=>{const m=createModel([customerChanges(),dataset('proxy',[[proxy[0],proxy[1],proxy[2],'다른 고객사',...proxy.slice(4)]])]);assert.equal(attribution(m,m.sources.customerChanges.rows[0]).proxyReferences.length,0);});
test('대리 계정의 이름(아이디)을 추출하고 불명확한 계정은 이름으로 추정하지 않는다',()=>{assert.equal(parseProxyAccount('이름 (DEMO@example.invalid)').id,'demo@example.invalid');assert.equal(parseProxyAccount('이름만').id,'');});
test('대리 이력 시점이 나중이어도 계정 참조일 뿐 작업 귀속은 확정하지 않는다',()=>{const m=createModel([customerChanges(),dataset('proxy',[['2026-10-22 12:00:00',...proxy.slice(1)]])]);assert.equal(attribution(m,m.sources.customerChanges.rows[0]).confirmedProxyAction,false);assert.equal(aggregate(m).period.customerChanges.length,3);});
test('관리자 변경은 고객 이용 수에 합산하지 않는다',()=>{const admin=dataset('adminChanges',[['2026-10-21 10:00:00','예시 운영자','op','고객사 계측기 매핑','등록','대상','항목','','값']]);const s=aggregate(createModel([customerChanges(),admin]));assert.equal(s.period.customerChanges.length,3);assert.equal(s.period.adminChanges.length,1);assert.equal(s.changeCompanies,1);});
test('관리자 접속은 고객사 수·고객 계정 수에 합산하지 않는다',()=>{const admin=dataset('adminAccess',[['2026-10-21 10:00:00','운영자','op','로그인','성공','192.0.2.1']]);const s=aggregate(createModel([customerAccess(),admin]));assert.equal(s.customerAccess.companies,1);assert.equal(s.customerAccess.users,1);assert.equal(s.adminAccess.successCount,1);});
test('로그아웃을 로그인 성공에 포함하지 않는다',()=>{const s=accessStats(customerAccess().rows);assert.equal(s.successCount,2);assert.equal(s.attempts,3);assert.equal(s.failureCount,1);});
test('서로 다른 날짜의 성공 로그인만 재방문으로 집계한다',()=>assert.equal(accessStats(customerAccess().rows).returning,1));
test('고객사 없는 로그인 실패를 특정 업체에 배정하지 않는다',()=>{const s=aggregate(createModel([customerAccess()]));assert.equal(s.customerAccess.unknownCompanyFailures,1);assert.equal(s.customers.length,1);});
test('같은 아이디도 고객사가 다르면 별도 계정이다',()=>{const second=[change[0],'두번째 고객사',...change.slice(2)];const s=aggregate(createModel([dataset('customerChanges',[change,second])]));assert.equal(s.changeUsers,2);});
test('고객 순위는 로그 수보다 작업일 수를 먼저 사용한다',()=>{const large=Array.from({length:9},()=>['2026-10-20 12:00:00','대량 회사',...change.slice(2)]);const s=aggregate(createModel([dataset('customerChanges',[...customerChanges().rows.map(row=>DEFINITIONS[0].required.map(h=>row.raw[h.replace(/\s/g,'').toLowerCase()])),...large])]));assert.equal(s.customers[0].company,'예시 고객사');});
test('운영자 소속은 직원 JSON으로만 연결하고 미확인을 보존한다',()=>{const s=aggregate(createModel([dataset('proxy',[proxy])],{'예시운영자':'서울본사'}));assert.equal(s.operators[0].branch,'서울본사');assert.equal(aggregate(createModel([dataset('proxy',[proxy])])).operators[0].branch,'미확인');});
test('빈 오류 상태를 미해결로 변경하지 않는다',()=>{const row=['2026-10-21 12:00:00','시스템','','대상','','','','','','내용','클래스'];const s=aggregate(createModel([dataset('errors',[row])]));assert.equal(s.emptyErrorStatus,1);assert.equal(s.period.errors[0].status,'');});
test('기간별 로그 파일의 시작일 차이를 보존한다',()=>{const m=createModel([customerChanges(),dataset('proxy',[['2026-09-22 10:00:00',...proxy.slice(1)]])]);assert.equal(m.start,'2026-09-22');assert.equal(m.sources.customerChanges.start,'2026-10-20');});
test('주간 추이는 최대 8개이며 마지막 주는 선택 종료일까지다',()=>{const m=createModel([dataset('customerChanges',[['2026-08-10 00:00:00',...change.slice(1)],change])]);const bins=weeklyTrend(aggregate(m));assert.equal(bins.length,8);assert.equal(bins.at(-1).end,'2026-10-20');});
test('짧은 기간은 존재하는 주차만 그린다',()=>assert.equal(weeklyTrend(aggregate(createModel([customerChanges()]))).length,1));
test('비밀키·토큰은 원문 표시에서도 제거한다',()=>{const value=redactSecrets('https://example.invalid/?key=private-key&x=1 Bearer token-secret password=secret');assert(!value.includes('private-key'));assert(!value.includes('token-secret'));assert(!value.includes('password=secret'));});
test('원본 민감값은 집계 때문에 변경하지 않는다',()=>{const input=[...change];const data=dataset('customerChanges',[input]);aggregate(createModel([data]));assert.equal(input[9],'B');assert.equal(data.rows[0].after,'B');});
test('기존 운영현황은 제목 이외 원본 소스를 보존한다',()=>{const old=fs.readFileSync(new URL('../docs/dashboard/legacy.html',import.meta.url),'utf8');assert(old.includes('async function parseXlsx'));assert(old.includes('function renderWeeklyReport'));assert(old.includes('async function initDashboard'));});
