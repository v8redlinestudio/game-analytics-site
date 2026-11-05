"use strict";
(function (root) {
  const PROPERTY = "560510698";
  const exact = (fieldName, value) => ({filter:{fieldName,stringFilter:{matchType:"EXACT",value}}});
  const mode = value => value === "test" ? "test" : "production";
  const all = (...filters) => ({andGroup:{expressions:filters.filter(Boolean)}});
  function audienceFilter(value) { return exact("customUser:collection_mode", mode(value)); }
  function specs(range, filter, value) {
    const event = (names, dimensions) => ({dateRanges:[range], dimensions:dimensions.map(name=>({name})),
      metrics:[{name:"eventCount"}], limit:"10000", dimensionFilter:all(filter,
        exact("customEvent:data_mode",mode(value)),{filter:{fieldName:"eventName",inListFilter:{values:names}}})});
    return [
      {id:"us-lessons",kind:"lessons",body:event(["lesson_transition"],["customEvent:lesson","customEvent:transition"])},
      {id:"us-battles",kind:"battles",body:event(["battle_summary"],["customEvent:stageId","customEvent:outcome","customEvent:assisted"])},
      {id:"us-circuits",kind:"milestones",body:event(["first_powered_circuit","first_effective_attack","first_stage_committed","onboarding_completed"],["eventName"])},
      {id:"us-skills",kind:"skills",body:event(["skill_first_ready","skill_first_activated"],["customEvent:skill","eventName"])},
    ];
  }
  function limited(data) {
    const m=data.metadata||{};
    return Boolean(m.subjectToThresholding || m.dataLossFromOtherRow || m.samplingMetadatas?.length ||
      Number(data.rowCount||0)>(data.rows||[]).length || (data.rows||[]).some(r=>(r.dimensionValues||[]).some(d=>d.value==="(other)")));
  }
  function decode(data, dimensions) {
    if (!Array.isArray(data.rows||[]) || (data.rows||[]).length>10000) throw Error("보고서 행 형식 확인 필요");
    return (data.rows||[]).map(row=>{
      const d=(row.dimensionValues||[]).map(v=>v.value), text=row.metricValues?.[0]?.value;
      if(d.length!==dimensions || d.some(v=>typeof v!=="string" || v.length>256) || !/^\d+$/.test(text||"") || !Number.isSafeInteger(Number(text)))
        throw Error("보고서 차원·건수 형식 확인 필요");
      return {d,n:Number(text)};
    });
  }
  function battles(data) {
    const groups=new Map();
    for(const {d:[stage, outcome, assisted],n} of decode(data,3)) {
      const key=JSON.stringify([stage,assisted]);
      if(!groups.has(key)) groups.set(key,{stage,assisted,won:0,lost:0,aborted:0,runtime_failure:0,unknown:0});
      const row=groups.get(key),field=["won","lost","aborted","runtime_failure"].includes(outcome)?outcome:"unknown";row[field]+=n;
      if(!Number.isSafeInteger(row[field]))throw Error("보고서 건수 범위 초과");
    }
    return [...groups.values()].map(r=>({...r,winRate:!limited(data)&&!r.unknown&&r.won+r.lost>0?r.won/(r.won+r.lost):null}));
  }
  const lessons={combat:"전투",deck:"편성",upgrade:"강화",resonance:"공명",gacha:"뽑기",skill:"스킬"};
  const transitions={started:"시작",completed:"완료",failed:"실패"};
  const events={first_powered_circuit:"첫 전력 회로",first_effective_attack:"첫 유효 공격",first_stage_committed:"첫 스테이지 확정",onboarding_completed:"전체 교습 완료",skill_first_ready:"최초 준비",skill_first_activated:"최초 사용"};
  const adNames={ad_offer_selected:"광고 선택",ad_load_started:"로드 시작",ad_load_result:"로드 결과",ad_show_started:"표시 시작",ad_show_failed:"표시 실패",ad_impression_observed:"노출 관측",ad_closed:"닫힘",ad_reward_qualified:"보상 적격",ad_reward_committed:"보상 지급 확정",ad_reward_failed:"보상 지급 실패"};
  function tableRows(kind,data) {
    if(kind==="battles") return battles(data).map(r=>[r.stage,r.assisted==="1"?"도움 사용":r.assisted==="0"?"도움 없음":"도움 미확인",r.won,r.lost,r.aborted,r.runtime_failure,r.unknown,r.winRate===null?"—":(r.winRate*100).toFixed(1)+"%"]);
    return decode(data,kind==="milestones"?1:2).map(({d,n})=>kind==="lessons"?[lessons[d[0]]||d[0],transitions[d[1]]||d[1],n]:kind==="skills"?[d[0],events[d[1]]||d[1],n]:[events[d[0]]||d[0],n]);
  }
  const counter=x=>Number.isSafeInteger(x)&&x>=0;
  const day=x=>typeof x==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&!Number.isNaN(Date.parse(x+"T00:00:00Z"))&&new Date(x+"T00:00:00Z").toISOString().startsWith(x);
  const label=x=>typeof x==="string"&&/^[A-Za-z0-9_.:-]{1,100}$/.test(x);
  function keys(object,allowed) { return object&&typeof object==="object"&&!Array.isArray(object)&&Object.keys(object).every(k=>allowed.includes(k)); }
  function parseImport(text,now=Date.now()) {
    if(typeof text!=="string"||new TextEncoder().encode(text).length>2*1024*1024) throw Error("집계 파일은 2MiB 이하만 허용합니다.");
    let d;try{d=JSON.parse(text);}catch{throw Error("집계 파일의 JSON 형식을 확인해 주세요.");}
    if(!d||typeof d!=="object"||Array.isArray(d))throw Error("집계 파일 형식 확인 필요");
    if(d.behavior===null&&d.commerce===null)throw Error("반입할 집계가 없습니다.");
    if(!keys(d,["schemaVersion","kind","gameId","projectId","mode","createdAtMs","expiresAtMs","timezone","behavior","commerce"])||d.schemaVersion!==1||d.kind!=="underspark_hub_summary"||d.gameId!=="underspark"||d.projectId!=="underspark-iap-validation"||!["production","test"].includes(d.mode)||d.timezone!=="Asia/Seoul"||!counter(d.createdAtMs)||!counter(d.expiresAtMs)||d.createdAtMs>now+300000||d.expiresAtMs<=now||d.expiresAtMs>d.createdAtMs+30*86400000) throw Error("지원되는 UnderSpark 집계 파일이 아니거나 보관 기한이 지났습니다.");
    for(const section of [d.behavior,d.commerce]) {
      if(section===null)continue;
      if(!keys(section,["source","exportedAtMs","sinceMs","throughMs","truncated","rows","revenue","excludedEvents","missingAmounts","recoveries"])||!["firestore_production_read_only","firestore_emulator","controlled_qa_fixture"].includes(section.source)||!counter(section.exportedAtMs)||section.exportedAtMs>now+300000||d.expiresAtMs>section.exportedAtMs+30*86400000||!counter(section.sinceMs)||!counter(section.throughMs)||section.throughMs>section.exportedAtMs+300000||section.sinceMs>section.throughMs||typeof section.truncated!=="boolean"||!Array.isArray(section.rows)||section.rows.length>5000) throw Error("유한 집계의 출처·범위·행 형식을 확인해 주세요.");
    }
    if(d.behavior) {
      const b=d.behavior;if(!Array.isArray(b.revenue)||b.revenue.length>5000)throw Error("광고 금액 집계 형식 오류");
      for(const r of b.rows)if(!keys(r,["day","event","placement","stageId","outcome","assisted","measure","bucket","count"])||!day(r.day)||!label(r.event)||!counter(r.count)||Object.entries(r).some(([k,v])=>["placement","stageId","outcome","assisted","measure"].includes(k)&&!label(v))||("bucket"in r&&!counter(r.bucket)))throw Error("행동 집계 행 형식 오류");
      for(const r of b.revenue)if(!keys(r,["day","placement","currency","micros"])||!day(r.day)||!label(r.placement)||!(/^[A-Z]{3}$/.test(r.currency))||!/^\d{1,36}$/.test(r.micros))throw Error("광고 수익 집계 형식 오류");
    }
    if(d.commerce) {
      const c=d.commerce;for(const k of ["excludedEvents","missingAmounts","recoveries"])if(!counter(c[k]))throw Error("결제 품질 집계 형식 오류");
      for(const r of c.rows)if(!keys(r,["day","platform","product","environment","currency","kind","amount_basis","orders","gross_observed","tax_observed","amount_authority"])||!day(r.day)||!label(r.platform)||!label(r.product)||r.environment!==(d.mode==="production"?"Production":"Sandbox")||!(/^[A-Z]{3}$/.test(r.currency))||!["purchase","refund_import"].includes(r.kind)||!label(r.amount_basis)||!counter(r.orders)||!/^\d{1,36}(\.\d{1,9})?$/.test(r.gross_observed)||!(r.tax_observed===null||/^\d{1,36}(\.\d{1,9})?$/.test(r.tax_observed))||!["store_verified","operator_import"].includes(r.amount_authority))throw Error("결제 집계 행 형식 오류");
    }
    return d;
  }
  function decimal(value,scale) { const v=BigInt(value), unit=10n**BigInt(scale);return String(v/unit)+(v%unit?"."+String(v%unit).padStart(scale,"0").replace(/0+$/,""):""); }
  function selectImport(data,value,range,now=Date.now()) {
    if(!data||data.expiresAtMs<=now||data.mode!==mode(value))return null;
    const midnight=Date.parse(new Date(now+9*3600000).toISOString().slice(0,10)+"T00:00:00Z");
    const resolve=value=>day(value)?value:value==="yesterday"?new Date(midnight-86400000).toISOString().slice(0,10):/^\d{1,3}daysAgo$/.test(value)?new Date(midnight-Number(value.slice(0,-7))*86400000).toISOString().slice(0,10):null;
    const start=resolve(range.startDate),end=resolve(range.endDate);if(!start||!end||start>end)throw Error("서버 집계 기간 형식 확인 필요");
    const within=r=>r.day>=start&&r.day<=end;
    return {behavior:data.behavior?{...data.behavior,rows:data.behavior.rows.filter(within),revenue:data.behavior.revenue.filter(within)}:null,
      commerce:data.commerce?{...data.commerce,rows:data.commerce.rows.filter(within)}:null};
  }
  function createController(host) {
    const doc=host.document,$=id=>doc.getElementById(id);let imported=null,serial=0,expiryTimer=null;
    const modeValue=()=>mode($("us-mode").value);
    function message(id,text) {$(id).replaceChildren();const p=doc.createElement("p");p.textContent=text;$(id).append(p);}
    function table(id,headers,rows) {
      if(!rows.length){message(id,"선택한 범위에 관측 자료가 없습니다. 미수신·처리 지연·필터 결과를 구분해 확인하세요.");return;}
      const wrap=doc.createElement("div");wrap.className="table-wrap";const table=doc.createElement("table"),head=doc.createElement("thead"),body=doc.createElement("tbody"),hr=doc.createElement("tr");
      for(const value of headers){const th=doc.createElement("th");th.textContent=value;hr.append(th);}head.append(hr);
      for(const row of rows){const tr=doc.createElement("tr");for(const value of row){const td=doc.createElement("td");td.textContent=String(value);tr.append(td);}body.append(tr);}
      table.append(head,body);wrap.append(table);$(id).replaceChildren(wrap);
    }
    const headers={lessons:["교습","진행 상태","이벤트 건수"],battles:["스테이지","도움","승리","패배","중단","실행 실패","미분류","승패 관측 승률"],milestones:["행동","이벤트 건수"],skills:["스킬","상태","이벤트 건수"]};
    function clearImport() {serial++;imported=null;clearTimeout(expiryTimer);expiryTimer=null;$("us-import").value="";renderImport();}
    function renderImport() {
      if(!host.active())return;
      let selected;try{selected=selectImport(imported,modeValue(),host.range());}catch{selected=null;}
      if(!selected){message("us-import-status",imported?"현재 환경과 파일 환경이 다르거나 기한이 지났습니다. 일치하는 집계 파일을 선택하세요.":"서버 집계 파일 미선택 · 자료는 브라우저 메모리에서만 처리하며 서버로 업로드하지 않습니다.");for(const id of ["us-ads","us-ad-money","us-finance","us-circuit-details"])message(id,"서버 집계 파일이 필요합니다.");$("us-behavior-range").textContent="";$("us-commerce-range").textContent="";return;}
      const synthetic=[imported.behavior,imported.commerce].filter(Boolean).some(s=>s.source!=="firestore_production_read_only");
      message("us-import-status",`${synthetic?"합성·에뮬레이터 자료 포함":imported.mode==="test"?"시험 자료":"운영 자료"} · 생성 ${new Date(imported.createdAtMs).toLocaleString("ko-KR")} · 기간 필터만 적용(KST). 국가·플랫폼·앱 버전 필터와 독립 · 전체 기간/제공자 대조 미확인. 30분 후 메모리에서 해제합니다.`);
      if(selected.behavior){const b=selected.behavior;message("us-behavior-range",`${b.source} · 원본 수신 범위 ${new Date(b.sinceMs).toISOString()} ~ ${new Date(b.throughMs).toISOString()} · ${b.truncated?"조회 잘림: 부분 관측":"유한 내보내기"} · 발생일은 기기 시계 기준이며 전체 노출/지급 보장 아님`);
        table("us-ads",["발생일(KST)","지면","단계","관측 건수"],b.rows.filter(r=>r.event in adNames&&!r.measure).map(r=>[r.day,r.placement||"미확인",adNames[r.event],r.count]));
        table("us-ad-money",["발생일(KST)","지면","통화","SDK 관측 수익"],b.revenue.map(r=>[r.day,r.placement,r.currency,decimal(r.micros,6)]));
        table("us-circuit-details",["발생일(KST)","스테이지","관측 값","구간/횟수","전투 표본 수"],b.rows.filter(r=>r.event==="battle_summary"&&["resonanceTier","dischargeUses","overclockUses"].includes(r.measure)).map(r=>[r.day,r.stageId||"미확인",{resonanceTier:"최대 공명 단계",dischargeUses:"방전 사용",overclockUses:"오버클럭 사용"}[r.measure],r.bucket,r.count]));
      }else{message("us-behavior-range","행동 집계 미포함");for(const id of ["us-ads","us-ad-money","us-circuit-details"])message(id,"행동 집계 미포함");}
      if(selected.commerce){const c=selected.commerce;message("us-commerce-range",`${c.source} · 원본 수신 범위 ${new Date(c.sinceMs).toISOString()} ~ ${new Date(c.throughMs).toISOString()} · ${c.truncated?"조회 잘림":"유한 관측"} · 파일 전체 회수 관측 ${c.recoveries} · 금액/일자 누락 ${c.missingAmounts} · 다른 환경 제외 ${c.excludedEvents} · 회수 재화는 현금 환불액이 아닙니다.`);
        table("us-finance",["발생일(KST)","종류","플랫폼","상품","통화","관측 건수","금액 기준","금액","세액","확정 원천"],c.rows.map(r=>[r.day,r.kind==="purchase"?"검증 결제":"환불 원본 반입",r.platform,r.product,r.currency,r.orders,r.amount_basis,r.gross_observed,r.tax_observed===null?"미확인":r.tax_observed,r.amount_authority==="store_verified"?"스토어 검증":"운영자 반입"]));
      }else{message("us-commerce-range","구매 집계 미포함");message("us-finance","구매 집계 미포함");}
    }
    async function load() {
      const version=host.version(),valid=()=>host.active()&&host.version()===version;const failures=[];
      renderImport();message("us-status","GA4 전용 보고서를 순차 조회하고 있습니다.");
      for(const spec of specs(host.range(),host.filter(),modeValue())){
        if(!valid())return failures;message(spec.id,"조회 중…");
        try{const data=await host.query(spec.body);if(!valid())return failures;const list=tableRows(spec.kind,data);table(spec.id,headers[spec.kind],list);if(limited(data)){failures.push(spec.kind);message("us-status","집계 제한·잘림이 있어 승률을 보류합니다. 관측 건수는 부분 자료일 수 있습니다.");}}
        catch(error){if(!valid())return failures;if(error.status===401)throw error;failures.push(spec.kind);message(spec.id,error.status===400?"조회 차원 연결 확인 필요: "+error.message:error.status===403?"GA4 조회 권한/API 설정 확인 필요":"조회 실패 · 기존 자료나 0으로 대체하지 않았습니다.");}
      }
      if(valid()&&!failures.length)message("us-status",`${modeValue()==="test"?"시험":"운영"} 이벤트 조회 완료 · 단순 이벤트 건수이며 순차 전환율/고유 이용자 수가 아닙니다.`);
      return failures.map(x=>"UnderSpark "+x);
    }
    $("us-mode").addEventListener("change",()=>{if(host.active())host.refresh();});
    $("us-clear-import").addEventListener("click",clearImport);
    $("us-import").addEventListener("change",async()=>{
      const file=$("us-import").files?.[0],version=host.version(),ticket=++serial;if(!file||!host.active())return;
      try{if(file.size>2*1024*1024)throw Error("집계 파일은 2MiB 이하만 허용합니다.");const text=await file.text();if(!host.active()||host.version()!==version||ticket!==serial)return;const data=parseImport(text);clearTimeout(expiryTimer);imported=data;expiryTimer=setTimeout(clearImport,Math.min(30*60*1000,data.expiresAtMs-Date.now()));renderImport();}
      catch(error){if(host.active()&&host.version()===version&&ticket===serial){imported=null;clearTimeout(expiryTimer);renderImport();message("us-import-status",error.message||"집계 파일 형식 확인 필요");}}
      finally{if(ticket===serial)$("us-import").value="";}
    });
    function clear() {
      serial++;imported=null;clearTimeout(expiryTimer);expiryTimer=null;$("us-import").value="";
      for(const id of ["us-status","us-lessons","us-battles","us-circuits","us-skills","us-import-status","us-ads","us-ad-money","us-finance","us-circuit-details"])message(id,"연결 후 해당 자료를 확인할 수 있습니다.");
      $("us-behavior-range").textContent="";$("us-commerce-range").textContent="";
    }
    function loading() {
      for(const id of ["us-status","us-lessons","us-battles","us-circuits","us-skills"])message(id,"현재 환경·기간의 조회를 준비하고 있습니다.");
      renderImport();
    }
    return {load,clear,loading,clearImport,renderImport,mode:modeValue};
  }
  const api={PROPERTY,audienceFilter,specs,limited,battles,tableRows,parseImport,selectImport,decimal,createController};
  if(typeof module!=="undefined"&&module.exports)module.exports=api;else root.UnderSparkAnalytics=Object.freeze(api);
})(typeof window!=="undefined"?window:globalThis);
