"use strict";
// Local aggregate imports only. Never persist reports, credentials or player identities.
(function(root){
  const GAME="unlimitbossrun",APP="4035836613391382",MAX=2*1024*1024;
  const aliases={date_start:["Reporting starts","보고 시작","보고 시작일"],date_stop:["Reporting ends","보고 종료","보고 종료일"],account_id:["Account ID","계정 ID"],account_currency:["Account currency","계정 통화","통화"],campaign_id:["Campaign ID","캠페인 ID"],adset_id:["Ad set ID","광고 세트 ID"],ad_id:["Ad ID","광고 ID"],campaign_name:["Campaign name","캠페인 이름"],ad_name:["Ad name","광고 이름"],attribution_setting:["Attribution setting","기여 설정","기여 설정값"],spend:["Amount spent","지출 금액"],impressions:["Impressions","노출","노출수"],link_clicks:["Link clicks","링크 클릭"],mobile_app_installs:["Mobile app installs","App installs","모바일 앱 설치","모바일 앱 설치 수","앱 설치"],purchase_value:["Mobile app purchases conversion value","모바일 앱 구매 전환값"]};
  function csv(text){
    if(typeof text!=="string"||(text.length>MAX||new TextEncoder().encode(text).length>MAX))throw Error("CSV는 최대 2MiB입니다.");
    text=text.replace(/^\uFEFF/,"");const out=[];let row=[],cell="",quoted=false,closed=false;
    for(let i=0;i<text.length;i++){const c=text[i];
      if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;}
      else if(c==='"'){if(cell||closed)throw Error("CSV 따옴표 위치를 확인하세요.");quoted=true;}
      else if(c===','||c==='\n'||c==='\r'){
        row.push(cell);cell="";closed=false;
        if(c!==','){if(c==='\r'&&text[i+1]==='\n')i++;if(row.some(v=>v.trim()))out.push(row);row=[];if(out.length>20001)throw Error("최대 20,000행입니다.");}
      }else{if(closed&&!/\s/.test(c))throw Error("CSV 구분자를 확인하세요.");if(!closed)cell+=c;}
    }
    if(quoted)throw Error("CSV 따옴표가 닫히지 않았습니다.");row.push(cell);if(row.some(v=>v.trim()))out.push(row);
    if(out.length<2||out.length>20001)throw Error("헤더와 광고별 자료가 필요합니다.");
    const headers=out.shift().map(v=>v.trim());if(new Set(headers).size!==headers.length)throw Error("중복된 CSV 열입니다.");
    return out.map(values=>{if(values.length!==headers.length)throw Error("CSV 열 수가 다릅니다.");return Object.fromEntries(headers.map((h,i)=>[h,values[i].trim()]));});
  }
  function numeric(value,money=false,negative=false){
    if(value===undefined||value===""||["-","—","--"].includes(value))return null;
    const pattern=money?/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,6})?$/:/^(?:\d+|\d{1,3}(?:,\d{3})+)$/;
    if(!pattern.test(value))throw Error("숫자는 쉼표 천 단위·소수점(.) 형식이어야 합니다.");
    const raw=value.replaceAll(",","");const minus=raw.startsWith("-");if(minus&&!negative)throw Error("음수 지출/건수는 허용하지 않습니다.");
    const [whole,fraction=""]=raw.replace(/^-/,'').split('.');let amount=BigInt(whole)*(money?1000000n:1n)+(money?BigInt(fraction.padEnd(6,"0")):0n);if(minus)amount=-amount;
    if(amount>BigInt(Number.MAX_SAFE_INTEGER)||amount<BigInt(Number.MIN_SAFE_INTEGER))throw Error("안전한 계산 범위를 넘었습니다.");return Number(amount);
  }
  function day(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value||"")||!Number.isFinite(Date.parse(value+"T00:00:00Z"))||new Date(value+"T00:00:00Z").toISOString().slice(0,10)!==value)throw Error("보고 일자는 YYYY-MM-DD 형식이어야 합니다.");return value;}
  function add(a,b){if(a===null||b===null)return null;const n=a+b;if(!Number.isSafeInteger(n))throw Error("집계 수치가 안전한 범위를 넘었습니다.");return n;}
  function parse(text,meta){
    if(!meta||meta.gameId!==GAME||meta.appId!==APP||meta.confirmed!==true)throw Error("또 보스냐 앱으로 필터한 보고서인지 확인하고 대상 앱 ID를 입력하세요.");
    try{new Intl.DateTimeFormat('en',{timeZone:meta.timeZone}).format();}catch{throw Error("광고 계정 시간대를 확인하세요.");}
    if(!meta.timeZone)throw Error("광고 계정 시간대를 입력하세요.");
    const coverageStart=day(meta.start),coverageEnd=day(meta.end);
    if(coverageStart>coverageEnd||(Date.parse(coverageEnd)-Date.parse(coverageStart))/86400000>365)throw Error("CSV 원본 조회 범위는 최대366일입니다.");
    const records=csv(text),headers=Object.keys(records[0]),map={};
    if(headers.some(h=>/token|secret|password|email|receipt|player.?id/i.test(h)))throw Error("비밀·개인정보 원본은 불러올 수 없습니다.");
    for(const [key,names]of Object.entries(aliases)){
      const found=headers.filter(h=>[key,...names].some(n=>n.toLowerCase().replace(/\s+/g,"")===h.replace(/\s*\([A-Z]{3}\)$/,"").toLowerCase().replace(/\s+/g,"")));
      if(found.length>1)throw Error("같은 의미의 열이 중복됐습니다: "+key);map[key]=found[0];
    }
    const headerCurrencies=new Set([map.spend,map.purchase_value].filter(Boolean).map(h=>h.match(/\(([A-Z]{3})\)$/)?.[1]).filter(Boolean));
    if(headerCurrencies.size>1)throw Error("서로 다른 통화의 열이 섞였습니다.");
    const headerCurrency=[...headerCurrencies][0];
    for(const key of ['date_start','date_stop','campaign_id','adset_id','ad_id','spend'])if(!map[key])throw Error("필수 열 누락: "+key);
    const result=[],groups=new Map();let currency=null,account=null,attribution=null;
    for(const record of records){
      const get=key=>map[key]?record[map[key]]:undefined;
      if(record.game_id&&record.game_id!==GAME||record.app_id&&record.app_id!==APP)throw Error("다른 게임/앱의 자료입니다.");
      const id=get('account_id')||meta.accountId,code=get('account_currency')||meta.currency||headerCurrency,window=get('attribution_setting')||meta.attribution;
      if(!/^\d{1,24}$/.test(id||'')||!/^[A-Z]{3}$/.test(code||'')||!window||window.length>120)throw Error("계정 ID·통화·기여 설정을 확인하세요.");
      if(headerCurrency&&headerCurrency!==code)throw Error("열의 통화와 계정 통화가 다릅니다.");
      if(meta.accountId&&meta.accountId!==id||meta.currency&&meta.currency!==code||meta.attribution&&meta.attribution!==window)throw Error("입력한 계정·통화·기여 설정과 CSV가 다릅니다.");
      if(currency&&currency!==code||account&&account!==id||attribution&&attribution!==window)throw Error("계정·통화·기여 설정이 다른 자료는 따로 불러오세요.");
      currency=code;account=id;attribution=window;
      const ids=['campaign_id','adset_id','ad_id'].map(get);if(ids.some(v=>!/^\d{1,24}$/.test(v||'')))throw Error("광고 단위 ID가 필요합니다. 합계/미확인 행을 제외하세요.");
      const start=day(get('date_start')),end=day(get('date_stop'));if(start>end)throw Error("보고 시작·종료 순서가 잘못됐습니다.");
      if(start<coverageStart||end>coverageEnd)throw Error("CSV 행이 입력한 원본 조회 기간을 벗어났습니다.");
      const spend=numeric(get('spend'),true);if(spend===null)throw Error("지출 미확인을 0으로 집계하지 않습니다.");
      const value={ids,start,end,spend,impressions:numeric(get('impressions')),clicks:numeric(get('link_clicks')),installs:numeric(get('mobile_app_installs')),revenue:numeric(get('purchase_value'),true,true),campaign:(get('campaign_name')||ids[0]).slice(0,200),name:(get('ad_name')||ids[2]).slice(0,200)};
      if(!groups.has(ids[2]))groups.set(ids[2],[]);groups.get(ids[2]).push(value);result.push(value);
    }
    for(const list of groups.values()){list.sort((a,b)=>a.start.localeCompare(b.start));for(let i=1;i<list.length;i++)if(list[i].start<=list[i-1].end)throw Error("같은 광고의 중복·겹치는 기간/세부 구분 행입니다. 광고별 원본 한 종류만 사용하세요.");}
    return {gameId:GAME,appId:APP,account,currency,attribution,timeZone:meta.timeZone,start:coverageStart,end:coverageEnd,rows:result};
  }
  function select(model,range,campaign=''){
    if(range.startDate<model.start||range.endDate>model.end)throw Error('선택 기간이 CSV 원본 조회 범위를 벗어났습니다. 같은 범위로 조회하거나 새 원본을 불러오세요.');
    const rows=model.rows.filter(r=>!campaign||r.ids[0]===campaign);
    if(rows.some(r=>r.start<=range.endDate&&r.end>=range.startDate&&(r.start<range.startDate||r.end>range.endDate)))throw Error("선택 기간 경계에 걸친 합계 행입니다. 일별 CSV 또는 같은 기간을 선택하세요.");
    const selected=rows.filter(r=>r.start>=range.startDate&&r.end<=range.endDate),groups=new Map();
    for(const r of selected){const key=JSON.stringify(r.ids);let g=groups.get(key);if(!g){g={...r,spend:0,impressions:0,clicks:0,installs:0,revenue:0};groups.set(key,g);}
      for(const k of ['spend','impressions','clicks','installs','revenue'])g[k]=add(g[k],r[k]);}
    const list=[...groups.values()],total={spend:0,impressions:0,clicks:0,installs:0,revenue:0};
    for(const r of list)for(const k of Object.keys(total))total[k]=add(total[k],r[k]);
    return {rows:list,total};
  }
  function metrics(v){return {spend:v.spend/1e6,cpi:v.installs>0?v.spend/1e6/v.installs:null,cpc:v.clicks>0?v.spend/1e6/v.clicks:null,cpm:v.impressions>0?v.spend/1e6/v.impressions*1000:null,ctr:v.impressions>0&&v.clicks!==null?v.clicks/v.impressions:null,roas:v.spend>0&&v.revenue!==null?v.revenue/v.spend:null};}
  function join(data){const result=new Map();if(!data||data.rowCount>(data.rows||[]).length||data.metadata?.subjectToThresholding||data.metadata?.samplingMetadatas?.length||data.metadata?.dataLossFromOtherRow)return result;
    for(const r of data.rows||[]){const d=(r.dimensionValues||[]).map(x=>x.value),n=Number(r.metricValues?.[0]?.value);if(d.length!==5||d.slice(1,4).some(v=>!/^\d+$/.test(v))||!Number.isSafeInteger(n)||n<0)continue;const key=JSON.stringify(d.slice(1,4));if(!result.has(key))result.set(key,{});const obj=result.get(key);obj[d[4]]=add(obj[d[4]]||0,n);}
    return result;
  }
  function createController(host){
    const doc=host.document,$=id=>doc.getElementById(id),num=new Intl.NumberFormat('ko-KR');let model=null,cohort=null,readVersion=0;
    const node=(tag,text)=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=String(text);return n;};
    const status=text=>{$('cost-status').textContent=text;};
    const money=(n,currency)=>{if(n===null)return '—';const f=v=>new Intl.NumberFormat('ko-KR',{style:'currency',currency,maximumFractionDigits:2}).format(v);return n!==0&&Math.abs(n)<0.01?(n<0?'−<':'<')+f(0.01):f(n);};
    function wipe(){for(const id of ['cost-spend','cost-installs','cost-cpi','cost-roas'])$(id).textContent='—';$('cost-table').replaceChildren();}
    function clear(){readVersion++;model=null;cohort=null;$('cost-file').value='';wipe();status('광고비 자료 미연결 · Meta 원본 CSV를 불러오면 계산합니다. GA4 보고값만으로 집행액을 추정하지 않습니다.');const option=node('option','전체 캠페인');option.value='';$('cost-campaign').replaceChildren(option);$('cost-campaign').value='';}
    function loading(){cohort=null;wipe();status(model?'조회 범위를 갱신하고 있습니다.':'광고비 자료 미연결 · Meta 보고서를 이 브라우저에서만 불러옵니다.');}
    function setCohort(data,context){cohort={data,context};}
    function render(){wipe();if(!host.active()||!model)return;if(!host.timeZone()){status('GA4 속성 시간대 수신 후 기간 대조가 가능합니다.');return;}
      try{const range=host.range(model.timeZone),chosen=select(model,range,$('cost-campaign').value);if(!chosen.rows.length){status('선택 기간·캠페인에 해당하는 광고비 자료가 없습니다. 집행액 0으로 바꾸지 않았습니다.');return;}
        const m=metrics(chosen.total);$('cost-spend').textContent=money(m.spend,model.currency);$('cost-installs').textContent=chosen.total.installs===null?'미확인':num.format(chosen.total.installs);$('cost-cpi').textContent=money(m.cpi,model.currency);$('cost-roas').textContent=m.roas===null?'귀속 매출 필요':(m.roas*100).toFixed(1)+'%';
        const context=cohort?.context;const compatible=cohort&&context.start===range.startDate&&context.end===range.endDate&&context.timeZone===model.timeZone&&!context.filtered;
        const lookup=compatible?join(cohort.data):new Map();
        status(`운영자 반입 · Meta 계정 ${model.account} · ${model.currency} · 광고 계정 시간대 ${model.timeZone} · ${range.startDate} ~ ${range.endDate} · 기여 설정: ${model.attribution} · 반입 ${new Date(model.receivedAt).toLocaleString("ko-KR")} · ${chosen.rows.length}개 광고 집계, 지출 상위 ${Math.min(200,chosen.rows.length)}개 표시. 수동 반입 자료. ${compatible?'GA4는 같은 ID의 별도 관측값이며 Meta 설치와 동일하지 않습니다.':'GA4 귀속 자료가 없거나 기간/시간대/필터가 달라 교차 지표는 보류합니다.'}`);
        for(const r of [...chosen.rows].sort((a,b)=>b.spend-a.spend).slice(0,200)){const a=metrics(r),g=lookup.get(JSON.stringify(r.ids))||{},tr=node('tr');
          for(const value of [r.campaign,r.ids[0],r.name,r.ids[2],money(a.spend,model.currency),r.impressions===null?'미확인':num.format(r.impressions),r.clicks===null?'미확인':num.format(r.clicks),r.installs===null?'미확인':num.format(r.installs),money(a.cpi,model.currency),a.ctr===null?'—':(a.ctr*100).toFixed(2)+'%',money(a.cpc,model.currency),money(a.cpm,model.currency),a.roas===null?'—':(a.roas*100).toFixed(1)+'%',g.first_open===undefined?'귀속 미확인':num.format(g.first_open),g.tutorial_finished===undefined?'미수신':num.format(g.tutorial_finished),g.boss_won===undefined?'미수신':num.format(g.boss_won)])tr.append(node('td',value));$('cost-table').append(tr);}
      }catch(error){status(error.message);}
    }
    $('cost-file').addEventListener('change',async()=>{const version=host.version(),read=++readVersion,file=$('cost-file').files?.[0];model=null;wipe();if(!file||!host.active())return;
      try{if(file.size>MAX)throw Error('파일은 최대2MiB입니다.');const text=await file.text();if(read!==readVersion||version!==host.version()||!host.active())return;
        model=parse(text,{gameId:GAME,appId:$('cost-app').value.trim(),confirmed:$('cost-confirm').checked,start:$('cost-start').value,end:$('cost-end').value,timeZone:$('cost-timezone').value.trim(),accountId:$('cost-account').value.trim(),currency:$('cost-currency').value.trim(),attribution:$('cost-attribution').value.trim()});
        model.receivedAt=Date.now();
        $('cost-campaign').replaceChildren();const option=node('option','전체 캠페인');option.value='';$('cost-campaign').append(option);
        for(const [id,name]of new Map(model.rows.map(r=>[r.ids[0],r.campaign]))){const opt=node('option',name+' · '+id);opt.value=id;$('cost-campaign').append(opt);}$('cost-campaign').value='';render();
      }catch(error){if(read===readVersion&&version===host.version()&&host.active()){model=null;status(error.message);}}});
    for(const id of ['cost-app','cost-confirm','cost-start','cost-end','cost-timezone','cost-account','cost-currency','cost-attribution'])$(id).addEventListener('change',()=>{readVersion++;model=null;$('cost-file').value='';wipe();status('원본 범위 설정이 바뀌었습니다. CSV를 다시 선택하세요.');});
    $('cost-clear').addEventListener('click',clear);$('cost-campaign').addEventListener('change',render);clear();return {clear,loading,render,setCohort};
  }
  const api={GAME,APP,csv,parse,select,metrics,join,createController};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.AcquisitionCost=Object.freeze(api);
})(typeof window!=='undefined'?window:globalThis);
