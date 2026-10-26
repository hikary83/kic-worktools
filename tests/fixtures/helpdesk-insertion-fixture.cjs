// 합성 시트·Jira·AI·Sheets batchUpdate만 사용합니다. 네트워크 접근은 없습니다.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..');
function formatDate(date,zone,pattern){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
  const values={yyyy:parts.year,yy:parts.year.slice(-2),MM:parts.month,dd:parts.day,HH:parts.hour,mm:parts.minute,ss:parts.second};
  return pattern.replace(/yyyy|yy|MM|dd|HH|mm|ss/g,key=>values[key]);
}
function record(seq,title='등록 '+seq,options={}){
  const date=options.date||'2026-10-23',row=Array(19).fill('');
  row[0]='IT-'+date.slice(2).replaceAll('-','')+'-'+String(seq).padStart(3,'0');row[1]='서울본사';
  row[2]=new Date(new Date(date+'T09:00:00+09:00').getTime()+(seq-1)*600000);row[3]=options.requester||'예시 직원';row[4]='CMS';row[5]='오류';row[6]='보통';row[8]=title;row[9]='기존 본문 보존';row[11]=options.status||'접수대기';row[13]='=원래수식()';row[14]='기존 비고';
  row[15]=options.source||'https://boards.office.hiworks.com/board/postview/3616/'+(10000+seq);row[16]=options.jira||'';row[18]=options.linked||'';
  return row;
}
function fixture(input=[record(3),record(2),record(1)]){
  const state={rows:structuredClone(input),notes:new Map(),props:new Map(),cache:new Map(),jiraIssues:[],jiraWarnings:[],jiraFailure:false,jiraCalls:[],batches:[],writeMode:'ok',sequence:0,locked:false,aiRows:[],onJira:null,now:Date.parse('2026-10-23T09:00:00+09:00')};
  class FixtureDate extends Date { constructor(...args){super(...(args.length?args:[state.now]));}static now(){return state.now;} }
  const props={getProperty:key=>state.props.get(key)??null,setProperty(key,value){state.props.set(key,String(value));return this;},deleteProperty(key){state.props.delete(key);return this;},getProperties:()=>Object.fromEntries(state.props),setProperties(values){Object.entries(values).forEach(([key,value])=>state.props.set(key,String(value)));return this;}};
  const sheet={getSheetId:()=>77,getMaxColumns:()=>19,getLastRow:()=>state.rows.length+2,getMaxRows:()=>state.rows.length+102,getParent:()=>({getId:()=> 'synthetic-sheet',getSpreadsheetTimeZone:()=>state.zone||'Asia/Seoul'}),
    getRange(row,col,height=1,width=1){return {getValues:()=>Array.from({length:height},(_,i)=>Array.from({length:width},(_,j)=>state.rows[row-3+i]?.[col-1+j]??'')),getValue:()=>state.rows[row-3]?.[col-1]??'',getNote:()=>state.notes.get(row+':'+col)||'',getNotes:()=>Array.from({length:height},(_,i)=>[state.notes.get((row+i)+':'+col)||'']),setValue(value){state.rows[row-3][col-1]=value;return this;},setValues(values){values.forEach((cells,i)=>cells.forEach((value,j)=>state.rows[row-3+i][col-1+j]=value));return this;},setNumberFormat(){return this;},createTextFinder(value){return{matchEntireCell(){return this;},findNext(){const index=state.rows.findIndex(r=>String(r[col-1])===String(value));return index<0?null:{getRow:()=>index+3};}};}};}
  };
  const context=vm.createContext({Date:FixtureDate,console:{log(){},warn(){}},PropertiesService:{getScriptProperties:()=>props},
    CacheService:{getScriptCache:()=>({get:key=>state.cache.get(key)||null,put:(key,value)=>state.cache.set(key,value),putAll:values=>Object.entries(values).forEach(([key,value])=>state.cache.set(key,value)),remove:key=>state.cache.delete(key)})},
    LockService:{getScriptLock:()=>({waitLock(){if(state.locked)throw Error('lock conflict');state.locked=true;},tryLock(){if(state.locked)return false;state.locked=true;return true;},releaseLock(){state.locked=false;}})},
    Utilities:{formatDate,getUuid:()=> '11111111-1111-4111-8111-'+String(++state.sequence).padStart(12,'0'),DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_,value)=>Array.from(crypto.createHash('sha256').update(value).digest())},
    ScriptApp:{getOAuthToken:()=> 'synthetic-only-token'},SpreadsheetApp:{flush(){}},
    ContentService:{MimeType:{TEXT:'text'},createTextOutput(text){return{value:text,setMimeType(){return this;}};}},
    UrlFetchApp:{fetch(url,options){
      if(url==='https://sheets.googleapis.com/v4/spreadsheets/synthetic-sheet?fields=spreadsheetId')return{getResponseCode:()=>state.storageStatus||200,getContentText:()=>JSON.stringify({spreadsheetId:'synthetic-sheet'})};
      if(!url.startsWith('https://sheets.googleapis.com/v4/spreadsheets/synthetic-sheet:batchUpdate'))throw Error('Unexpected external URL');
      const batch=JSON.parse(options.payload);state.batches.push(batch);
      if(state.writeMode==='before-timeout')throw Error('synthetic timeout before result');
      if(/^\d{3}$/.test(state.writeMode))return{getResponseCode:()=>Number(state.writeMode)};
      const rows=structuredClone(state.rows),notes=new Map(state.notes);
      for(const request of batch.requests){
        if(request.insertDimension){const index=request.insertDimension.range.startIndex;rows.splice(index-2,0,Array(19).fill(''));const saved=[...notes];notes.clear();saved.forEach(([key,value])=>{const [r,c]=key.split(':').map(Number);notes.set((r>=index+1?r+1:r)+':'+c,value);});}
        else if(request.updateCells){const update=request.updateCells;update.rows.forEach((row,i)=>row.values.forEach((cell,j)=>{const rowNumber=update.start.rowIndex+1+i,col=update.start.columnIndex+1+j,target=rows[rowNumber-3];if(!target)throw Error('bad update range');if(cell.userEnteredValue){const value=cell.userEnteredValue;target[col-1]=value.numberValue!==undefined?new Date(Math.round((value.numberValue-25569)*86400000)-(state.zone==='UTC'?0:32400000)):value.stringValue;}if(update.fields.includes('note')){if(cell.note)notes.set(rowNumber+':'+col,cell.note);else notes.delete(rowNumber+':'+col);}}));}
      }
      state.rows=rows;state.notes=notes;
      if(state.writeMode==='after-timeout')throw Error('synthetic timeout after atomic commit');
      return{getResponseCode:()=>200};
    }}
  });
  ['backend/Code.js','backend/JiraSync.js','backend/HelpdeskInsertion.js'].forEach(file=>vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context));
  context.getMainSheet=()=>sheet;context.ensureLinkColumns=()=>{};context.getQuarterRequestSheet=()=>null;context.getDevelopers=()=>[];
  context.getHelpdeskJiraSyncIssues_=data=>{state.jiraCalls.push(structuredClone(data));if(state.onJira)state.onJira();if(state.jiraFailure)throw Error('synthetic inaccessible Jira');return{issues:state.jiraIssues,warnings:state.jiraWarnings};};
  context.callGeminiJsonFastFromServer=(_contents,options)=>{if(!options&&state.captureFailure)throw Error('synthetic capture failure');return JSON.stringify(options?.maxOutputTokens===8192?{rows:state.aiRows}:state.captureData||{});};
  const call=(action,data={})=>JSON.parse(context.doPost({postData:{contents:JSON.stringify({action,data,requestId:'kic-11111111-1111-4111-8111-111111111111'})}}).value);
  const snapshot=()=>context.hdInsertSnapshot_(sheet,'2026-10-23');
  const preview=(afterId='IT-261023-001',extra={})=>context.previewHelpdeskInsertion({receiptDate:'2026-10-23',title:'중간 누락 원문',requester:'예시 새 직원',afterId,fingerprint:snapshot().fingerprint,originalConfirmed:true,...extra});
  const form=extra=>({receiptDate:'2026-10-23',branch:'서울본사',requester:'예시 새 직원',title:'중간 누락 원문',details:'새 본문',sourceLink:'https://boards.office.hiworks.com/board/postview/3616/55555',...extra});
  const insert=(token,extra={})=>context.insertHelpdeskIssue({token,renumberConfirmed:true,form:form(extra)});
  return{state,context,sheet,props,call,snapshot,preview,form,insert};
}
module.exports={fixture,record,formatDate};
