"use strict";
// All report data and the access token remain in memory. No game or user IDs are stored.
const Core = window.ForgeAnalytics;
const loadedSettings = Core.loadConfig(window.localStorage);
const reports = new Core.Reports();
const SCOPE = "openid email https://www.googleapis.com/auth/analytics.readonly";
const Attribution = window.UBRAttribution;
const AcquisitionCost = window.AcquisitionCost;
let acquisitionCostController = null;
const UnderSpark = window.UnderSparkAnalytics;
let underSparkController = null;
const number = new Intl.NumberFormat("ko-KR");
const $ = (id) => document.getElementById(id);
const state = {
  token: null,
  expiry: 0,
  generation: 0,
  controller: null,
  expiryTimer: null,
  quality: new Set(),
  insights: new Set(),
  reportTimeZone: null,
  config: loadedSettings.config,
  gameId: "all",
  authGeneration: 0,
  authController: null,
};
const funnelSteps = [
  ["첫 실행", "first_open"],
  ["게임 진입", "game_ready"],
  ["튜토리얼 시작", "tutorial_start"],
  ["보스 도전", "boss_started"],
  ["보스 처치", "boss_won"],
];
const forgeLineBehaviorEvents = [
  ["첫 실행", "first_open"],
  ["로비 진입 완료", "boot_complete"],
  ["튜토리얼 시작", "tutorial_start"],
  ["튜토리얼 단계 진행", "tutorial_step"],
  ["튜토리얼 완료", "tutorial_complete"],
  ["튜토리얼 건너뛰기", "tutorial_skip"],
  ["전투 시작 기록", "battle_start"],
  ["전투 종료", "battle_end"],
  ["패배 후 성장 안내 클릭", "growth_guide_click"],
  ["장비 비교", "choice_compare_view"],
  ["비교 후 장비 적용", "choice_compare_commit"],
  ["미션 조회", "mission_view"],
  ["미션 보상 수령 요청 결과", "mission_claim"],
  ["광고 시도", "ad_offer"],
  ["광고 결과", "ad_result"],
  ["결제 상품 상세 조회", "iap_detail_view"],
  ["구매 시도", "iap_attempt"],
  ["구매 결과", "iap_result"],
  ["구매 복구 결과", "iap_restore_result"],
];
const labels = {
  manual: "직접 중단",
  bag_full: "가방 가득 참",
  low_hp: "체력 부족",
  defeat: "전투 패배",
  save_error: "저장 오류",
  other: "기타",
  boss: "일반 보스",
  final: "최종 보스",
  equip: "장착",
  sell: "판매",
  keep: "보관",
  revive: "부활",
  gold: "골드",
  double_gold: "보스 골드 두 배",
  potion: "회복약",
  luck: "행운",
  str: "공격 강화",
  vit: "체력 강화",
  spd: "공격 속도 강화",
  bag: "가방 강화",
  buy_potion: "회복약 구매",
  drink_auto: "회복약 자동 사용",
  drink_manual: "회복약 직접 사용",
  meta_str: "유물 공격 강화",
  meta_vit: "유물 체력 강화",
  meta_gold: "유물 골드 강화",
  meta_luck: "유물 행운 강화",
  meta_potion: "유물 회복약 강화",
  meta_bag: "유물 가방 강화",
  meta_dust_aff: "유물 가루 강화",
};
function selectedGame() {
  return Core.GAMES.find(game => game.id === state.gameId);
}
function selectedProperty() {
  return state.config.bindings[state.gameId] || "";
}
function updateGameView() {
  const game = selectedGame();
  $("page-heading").textContent = game ? game.name + " · 플레이 리포트" : "전체 게임 현황";
  const ubr = game?.profile === "ubr" && Boolean(selectedProperty());
  const forgeLine = game?.id === "forgeline";
  const underspark = game?.profile === "underspark" && Boolean(selectedProperty());
  $("underspark-detail").hidden = !underspark;
  $("detail-summary").hidden = !game || !selectedProperty();
  $("game-detail").hidden = !ubr;
  $("forgeline-behavior").hidden = !(forgeLine && selectedProperty());
  $("retention-default-note").hidden = forgeLine;
  $("retention-forgeline-note").hidden = !forgeLine;
  $("acquisition-report").hidden = !(ubr || (forgeLine && selectedProperty()));
  $("acquisition-state").textContent = forgeLine
    ? "ForgeLine Android의 GA4 수동 UTM 유입입니다. 기간과 국가를 적용합니다. Meta에서 실제 광고 클릭 후 설치가 귀속되는지는 검증 대기 중입니다."
    : "Meta 앱 등록·광고 계정 연결은 완료했으며, 앱 이벤트 수신과 실제 광고 클릭 후 설치 귀속은 아직 검증 전입니다. 아래 표는 추적 매개변수로 Google Analytics에 확인된 메타 유료 유입만 표시합니다.";
  $("acquisition-start").textContent = forgeLine ? "전투 진입" : "보스 도전";
  $("acquisition-finish").textContent = forgeLine ? "전투 종료" : "보스 처치";
  $("acquisition-ad-result").textContent = forgeLine ? "광고 결과 기록" : "광고 보상 획득";
  $("paid-acquisition").hidden = !ubr;
  $("common-detail").hidden = !game || !selectedProperty();
  $("portfolio").hidden = Boolean(game);
  $("portfolio-summary").hidden = Boolean(game);
  $("nav-portfolio").classList.toggle("selected", !game);
  $("nav-detail").classList.toggle("selected", Boolean(game));
  for (const node of document.querySelectorAll("[data-acquisition]")) node.hidden = !(ubr || (forgeLine && selectedProperty()));
  for (const id of ["boss-attempts", "rewards-earned"]) $(id).closest("article").hidden = !ubr;
  $("selected-note").textContent = !game ? "게임을 선택하면 상세 분석이 열립니다." :
    !selectedProperty() ? game.name + "의 GA4 속성을 연결해 주세요." : ubr ?
    "또 보스냐의 기존 이벤트 계약으로 보스·광고·성장·유입을 분석합니다." : underspark ?
    "UnderSpark 교습·전투는 GA4, 광고 지급·금액은 서버 집계 파일로 원천을 구분합니다. 기본값은 테스트 제외입니다." : forgeLine ?
    "ForgeLine의 사용자 추이, 주요 행동, Android Meta 유입과 태국 재방문을 조회합니다." :
    game.name + "의 기본 사용자 지표입니다. 게임 전용 이벤트 매핑은 후속 연결이 필요합니다.";
}
function selectGame(id) {
  if (id !== state.gameId) acquisitionCostController?.clear();
  if (id !== state.gameId) underSparkController?.clear();
  state.gameId = id;
  $("game-select").value = id;
  for (const field of ["acquisition", "campaign", "ad"]) $(field).value = "";
  for (const field of ["link-campaign", "link-adset", "link-ad", "play-link"]) $(field).value = "";
  $("link-message").textContent = "";
  options("campaign", [], "전체 캠페인");
  options("ad", [], "전체 광고");
  updateGameView();
  if (state.token) return refresh();
}
function openSettings(gameId = state.gameId) {
  $("settings-game").value = Core.GAMES.some(game => game.id === gameId) ? gameId : "unlimitbossrun";
  $("client-id").value = state.config.clientId;
  $("property-id").value = state.config.bindings[$("settings-game").value];
  $("settings-error").textContent = "";
  $("settings").showModal();
}
function notify(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("visible");
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => t.classList.remove("visible"), 6500);
}
function elem(tag, text, cls) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = String(text);
  if (cls) n.className = cls;
  return n;
}
function setStatus(text, on = false) {
  $("status-text").textContent = text;
  $("status-dot").classList.toggle("on", on);
}
function clearNode(node) {
  node.replaceChildren();
}
function message(id, msg, error = false) {
  const node = $(id);
  node.className = "placeholder";
  clearNode(node);
  node.append(elem("span", error ? "!" : "—"), elem("p", msg));
}
function errorText(error) {
  if (error.code === "TIMEZONE_UNKNOWN") return error.message;
  if (error.status === 401) return "인증이 만료되었습니다. 다시 연결해 주세요.";
  if (error.status === 403)
    return "API 사용 설정 또는 이 계정의 Analytics 접근 권한을 확인해 주세요.";
  if (error.status === 400) return `조회 설정 확인 필요: ${error.message}`;
  if (error.status === 429)
    return "요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.";
  return "이 항목을 불러오지 못했습니다. API 설정과 맞춤 측정항목을 확인해 주세요.";
}
function setLoading() {
  $("trend-table").replaceChildren();
  for (const id of ["active-change","new-change","ad-change","purchase-change"]) $(id).textContent = "확인 중";
  for (const id of ["ad-revenue","purchase-revenue","total-active","total-new","connected-count"]) $(id).textContent = "—";
  for (const id of [
    "active-users",
    "new-users",
    "boss-attempts",
    "rewards-earned",
  ])
    $(id).textContent = "—";
  for (const id of [
    "funnel",
    "forgeline-behavior-list",
    "ads-list",
    "retention",
    "trend",
    "stops",
    "loot",
    "ad-types",
    "economy",
  ])
    message(id, "데이터를 불러오는 중입니다.");
  const table = $("boss-table");
  clearNode(table);
  const tr = elem("tr"),
    td = elem("td", "데이터를 불러오는 중입니다.", "empty");
  td.colSpan = 6;
  tr.append(td);
  table.append(tr);
  acquisitionMessage("데이터를 불러오는 중입니다.");
}
function commonFilter() {
  return combine(
    $("platform").value ? {filter:{fieldName:"platform",stringFilter:{matchType:"EXACT",value:$("platform").value}}} : undefined,
    $("app-version").value.trim() ? {filter:{fieldName:"appVersion",stringFilter:{matchType:"EXACT",value:$("app-version").value.trim()}}} : undefined);
}
function reportFilter(includeUnderSparkMode = true) {
  return combine(commonFilter(), includeUnderSparkMode && selectedGame()?.profile === "underspark" ? UnderSpark.audienceFilter(underSparkController?.mode()) : undefined, Attribution.audienceFilter({
    country: $("country").value,
    meta: $("acquisition").value === "meta",
    campaign: $("campaign").value,
    ad: $("ad").value,
  }));
}
function eventFilter(names) {
  return {
    filter: { fieldName: "eventName", inListFilter: { values: names } },
  };
}
function combine(...filters) {
  const valid = filters.filter(Boolean);
  return valid.length === 1
    ? valid[0]
    : valid.length
      ? { andGroup: { expressions: valid } }
      : undefined;
}
function selectedRanges() { return Core.ranges($("period").value, $("start-date").value, $("end-date").value); }
function reportRange() { const {startDate,endDate} = selectedRanges().current; return {startDate,endDate}; }
function summaryBody(filter) {
  const range = selectedRanges(), body = requestBody([], Core.SUMMARY_METRICS, filter);
  body.dateRanges = [range.current, range.previous];
  return body;
}
function money(value, currency) {
  if (value === null) return "—";
  if (!/^[A-Z]{3}$/.test(currency)) return number.format(value) + " · 통화 미확인";
  return new Intl.NumberFormat("ko-KR", {style:"currency",currency}).format(value);
}
function showInsights() {
  const list = $("insight-list"); list.replaceChildren();
  if (!state.insights.size) list.append(elem("li", "현재 조회 범위에서 감지된 계측 이상은 없습니다. 수집·원장 정합성 검증을 대신하지 않습니다."));
  for (const text of state.insights) list.append(elem("li", text));
}
function metricCell(cell, current, previous, limited) {
  cell.textContent = current === null ? "—" : number.format(current);
  cell.append(elem("small", Core.change(current, previous, limited), "metric-change"));
}
function requestBody(dimensions, metrics, filters) {
  const body = {
    dateRanges: [reportRange()],
    dimensions: dimensions.map((name) => ({ name })),
    metrics: metrics.map((name) => ({ name })),
    limit: "10000",
  };
  if (filters) body.dimensionFilter = filters;
  return body;
}
async function api(method, body, version = "v1beta") {
  const generation = state.generation;
  const data = await reports.request(selectedProperty(), method, body, version, state.controller?.signal);
  if (generation !== state.generation || !state.token) throw new DOMException("조회가 취소되었습니다.", "AbortError");
  for (const warning of Core.quality(data)) state.quality.add(warning);
  return data;
}
function rows(data) {
  return (data.rows || []).map((row) => ({
    d: (row.dimensionValues || []).map((v) => v.value),
    m: (row.metricValues || []).map((v) => Number(v.value)),
  }));
}
function pct(n, d) {
  return d > 0 ? `${((n * 100) / d).toFixed(1)}%` : "—";
}
function renderBars(id, items) {
  if (!items.length) {
    message(id, "선택한 기간에 데이터가 없습니다.");
    return;
  }
  const node = $(id);
  node.className = "bars";
  clearNode(node);
  const max = Math.max(...items.map((i) => i.value), 1);
  for (const item of items) {
    const row = elem("div", undefined, "bar-row"),
      track = elem("div", undefined, "track"),
      fill = elem("div", undefined, "fill");
    fill.style.width = `${Math.max(0, Math.min(100, (item.value / max) * 100))}%`;
    track.append(fill);
    row.append(
      elem("span", item.label),
      track,
      elem("b", item.display ?? number.format(item.value)),
    );
    node.append(row);
  }
}
function renderList(id, items, kind = "ad-row") {
  if (!items.length) {
    message(id, "선택한 기간에 데이터가 없습니다.");
    return;
  }
  const node = $(id);
  node.className = "list-body";
  clearNode(node);
  for (const item of items) {
    const row = elem("div", undefined, kind);
    row.append(
      elem("span", item.label),
      elem("b", item.display ?? number.format(item.value)),
    );
    node.append(row);
  }
}
function showTableMessage(text) {
  const table = $("boss-table");
  clearNode(table);
  const row = elem("tr"),
    cell = elem("td", text, "empty");
  cell.colSpan = 6;
  row.append(cell);
  table.append(row);
}
function acquisitionMessage(text) {
  const table = $("acquisition-table");
  clearNode(table);
  const row = elem("tr"), cell = elem("td", text, "empty");
  cell.colSpan = 10;
  row.append(cell);
  table.append(row);
}
function options(id, values, label) {
  const selected = $(id).value;
  clearNode($(id));
  const all = elem("option", label);
  all.value = "";
  $(id).append(all);
  const choices = new Set(values);
  if (selected) choices.add(selected);
  for (const value of [...choices].sort()) {
    const option = elem("option", value === "(not set)" ? "미확인 ID" : value);
    option.value = value;
    $(id).append(option);
  }
  $(id).value = selected;
}
function requireTimeZone() {
  if (!state.reportTimeZone) { const error = new Error("속성 시간대 수신 후 코호트를 조회할 수 있습니다."); error.code = "TIMEZONE_UNKNOWN"; throw error; }
}
async function loadAcquisition() {
  requireTimeZone();
  const generation = state.generation;
  const forgeLine = selectedGame()?.id === "forgeline";
  const events = forgeLine ? Attribution.FORGELINE_EVENTS : Attribution.EVENTS;
  const body = Attribution.acquisitionBody({
    period: $("period").value, dateRange: reportRange(), country: $("country").value, timeZone: state.reportTimeZone, events,
  });
  const android = {filter:{fieldName:"platform",stringFilter:{matchType:"EXACT",value:"Android"}}};
  body.dimensionFilter = combine(body.dimensionFilter, forgeLine ? android : commonFilter());
  const data = await api("runReport", body);
  if (generation !== state.generation || !state.token) return;
  if (acquisitionCostController && !forgeLine) {
    const r=reportRange(),resolve=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)?v:Attribution.dateDaysAgo(v==="yesterday"?1:v==="today"?0:Number(v.replace("daysAgo","")),state.reportTimeZone);
    acquisitionCostController.setCohort(data,{start:resolve(r.startDate),end:resolve(r.endDate),timeZone:state.reportTimeZone,filtered:Boolean($("country").value||$("platform").value||$("app-version").value.trim()||$("campaign").value||$("ad").value)});
  }
  const all = Attribution.aggregate(data, events);
  options("campaign", all.map(row => row.ids[1]), "전체 캠페인");
  options("ad", all.filter(row => !$("campaign").value || row.ids[1] === $("campaign").value).map(row => row.ids[3]), "전체 광고");
  const selected = all.filter(row => (!$("campaign").value || row.ids[1] === $("campaign").value) && (!$("ad").value || row.ids[3] === $("ad").value));
  if (!selected.length) {
    acquisitionMessage("선택한 기간에 확인된 메타 광고 유입이 없습니다. 연결 전·귀속 미확인·실제 유입 없음은 이 화면만으로 구분할 수 없습니다.");
    return;
  }
  clearNode($("acquisition-table"));
  for (const item of selected) {
    const tr = elem("tr");
    for (const value of [...item.ids.map(id => !id || id === "(not set)" ? "미확인" : id), ...events.map(event => number.format(item.counts[event]))]) {
      tr.append(elem("td", value));
    }
    $("acquisition-table").append(tr);
  }
}
async function loadSummary() {
  const data = await api("runReport", summaryBody(reportFilter()));
  const summary = Core.summary(data);
  state.reportTimeZone = data.metadata?.timeZone || null;
  for (const [id, metric, changeId] of [["active-users","activeUsers","active-change"],["new-users","newUsers","new-change"],["ad-revenue","totalAdRevenue","ad-change"],["purchase-revenue","purchaseRevenue","purchase-change"]]) {
    const current = summary.current[metric];
    $(id).textContent = metric.endsWith("Revenue") ? money(current, summary.currency) : current === null ? "—" : number.format(current);
    $(changeId).textContent = Core.change(current, summary.previous[metric], summary.limited);
  }
  $("range-note").textContent += " · 속성 시간대 " + summary.timeZone;
  if (summary.current.activeUsers === null) state.insights.add("선택한 게임의 보고서 데이터가 없습니다. 미수신·처리 지연·필터 결과를 확인하세요.");
}
async function loadEvents() {
  const names = [
    "boss_started",
    "reward_requested",
    "reward_shown",
    "reward_earned",
    "reward_saved",
    "reward_failed",
  ];
  const d = await api(
    "runReport",
    requestBody(
      ["eventName"],
      ["eventCount"],
      combine(reportFilter(), eventFilter(names)),
    ),
  );
  const r = rows(d),
    counts = Object.fromEntries(r.map((x) => [x.d[0], x.m[0]]));
  $("boss-attempts").textContent = r.length
    ? counts.boss_started === undefined ? "미수신" : number.format(counts.boss_started)
    : "—";
  $("rewards-earned").textContent = r.length
    ? counts.reward_earned === undefined ? "미수신" : number.format(counts.reward_earned)
    : "—";
  for (const warning of Core.adWarnings(counts)) state.insights.add(warning);
  renderList(
    "ads-list",
    r.length
      ? [
          ["요청", "reward_requested"],
          ["표시", "reward_shown"],
          ["보상 획득", "reward_earned"],
          ["보상 저장 결과", "reward_saved"],
          ["실패", "reward_failed"],
        ].map(([label, key]) => ({ label, display: counts[key] === undefined ? "미수신" : number.format(counts[key]) }))
      : [],
  );
}
async function loadFunnel() {
  const body = {
    dateRanges: [reportRange()],
    funnel: {
      isOpenFunnel: false,
      steps: funnelSteps.map(([name, eventName]) => ({
        name,
        filterExpression: { funnelEventFilter: { eventName } },
      })),
    },
  };
  const country = reportFilter();
  if (country) body.dimensionFilter = country;
  const data = await api("runFunnelReport", body, "v1alpha");
  const r = rows(data.funnelVisualization || {});
  if (!r.length) { message("funnel", "선택한 기간에 퍼널 데이터가 없습니다."); return; }
  const first = r[0]?.m[0] || 0;
  renderBars("funnel", r.map(x => ({ label: x.d[0].replace(/^\d+\.\s*/, ""), value: x.m[0], display: `${number.format(x.m[0])}명 · ${pct(x.m[0], first)}` })));
  if (r.length < funnelSteps.length) {
    $("funnel").append(elem("p", "일부 단계가 응답에 없습니다. 0명으로 단정하지 않고 수신·집계 상태를 확인하세요.", "panel-note"));
    state.insights.add("퍼널 일부 단계가 응답에 없습니다. 실제 미도달과 계측 누락을 구분해 확인하세요.");
  }
}
async function loadBehaviorEvents(id, events) {
  const data = await api("runReport", requestBody(
    ["eventName"], ["totalUsers", "eventCount"],
    combine(reportFilter(), eventFilter(events.map(([, event]) => event))),
  ));
  const observed = new Map(rows(data).map(({ d, m }) => [d[0], m]));
  const limited = Core.quality(data).length > 0;
  renderList(id, observed.size ? events.map(([label, event]) => {
    const counts = observed.get(event);
    const display = counts?.length === 2 && counts.every(Number.isFinite)
      ? `${number.format(counts[0])}명 · ${number.format(counts[1])}회`
      : limited ? "집계 제한" : "보고된 행 없음";
    return { label, display };
  }) : []);
  if (!observed.size && limited) message(id, "집계 제한으로 표시할 수 있는 행이 없습니다.");
}
async function loadBoss() {
  const d = await api(
    "runReport",
    requestBody(
      ["customEvent:area", "customEvent:cycle", "customEvent:event_context"],
      ["eventCount", "customEvent:amount"],
      combine(reportFilter(), eventFilter(["boss_result"])),
    ),
  );
  const r = rows(d);
  if (!r.length) {
    showTableMessage("선택한 기간에 저장된 보스 결과가 없습니다.");
    return;
  }
  const table = $("boss-table");
  clearNode(table);
  for (const x of r) {
    const [area, cycle, kind] = x.d,
      [count, wins] = x.m;
    const row = elem("tr");
    for (const value of [
      Number.isFinite(Number(area)) ? String(Number(area) + 1) : area,
      cycle,
      labels[kind] || kind,
      number.format(count),
      number.format(wins),
      pct(wins, count),
    ])
      row.append(elem("td", value));
    table.append(row);
  }
}
async function loadStops() {
  const d = await api(
    "runReport",
    requestBody(
      ["customEvent:event_context"],
      ["eventCount"],
      combine(reportFilter(), eventFilter(["auto_stopped"])),
    ),
  );
  renderBars(
    "stops",
    rows(d).map((x) => ({ label: labels[x.d[0]] || x.d[0], value: x.m[0] })),
  );
}
async function loadCategorized(id, eventName) {
  const d = await api(
    "runReport",
    requestBody(
      ["customEvent:event_context"],
      ["eventCount"],
      combine(reportFilter(), eventFilter([eventName])),
    ),
  );
  renderBars(
    id,
    rows(d).map((x) => ({ label: labels[x.d[0]] || x.d[0], value: x.m[0] })),
  );
}
async function loadTrend() {
  const body = requestBody(["date"], ["activeUsers"], reportFilter());
  body.orderBys = [{ dimension: { dimensionName: "date" } }];
  const data = await api("runReport", body), r = rows(data), table = $("trend-table");
  table.replaceChildren();
  if (!r.length) { message("trend", "선택한 기간에 데이터가 없습니다."); return; }
  const node = $("trend"); node.className = "daily-bars"; node.replaceChildren();
  const max = Math.max(...r.map(x => x.m[0]), 1);
  for (const x of r) {
    const date = x.d[0].replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
    const bar = elem("div", undefined, "daily-column"), track = elem("div", undefined, "daily-track"), fill = elem("div", undefined, "daily-fill");
    fill.style.height = `${Math.max(1, x.m[0] / max * 100)}%`; track.append(fill);
    bar.append(elem("b", number.format(x.m[0])), track, elem("span", date.slice(5))); node.append(bar);
    const tr = elem("tr"); tr.append(elem("td", date), elem("td", number.format(x.m[0]))); table.append(tr);
  }
}

function propertyDateDaysAgo(days, now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: state.reportTimeZone,
      year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(now).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]),
  );
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) - days)).toISOString().slice(0, 10);
}
async function loadRetention() {
  if (selectedGame()?.profile === "underspark") {
    message("retention", "환경을 분리한 성숙 코호트 대조는 별도 검증 대상입니다. 전체 환경의 기존 재방문 수치로 대체하지 않습니다.");
    return;
  }
  requireTimeZone();
  if (selectedGame()?.id === "forgeline") {
    const query = Attribution.forgeLineCohorts({
      dateRange: reportRange(), timeZone: state.reportTimeZone, campaign: $("campaign").value, ad: $("ad").value,
    });
    if (!query.dates.length) {
      message("retention", "선택 기간에 D1 관측이 끝난 태국 코호트가 없습니다.");
      return;
    }
    const items = [];
    for (const segment of query.segments) {
      const report = await api("runReport", segment.request);
      for (const row of Attribution.matureRetention(report, query.dates, query.today)) {
        items.push({ label: `태국 ${segment.label} · D${row.day}`, display: row.unavailable ? "집계 제한" :
          row.total ? `${pct(row.returned, row.total)} (${number.format(row.returned)}/${number.format(row.total)})` : "관측 표본 없음" });
      }
    }
    items.push({ label: "집계 범위", display: "분석 동의 사용자 · 성숙 코호트 · 최대 최근 28일" });
    renderList("retention", items, "retention-row");
    return;
  }
  const body = {
    dimensions: [{ name: "cohort" }, { name: "cohortNthDay" }],
    metrics: [{ name: "cohortActiveUsers" }, { name: "cohortTotalUsers" }],
    cohortSpec: {
      cohorts: [
        {
          name: "최근 신규 사용자",
          dimension: "firstSessionDate",
          dateRange: { startDate: propertyDateDaysAgo(35), endDate: propertyDateDaysAgo(8) },
        },
      ],
      cohortsRange: { endOffset: 7, granularity: "DAILY" },
    },
  };
  const d = await api("runReport", body);
  const r = rows(d);
  if (!r.length) {
    message("retention", "아직 코호트 데이터가 없습니다.");
    return;
  }
  const items = [1, 7].map((day) => {
    const v = r.find((x) => Number(x.d[1]) === day);
    return {
      label: `${day}일 후 재방문`,
      display: v ? pct(v.m[0], v.m[1]) : "—",
    };
  });
  renderList("retention", items, "retention-row");
}
async function loadPortfolio(generation) {
  const table = $("portfolio-body"); table.replaceChildren();
  let connected = 0, failed = 0, activeTotal = 0, newTotal = 0, activeMeasured = 0, newMeasured = 0;
  for (const game of Core.GAMES) {
    const row = elem("tr"); row.dataset.game = game.id;
    for (const text of [game.name,state.config.bindings[game.id] ? "조회 대기" : "연결 필요","—","—","—","—","—","—"]) row.append(elem("td",text));
    const action = elem("td"), button = elem("button", state.config.bindings[game.id] ? "상세 보기" : "연결", "text-btn");
    button.addEventListener("click", () => state.config.bindings[game.id] ? selectGame(game.id) : openSettings(game.id)); action.append(button); row.append(action); table.append(row);
  }
  for (const game of Core.GAMES) {
    const propertyId = state.config.bindings[game.id]; if (!propertyId) continue;
    if (generation !== state.generation) return;
    const row = [...table.children].find(n => n.dataset.game === game.id); row.children[1].textContent = "불러오는 중…";
    try {
      const filter = combine(commonFilter(), game.profile === "underspark" ? UnderSpark.audienceFilter("production") : undefined, Attribution.audienceFilter({country:$("country").value}));
      const data = await reports.request(propertyId,"runReport",summaryBody(filter),"v1beta",state.controller.signal);
      if (generation !== state.generation) return;
      const report = Core.summary(data), current = report.current;
      for (const warning of Core.quality(data)) state.quality.add(game.name + ": " + warning);
      row.children[1].textContent = report.limited ? "집계 제한" : current.activeUsers !== null ? "정상" : "데이터 없음";
      metricCell(row.children[2],current.activeUsers,report.previous.activeUsers,report.limited);
      metricCell(row.children[3],current.newUsers,report.previous.newUsers,report.limited);
      row.children[4].textContent = money(current.totalAdRevenue,report.currency);
      row.children[5].textContent = money(current.purchaseRevenue,report.currency);
      row.children[6].textContent = report.timeZone; row.children[7].textContent = new Date().toLocaleTimeString("ko-KR"); connected++;
      if (current.activeUsers !== null) { activeTotal += current.activeUsers; activeMeasured++; }
      if (current.newUsers !== null) { newTotal += current.newUsers; newMeasured++; }
      if (report.limited) state.insights.add(game.name + ": 집계/권한 제한이 있습니다. 비교 시 유의하세요.");
    } catch(error) {
      if (generation !== state.generation) return;
      if (error.status === 401) throw error;
      failed++; row.children[1].textContent = error.status === 403 ? "권한 없음" : error.status === 429 ? "조회 한도 도달" : "조회 실패";
      row.children[7].textContent = errorText(error); state.insights.add(game.name + ": " + errorText(error));
    }
  }
  const missing = Core.GAMES.filter(g => !state.config.bindings[g.id]).length;
  if (missing) state.insights.add(`${missing}개 게임은 아직 속성이 연결되지 않았습니다. 아래 연결 버튼에서 관리하세요.`);
  $("portfolio-count").textContent = `${connected}개 조회 / ${Core.GAMES.length}개 게임`;
  $("connected-count").textContent = `${connected} / ${Core.GAMES.length}`;
  $("total-active").textContent = activeMeasured ? number.format(activeTotal) : "—";
  $("total-new").textContent = newMeasured ? number.format(newTotal) : "—";
  return failed;
}

async function refresh() {
  if (!state.token || Date.now() >= state.expiry) {
    disconnect();
    notify("Google 연결이 만료되었습니다. 다시 연결해 주세요.");
    return;
  }
  let range;
  acquisitionCostController?.loading();
  try { range = selectedRanges(); } catch(error) {
    if (selectedGame()?.profile === "underspark") underSparkController?.loading();
    state.controller?.abort(); state.generation++; state.insights.clear(); state.insights.add(error.message); showInsights();
    for (const id of ["active-users","new-users","ad-revenue","purchase-revenue","boss-attempts","rewards-earned","total-active","total-new","connected-count"]) $(id).textContent = "—";
    for (const id of ["active-change","new-change","ad-change","purchase-change"]) $(id).textContent = "기간 입력 확인";
    for (const id of ["trend","retention","funnel","forgeline-behavior-list","ads-list","stops","loot","ad-types","economy"]) message(id,error.message);
    $("trend-table").replaceChildren(); $("portfolio-body").replaceChildren(); $("portfolio-count").textContent = "기간 입력 확인";
    showTableMessage(error.message); acquisitionMessage(error.message);
    $("range-note").textContent = "조회하지 않았습니다 · " + error.message;
    $("status-dot").classList.remove("loading"); $("private-content").setAttribute("aria-busy","false"); $("refresh-btn").disabled = false;
    setStatus("기간 입력 확인"); return;
  }
  state.controller?.abort();
  state.controller = new AbortController();
  const generation = ++state.generation;
  if (selectedGame()?.profile === "underspark") underSparkController?.loading();
  state.quality.clear(); state.insights.clear(); state.reportTimeZone = null;
  $("insight-list").replaceChildren(elem("li", "조회 결과를 확인하고 있습니다…"));
  $("range-note").textContent = $("period").value === "custom" ? `${range.current.startDate} ~ ${range.current.endDate} · 이전 동일 ${range.days}일과 비교` : `어제까지 ${range.days}일 · 직전 ${range.days}일과 비교 · 각 속성 시간대 기준`;
  $("quality-note").classList.add("hidden");
  $("private-content").hidden = false;
  document.body.classList.add("analytics-visible");
  $("welcome").classList.add("hidden");
  setLoading();
  updateGameView();
  setStatus("데이터 불러오는 중");
  $("status-dot").classList.add("loading");
  $("private-content").setAttribute("aria-busy", "true");
  $("refresh-btn").disabled = true;
  const errors = [];
  try {
    const portfolioFailures = state.gameId === "all" ? await loadPortfolio(generation) : 0;
    if (portfolioFailures) errors.push("게임 연결");
    if (generation !== state.generation) return;
    if (selectedProperty()) {
      const tasks = [["요약", loadSummary, null],["일별 플레이",loadTrend,"trend"],["재방문",loadRetention,"retention"]];
      if (selectedGame()?.profile === "ubr" || selectedGame()?.id === "forgeline")
        tasks.push(["광고별 유입", loadAcquisition, "acquisition-table"]);
      if (selectedGame()?.id === "forgeline")
        tasks.push(["유저 행동", () => loadBehaviorEvents("forgeline-behavior-list", forgeLineBehaviorEvents), "forgeline-behavior-list"]);
      if (selectedGame()?.profile === "ubr") tasks.push(
        ["광고", loadEvents, "ads-list"], ["퍼널", loadFunnel, "funnel"],
        ["보스", loadBoss, "boss-table"], ["중단 사유", loadStops, "stops"],

        ["보상 선택", () => loadCategorized("loot", "boss_loot_action"), "loot"],
        ["광고 종류", () => loadCategorized("ad-types", "reward_earned"), "ad-types"],
        ["성장 행동", () => loadCategorized("economy", "economy_action"), "economy"],
      );
      for (const [name, load, target] of tasks) {
        if (generation !== state.generation) return;
        try { await load(); }
        catch (error) {
          if (generation !== state.generation) return;
          if (error.status === 401) throw error;
          errors.push(name); state.insights.add(name + ": " + errorText(error));
          if (name === "요약") $("selected-note").textContent = errorText(error);
          else if (target === "acquisition-table") acquisitionMessage(errorText(error));
          else if (target === "boss-table") showTableMessage(errorText(error));
          else message(target, errorText(error), true);
          if (name === "광고") {
            $("boss-attempts").textContent = "—";
            $("rewards-earned").textContent = "—";
          }
        }
      }
    }
    if (selectedGame()?.profile === "underspark" && underSparkController && generation === state.generation) {
      errors.push(...await underSparkController.load());
    }
  } catch (error) {
    if (generation !== state.generation) return;
    if (error.status === 401) { disconnect(); notify(errorText(error)); return; }
    errors.push("전체 현황");
    notify(errorText(error));
  } finally {
    if (generation === state.generation) {
      if (selectedGame()?.profile === "ubr") acquisitionCostController?.render();
      showInsights();
      $("refresh-btn").disabled = false;
      $("status-dot").classList.remove("loading");
      $("private-content").setAttribute("aria-busy", "false");
      if (state.quality.size) {
        $("quality-note").textContent = [...state.quality].join(" · ");
        $("quality-note").classList.remove("hidden");
      }
      setStatus(errors.length ? "일부 항목 확인 필요" : "조회 완료", true);
      $("updated").textContent = new Date().toLocaleString("ko-KR") + " 확인 · 동일 조회 5분 캐시";
    }
  }
}
function connect() {
  if (!window.google?.accounts?.oauth2) {
    notify("Google 로그인 라이브러리를 불러오지 못했습니다. 네트워크나 차단 설정을 확인해 주세요.");
    return;
  }
  disconnect();
  const authGeneration = ++state.authGeneration;
  $("login-btn").disabled = true;
  const client = google.accounts.oauth2.initTokenClient({
    client_id: state.config.clientId, scope: SCOPE, login_hint: Core.ACCOUNT,
    callback: async (response) => {
      if (authGeneration !== state.authGeneration) return;
      if (response.error || !response.access_token) {
        $("login-btn").disabled = false;
        notify("Google 연결이 취소되었거나 실패했습니다.");
        return;
      }
      const controller = new AbortController();
      state.authController = controller;
      const timer = setTimeout(() => controller.abort(), 20000);
      try {
        const identityResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
          headers: { Authorization: `Bearer ${response.access_token}` }, signal: controller.signal,
          cache: "no-store", referrerPolicy: "no-referrer",
        });
        const identity = await identityResponse.json();
        if (authGeneration !== state.authGeneration) return;
        if (!identityResponse.ok || !Core.allowedAccount(identity)) {
          throw new Error(Core.ACCOUNT + " 계정으로 연결해 주세요.");
        }
        if (!google.accounts.oauth2.hasGrantedAllScopes(response, "https://www.googleapis.com/auth/analytics.readonly")) {
          throw new Error("계정 확인과 Analytics 읽기 권한에 동의해 주세요.");
        }
        const lifetime = Number(response.expires_in);
        if (!Number.isFinite(lifetime) || lifetime <= 60) throw new Error("인증 유효 시간을 확인할 수 없습니다. 다시 연결해 주세요.");
        state.token = response.access_token;
        reports.setToken(state.token);
        state.expiry = Date.now() + (lifetime - 60) * 1000;
        state.expiryTimer = setTimeout(() => {
          disconnect(); notify("Google 연결이 만료되었습니다. 다시 연결해 주세요.");
        }, state.expiry - Date.now());
        $("login-btn").classList.add("hidden");
        $("logout-btn").classList.remove("hidden");
        refresh();
      } catch (error) {
        if (authGeneration !== state.authGeneration) return;
        disconnect(); notify(error.message || "계정 확인에 실패했습니다.");
      } finally {
        clearTimeout(timer);
        if (authGeneration === state.authGeneration) $("login-btn").disabled = false;
      }
    },
    error_callback: () => {
      if (authGeneration !== state.authGeneration) return;
      $("login-btn").disabled = false;
      notify("Google 연결 창을 열지 못했거나 사용자가 닫았습니다.");
    },
  });
  client.requestAccessToken();
}
function disconnect() {
  acquisitionCostController?.clear();
  underSparkController?.clear();
  state.authGeneration++;
  state.authController?.abort();
  state.authController = null;
  reports.clear();
  $("login-btn").disabled = false;
  state.insights.clear(); $("insight-list").replaceChildren();
  $("trend-table").replaceChildren();
  for (const id of ["ad-revenue","purchase-revenue","total-active","total-new","connected-count"]) $(id).textContent = "—";
  $("range-note").textContent = "";
  $("portfolio-body").replaceChildren();
  $("portfolio-count").textContent = "연결 대기";
  $("private-content").setAttribute("aria-busy", "false");
  $("status-dot").classList.remove("loading");
  state.token = null;
  state.expiry = 0;
  clearTimeout(state.expiryTimer);
  state.expiryTimer = null;
  $("private-content").hidden = true;
  document.body.classList.remove("analytics-visible");
  state.generation++;
  state.controller?.abort();
  state.controller = null;
  $("login-btn").classList.remove("hidden");
  $("logout-btn").classList.add("hidden");
  $("refresh-btn").disabled = true;
  $("welcome").classList.remove("hidden");
  $("quality-note").classList.add("hidden");
  state.quality.clear();
  setStatus("연결 전");
  $("updated").textContent = "데이터를 불러오지 않았어요";
  for (const id of [
    "active-users",
    "new-users",
    "boss-attempts",
    "rewards-earned",
  ])
    $(id).textContent = "—";
  for (const id of [
    "funnel",
    "forgeline-behavior-list",
    "ads-list",
    "retention",
    "trend",
    "stops",
    "loot",
    "ad-types",
    "economy",
  ])
    message(id, "연결 후 데이터를 확인할 수 있어요.");
  showTableMessage("연결 후 보스 기록이 표시됩니다.");
  acquisitionMessage("연결 후 광고별 기록이 표시됩니다.");
  for (const id of ["campaign", "ad"]) {
    $(id).value = "";
    options(id, [], id === "campaign" ? "전체 캠페인" : "전체 광고");
  }
  $("acquisition").value = "";
}
if (UnderSpark) underSparkController = UnderSpark.createController({document,
  active: () => Boolean(state.token) && selectedGame()?.profile === "underspark",
  version: () => state.generation, range: reportRange, filter: () => reportFilter(false),
  query: body => api("runReport", body), refresh,
});
for (const game of Core.GAMES) {
  for (const id of ["game-select", "settings-game"]) {
    const option = elem("option", game.name);
    option.value = game.id;
    $(id).append(option);
  }
}
$("game-select").addEventListener("change", () => selectGame($("game-select").value));
$("settings-game").addEventListener("change", () => {
  $("property-id").value = state.config.bindings[$("settings-game").value];
  $("settings-error").textContent = "";
});
$("settings-btn").addEventListener("click", () => openSettings());
$("manage-games").addEventListener("click", () => openSettings());
$("nav-portfolio").addEventListener("click", event => { event.preventDefault(); selectGame("all"); });
$("nav-detail").addEventListener("click", event => { if (!selectedGame()) { event.preventDefault(); notify("먼저 분석할 게임을 선택해 주세요."); } });
$("login-btn").addEventListener("click", connect);
$("welcome-connect").addEventListener("click", connect);
$("logout-btn").addEventListener("click", disconnect);
$("refresh-btn").addEventListener("click", () => { reports.cache.clear(); refresh(); });
for (const id of ["period", "country", "platform", "app-version", "start-date", "end-date", "acquisition", "campaign", "ad"]) {
  $(id).addEventListener("change", () => {
    $("custom-dates").hidden = $("period").value !== "custom";
    if (id === "acquisition" && !$(id).value) { $("campaign").value = ""; $("ad").value = ""; }
    if (id === "campaign") $("ad").value = "";
    if ((id === "campaign" || id === "ad") && $(id).value) $("acquisition").value = "meta";
    if (state.token) refresh();
  });
}
$("save-settings").addEventListener("click", (event) => {
  try {
    const next = Core.config({ clientId: $("client-id").value.trim(),
      bindings: { ...state.config.bindings, [$("settings-game").value]: $("property-id").value.trim() } });
    window.localStorage.setItem(Core.STORAGE_KEY, JSON.stringify(next));
    disconnect();
    state.config = next;
    updateGameView();
    notify("연결 설정을 저장했습니다. Google로 연결해 주세요.");
  } catch (error) {
    event.preventDefault();
    $("settings-error").textContent = error.message || "설정을 저장하지 못했습니다.";
  }
});
if (AcquisitionCost) acquisitionCostController = AcquisitionCost.createController({document,
  active:()=>Boolean(state.token)&&selectedGame()?.profile==="ubr",version:()=>state.generation,timeZone:()=>state.reportTimeZone,
  range:zone=>{const r=reportRange(),resolve=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)?v:Attribution.dateDaysAgo(v==="yesterday"?1:v==="today"?0:Number(v.replace("daysAgo","")),zone);return {startDate:resolve(r.startDate),endDate:resolve(r.endDate)};}
});
updateGameView();
if (loadedSettings.error) notify(loadedSettings.error);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.token && Date.now() >= state.expiry) {
    disconnect();
    notify("Google 연결이 만료되었습니다. 다시 연결해 주세요.");
  }
});

$("build-link").addEventListener("click", () => {
  try {
    $("play-link").value = Attribution.playUrl($("link-campaign").value.trim(), $("link-adset").value.trim(), $("link-ad").value.trim(), state.gameId);
    $("link-message").textContent = "링크를 만들었습니다. 메타 광고 설정과 신규 설치 귀속 검증이 별도로 필요합니다.";
  } catch (e) {
    $("play-link").value = "";
    $("link-message").textContent = e.message;
  }
});
