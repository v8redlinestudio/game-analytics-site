"use strict";
(function (root) {
  const ACCOUNT = "v8redline.studio@gmail.com";
  const CLIENT_ID = "755808518263-cbhrcuhubp42g1s71i1dgm7kr1aav27c.apps.googleusercontent.com";
  const STORAGE_KEY = "v8redline-analytics-settings-v1";
  const GAMES = Object.freeze([
    { id: "unlimitbossrun", name: "또 보스냐!", profile: "ubr", propertyId: "561781670" },
    { id: "dinomagic", name: "다이노매직" },
    { id: "machomade", name: "마초메이드" },
    { id: "underspark", name: "UnderSpark", profile: "underspark", propertyId: "560510698" },
    { id: "forgeline", name: "ForgeLine", propertyId: "563027639" },
    { id: "nightscape", name: "야경수호대" },
    { id: "redline", name: "REDLINE" },
    { id: "royalslimepop", name: "Royal Slime Pop" },
    { id: "zodiac", name: "십이지신 디펜스" },
    { id: "neonarcade", name: "Neon Arcade" },
  ].map(Object.freeze));

  function config(input = {}) {
    const clientId = input.clientId === undefined ? CLIENT_ID : input.clientId;
    if (typeof clientId !== "string" || !/^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
      throw new Error("올바른 OAuth 클라이언트 ID를 입력해 주세요.");
    }
    const bindings = {};
    const properties = new Set();
    for (const game of GAMES) {
      const propertyId = input.bindings?.[game.id] ?? game.propertyId ?? "";
      if (typeof propertyId !== "string" || (propertyId && !/^[1-9]\d{0,19}$/.test(propertyId))) {
        throw new Error(`${game.name}의 GA4 숫자 속성 ID를 확인해 주세요.`);
      }
      if (propertyId && properties.has(propertyId)) {
        throw new Error("같은 GA4 속성을 여러 게임에 연결할 수 없습니다.");
      }
      if (propertyId) properties.add(propertyId);
      bindings[game.id] = propertyId;
    }
    return { version: 1, clientId, bindings };
  }

  function loadConfig(storage) {
    try {
      const value = storage.getItem(STORAGE_KEY);
      return { config: config(value ? JSON.parse(value) : {}), error: "" };
    } catch {
      return { config: config(), error: "저장된 연결 설정을 읽지 못했습니다. 기본 연결을 확인해 주세요." };
    }
  }

  function allowedAccount(identity) {
    if (identity?.email_verified !== true || typeof identity.email !== "string") return false;
    // Gmail dot aliases are the same account. Do not normalize other domains.
    const canonical = (email) => email.toLowerCase().replace(/^([^@]+)@gmail\.com$/, (_, name) => name.replaceAll(".", "") + "@gmail.com");
    return canonical(identity.email) === canonical(ACCOUNT);
  }

  function quality(data) {
    const warnings = new Set();
    for (const part of [data, data.funnelVisualization, data.funnelTable]) {
      if (!part) continue;
      const meta = part.metadata || {};
      if (meta.subjectToThresholding) warnings.add("개인정보 보호 임계값 적용");
      if (meta.dataLossFromOtherRow) warnings.add("일부 항목이 기타로 집계됨");
      if (meta.samplingMetadatas?.length) warnings.add("표본 데이터 포함");
      if (meta.schemaRestrictionResponse?.activeMetricRestrictions?.length) warnings.add("일부 측정항목 접근 제한");
      if (Number(part.rowCount || 0) > (part.rows || []).length) warnings.add("일부 행만 표시됨");
    }
    return [...warnings];
  }

  const SUMMARY_METRICS = ["activeUsers", "newUsers", "totalAdRevenue", "purchaseRevenue"];
  function ranges(period, start, end) {
    if (period !== "custom") {
      const match = /^(6|27|89)daysAgo$/.exec(period);
      if (!match) throw new Error("기간을 확인해 주세요.");
      const days = Number(match[1]) + 1;
      return { days, current: { startDate: `${days}daysAgo`, endDate: "yesterday", name: "current" },
        previous: { startDate: `${days * 2}daysAgo`, endDate: `${days + 1}daysAgo`, name: "previous" } };
    }
    const parse = value => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) throw new Error("시작일과 종료일을 입력해 주세요.");
      const time = Date.parse(value + "T00:00:00Z");
      if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw new Error("날짜를 확인해 주세요.");
      return time;
    };
    const first = parse(start), last = parse(end), days = (last - first) / 86400000 + 1;
    if (days < 1 || days > 366) throw new Error("기간은 순서대로 최대 366일까지 선택해 주세요.");
    const date = time => new Date(time).toISOString().slice(0, 10);
    return { days, current: { startDate: start, endDate: end, name: "current" },
      previous: { startDate: date(first - days * 86400000), endDate: date(first - 86400000), name: "previous" } };
  }
  function summary(data) {
    const rangeIndex = (data.dimensionHeaders || []).findIndex(h => h.name === "dateRange");
    const restricted = new Set((data.metadata?.schemaRestrictionResponse?.activeMetricRestrictions || []).map(r => r.metricName));
    const find = name => (data.rows || []).find(row => rangeIndex >= 0 ? row.dimensionValues?.[rangeIndex]?.value === name : name === "current");
    const values = row => Object.fromEntries(SUMMARY_METRICS.map((name, fallback) => {
      const index = data.metricHeaders?.length ? data.metricHeaders.findIndex(h => h.name === name) : fallback;
      const raw = row?.metricValues?.[index]?.value;
      return [name, raw !== undefined && raw !== "" && Number.isFinite(Number(raw)) && !restricted.has(name) ? Number(raw) : null];
    }));
    return { current: values(find("current")), previous: values(find("previous")),
      currency: data.metadata?.currencyCode || "", timeZone: data.metadata?.timeZone || "미확인", limited: quality(data).length > 0 };
  }
  function change(current, previous, limited = false) {
    if (limited) return "집계 제한 · 비교 보류";
    if (current === null || previous === null) return "비교 자료 없음";
    if (previous === 0) return current === 0 ? "이전 기간과 동일" : "이전 0 · 증감률 미정";
    const delta = (current - previous) / Math.abs(previous) * 100;
    return `${delta > 0 ? "+" : ""}${delta.toFixed(1)}% · 이전 기간 대비`;
  }
  function adWarnings(counts) {
    const issues = [];
    for (const [before, after, label] of [["reward_requested", "reward_shown", "표시가 요청보다 많습니다"], ["reward_shown", "reward_earned", "보상 획득이 표시보다 많습니다"], ["reward_earned", "reward_saved", "보상 저장 결과가 획득보다 많습니다"]]) {
      if ((counts[after] || 0) > (counts[before] || 0)) issues.push(`광고 계측 확인: ${label}. 기간 경계·지연·중복 또는 이벤트 누락 가능성을 점검하세요. 개별 광고 시도의 오류 확정은 아닙니다.`);
    }
    return issues;
  }

  class Reports {
    constructor(fetcher = (...args) => globalThis.fetch(...args), now = Date.now) {
      this.fetcher = fetcher;
      this.now = now;
      this.cache = new Map();
      this.epoch = 0;
      this.token = null;
    }
    setToken(token) {
      this.clear();
      this.token = token;
    }
    clear() {
      this.epoch++;
      this.token = null;
      this.cache.clear();
    }
    async request(propertyId, method, body, version = "v1beta", signal) {
      if (!/^[1-9]\d{0,19}$/.test(propertyId) || !["runReport", "runFunnelReport"].includes(method) || !["v1beta", "v1alpha"].includes(version)) {
        throw new Error("허용하지 않는 보고서 요청입니다.");
      }
      if (!this.token) throw new Error("Google 연결이 필요합니다.");
      if (signal?.aborted) throw new DOMException("조회 취소", "AbortError");
      const epoch = this.epoch;
      const key = JSON.stringify([propertyId, version, method, body]);
      const cached = this.cache.get(key);
      if (cached && this.now() - cached.at < 300000) return structuredClone(cached.data);
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(abort, 30000);
      try {
        const response = await this.fetcher(`https://analyticsdata.googleapis.com/${version}/properties/${propertyId}:${method}`, {
          method: "POST", headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, returnPropertyQuota: true }), signal: controller.signal,
          cache: "no-store", referrerPolicy: "no-referrer",
        });
        const data = await response.json();
        if (epoch !== this.epoch || controller.signal.aborted) throw new DOMException("조회 취소", "AbortError");
        if (!response.ok) {
          const error = new Error(data.error?.message || "보고서 조회 실패");
          error.status = response.status;
          throw error;
        }
        if (this.cache.size >= 128) this.cache.delete(this.cache.keys().next().value);
        this.cache.set(key, { at: this.now(), data: structuredClone(data) });
        return data;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      }
    }
  }
  const api = { ACCOUNT, CLIENT_ID, STORAGE_KEY, GAMES, config, loadConfig, allowedAccount, quality, Reports, SUMMARY_METRICS, ranges, summary, change, adWarnings };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ForgeAnalytics = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis);
