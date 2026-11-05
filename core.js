"use strict";
(function (root) {
  const ACCOUNT = "v8redline.studio@gmail.com";
  const CLIENT_ID = "755808518263-cbhrcuhubp42g1s71i1dgm7kr1aav27c.apps.googleusercontent.com";
  const STORAGE_KEY = "v8redline-analytics-settings-v1";
  const GAMES = Object.freeze([
    { id: "unlimitbossrun", name: "또 보스냐!", profile: "ubr", propertyId: "561781670" },
    { id: "dinomagic", name: "다이노매직" },
    { id: "machomade", name: "마초메이드" },
    { id: "underspark", name: "UnderSpark", propertyId: "560510698" },
    { id: "forgeline", name: "ForgeLine" },
    { id: "shrimpgrow", name: "ShrimpGrow" },
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
      if (Number(part.rowCount || 0) > (part.rows || []).length) warnings.add("일부 행만 표시됨");
    }
    return [...warnings];
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
  const api = { ACCOUNT, CLIENT_ID, STORAGE_KEY, GAMES, config, loadConfig, allowedAccount, quality, Reports };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ForgeAnalytics = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis);
