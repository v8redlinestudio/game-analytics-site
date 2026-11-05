"use strict";
// Campaign IDs only; never store click identifiers, tokens, or player identities.
(function (root) {
  const EVENTS = ["first_open", "game_ready", "tutorial_finished", "boss_started", "boss_won", "reward_earned"];
  const SOURCES = ["meta", "facebook", "instagram", "fb", "ig", "facebook.com", "instagram.com"];
  const MEDIA = ["paid_social", "cpc", "paid", "cpm", "app_install"];
  const DIMENSIONS = ["firstUserManualSource", "firstUserManualCampaignId", "firstUserManualTerm", "firstUserManualAdContent", "eventName"];
  function combine(...filters) {
    const items = filters.filter(Boolean);
    return items.length > 1 ? { andGroup: { expressions: items } } : items[0];
  }
  function exact(fieldName, value) {
    return value ? { filter: { fieldName, stringFilter: { matchType: "EXACT", value } } } : undefined;
  }
  function metaFilter() {
    // Use explicitly tagged first-install UTMs. Do not infer paid traffic from referrals.
    return combine(
      { filter: { fieldName: "firstUserManualSource", inListFilter: { values: SOURCES, caseSensitive: false } } },
      { filter: { fieldName: "firstUserManualMedium", inListFilter: { values: MEDIA, caseSensitive: false } } },
    );
  }
  function audienceFilter({ country, meta, campaign, ad }) {
    return combine(exact("country", country), (meta || campaign || ad) ? metaFilter() : undefined,
      exact("firstUserManualCampaignId", campaign), exact("firstUserManualAdContent", ad));
  }
  function dateDaysAgo(days, timeZone, now = new Date()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(now).filter(p => p.type !== "literal").map(p => [p.type, p.value]));
    return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) - days)).toISOString().slice(0, 10);
  }
  function acquisitionBody({ period, dateRange, country, timeZone, now = new Date() }) {
    if (dateRange) {
      const resolve = value => {
        if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
        if (value === "today") return dateDaysAgo(0, timeZone, now);
        if (value === "yesterday") return dateDaysAgo(1, timeZone, now);
        const match = /^(\d+)daysAgo$/.exec(value);
        if (!match) throw new Error("지원하지 않는 날짜입니다.");
        return dateDaysAgo(Number(match[1]), timeZone, now);
      };
      const start = resolve(dateRange.startDate), end = resolve(dateRange.endDate);
      const days = (Date.parse(end) - Date.parse(start)) / 86400000 + 1;
      if (!Number.isInteger(days) || days < 1 || days > 366) throw new Error("조회 기간을 확인해 주세요.");
      const dates = Array.from({length:days}, (_, i) => new Date(Date.parse(start) + i * 86400000).toISOString().slice(0,10).replaceAll("-", ""));
      return { dateRanges:[dateRange], dimensions:DIMENSIONS.map(name=>({name})),metrics:[{name:"totalUsers"}],
        dimensionFilter:combine(exact("country",country),metaFilter(),
          {filter:{fieldName:"firstSessionDate",inListFilter:{values:dates}}},
          {filter:{fieldName:"eventName",inListFilter:{values:EVENTS}}}),limit:"10000" };
    }
    const match = /^(6|27|89)daysAgo$/.exec(period);
    if (!match) throw new Error("지원하지 않는 기간입니다.");
    const days = Number(match[1]);
    const firstSessionDates = Array.from({ length: days + 1 }, (_, i) => dateDaysAgo(i, timeZone, now).replaceAll("-", ""));
    return {
      dateRanges: [{ startDate: period, endDate: "today" }],
      dimensions: DIMENSIONS.map(name => ({ name })), metrics: [{ name: "totalUsers" }],
      dimensionFilter: combine(exact("country", country), metaFilter(),
        { filter: { fieldName: "firstSessionDate", inListFilter: { values: firstSessionDates } } },
        { filter: { fieldName: "eventName", inListFilter: { values: EVENTS } } }),
      limit: "10000",
    };
  }
  function aggregate(data) {
    const groups = new Map();
    for (const row of data.rows || []) {
      const d = (row.dimensionValues || []).map(v => v.value);
      const count = Number(row.metricValues?.[0]?.value);
      if (d.length !== 5 || !EVENTS.includes(d[4]) || !Number.isFinite(count) || count < 0) continue;
      const key = JSON.stringify(d.slice(0, 4));
      if (!groups.has(key)) groups.set(key, { ids: d.slice(0, 4), counts: Object.fromEntries(EVENTS.map(name => [name, 0])) });
      // Data API already deduplicates users within each ad/event group.
      groups.get(key).counts[d[4]] = count;
    }
    return [...groups.values()].sort((a, b) => b.counts.first_open - a.counts.first_open || JSON.stringify(a.ids).localeCompare(JSON.stringify(b.ids)));
  }
  function playUrl(campaign, adset, ad) {
    if (![campaign, adset, ad].every(v => typeof v === "string" && /^\d{1,32}$/.test(v))) {
      throw new Error("캠페인·광고 세트·광고의 숫자 ID를 모두 입력해 주세요.");
    }
    const referrer = new URLSearchParams({ utm_source: "meta", utm_medium: "paid_social", utm_campaign: campaign, utm_id: campaign, utm_term: adset, utm_content: ad });
    const url = new URL("https://play.google.com/store/apps/details");
    url.searchParams.set("id", "com.v8redline.unlimitbossrun");
    url.searchParams.set("referrer", referrer.toString());
    return url.toString();
  }
  const api = Object.freeze({ EVENTS, DIMENSIONS, combine, metaFilter, audienceFilter, dateDaysAgo, acquisitionBody, aggregate, playUrl });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.UBRAttribution = api;
})(typeof window !== "undefined" ? window : globalThis);
