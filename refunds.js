"use strict";
(function (root) {
  const statuses = ["recovered", "already_recovered", "eligible", "review", "retry", "not_refunded"];
  const storeLabels = {google_play: "Google Play", app_store: "App Store", other: "기타 스토어"};
  const gameStates = {ok: "실행 완료", attention: "확인 필요", apply_disabled: "회수 비활성",
    timeout: "응답 시간 초과", invalid_response: "응답 계약 오류", adapter_failed: "실행 실패"};
  const maxBytes = 2 * 1024 * 1024;
  const counter = (value, max = 1_000_000) => Number.isSafeInteger(value) && value >= 0 && value <= max;
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key));

  function parseSnapshot(data, games, now) {
    if (!exact(data, ["schemaVersion","kind","environment","mode","startedAtMs","finishedAtMs","games"]) ||
        data.schemaVersion !== 1 || data.kind !== "game_refund_operations" ||
        !["production","test"].includes(data.environment) || !["preview","apply"].includes(data.mode) ||
        !counter(data.startedAtMs, now + 300000) || !counter(data.finishedAtMs, now + 300000) ||
        data.startedAtMs > data.finishedAtMs || data.finishedAtMs < now - 7 * 86400000 ||
        !object(data.games) || !Object.keys(data.games).length) throw Error("최근 7일 이내 생성한 환불 집계 JSON이 필요합니다.");
    const known = new Set(games.map(game => game.id));
    for (const [game, result] of Object.entries(data.games)) {
      if (!known.has(game) || !exact(result, ["status","stores"]) || !Object.hasOwn(gameStates,result.status) ||
          !object(result.stores)) throw Error("운영센터에 등록된 게임과 집계 형식을 확인해 주세요.");
      const hasRows = Object.keys(result.stores).length > 0;
      if (hasRows !== ["ok","attention"].includes(result.status)) throw Error("환불 실행 상태와 집계가 일치하지 않습니다.");
      let needsAttention = false;
      for (const [store, counts] of Object.entries(result.stores)) {
        if (!Object.hasOwn(storeLabels,store) || !exact(counts,statuses) || statuses.some(key => !counter(counts[key])) ||
            (data.mode === "preview" && counts.recovered) || (data.mode === "apply" && counts.eligible))
          throw Error("스토어·환경·환불 집계 건수를 확인해 주세요.");
        needsAttention ||= Boolean(counts.review || counts.retry);
      }
      if (hasRows && needsAttention !== (result.status === "attention")) throw Error("검토·재시도 집계와 실행 상태를 확인해 주세요.");
    }
    return data;
  }

  function createController({document, games, active, selected, legacyParser, readLocal}) {
    const $ = id => document.getElementById(id);
    let data = null, epoch = 0, timer, checkedLocal = false;
    const append = (node, tag, value) => {
      const item = document.createElement(tag);
      item.textContent = String(value);
      node.append(item);
    };
    function render() {
      const body = $("refund-body");
      body.replaceChildren();
      $("refund-legacy").textContent = "";
      const gameId = selected();
      $("refund-forgeline-note").hidden = gameId !== "forgeline";
      const visible = games.filter(game => !gameId || game.id === gameId);
      if (data?.kind === "underspark_hub_summary") {
        $("refund-status").textContent = gameId && gameId !== "underspark" ? "이 게임의 환불 자료가 없습니다." :
          `UnderSpark 기존 운영자 집계 · ${data.mode === "test" ? "시험" : "운영"} · ${data.commerce.source} · ${data.commerce.truncated ? "부분 자료" : "내보낸 범위"}`;
        if (!gameId || gameId === "underspark") {
          const commerce = data.commerce;
          const refundRows = commerce.rows.filter(row => row.kind === "refund_import");
          const observed = refundRows.reduce((sum,row) => sum + BigInt(row.orders), 0n);
          $("refund-legacy").textContent = `원본 범위 ${new Date(commerce.sinceMs).toISOString()} ~ ${new Date(commerce.throughMs).toISOString()} · 금액과 일자가 있는 환불 관측 ${observed}건 · 게임 내 회수 관측 ${commerce.recoveries}건`;
        }
      } else {
        $("refund-status").textContent = data
          ? `${data.environment === "test" ? "시험" : "운영"} · ${data.mode === "preview" ? "미리보기" : "회수 실행"} · ${new Date(data.finishedAtMs).toISOString()} · 한 번의 실행 결과`
          : "공통 환불 집계 미선택 · 게임 서버에서 내보낸 자료를 불러오세요.";
      }
      for (const game of visible) {
        const result = data?.games?.[game.id];
        const rows = result && Object.keys(result.stores).length ? Object.entries(result.stores) : [[null,null]];
        for (const [store, counts] of rows) {
          const row = document.createElement("tr");
          append(row,"th",game.name);
          append(row,"td",store ? storeLabels[store] : "—");
          const legacy = data?.kind === "underspark_hub_summary" && game.id === "underspark";
          append(row,"td",result ? gameStates[result.status] : legacy ? "기존 집계" : "자료 없음");
          for (const key of statuses) append(row,"td",counts ? counts[key] : "—");
          body.append(row);
        }
      }
    }
    function clear(resetConnection = false) {
      epoch++;
      data = null;
      checkedLocal = !resetConnection;
      clearTimeout(timer);
      $("refund-file").value = "";
      render();
    }
    function show(dataToShow, now) {
      data = dataToShow;
      clearTimeout(timer);
      timer = setTimeout(() => clear(), Math.min(30 * 60000, (data.expiresAtMs ?? data.finishedAtMs + 7 * 86400000) - now));
      render();
    }
    async function loadLocal(explicit = false) {
      if (!readLocal || !active() || (!explicit && checkedLocal)) return;
      checkedLocal = true;
      const ticket = ++epoch;
      try {
        const snapshot = await readLocal();
        if (!active() || ticket !== epoch) return;
        if (snapshot === null) {
          if (explicit) $("refund-status").textContent = "ProjectManager의 최근 환불 실행 자료가 없습니다.";
          return;
        }
        const now = Date.now();
        show(parseSnapshot(snapshot, games, now), now);
      } catch {
        if (active() && ticket === epoch && (explicit || !data))
          $("refund-status").textContent = "최근 실행 자료를 읽지 못했습니다. 집계 파일을 선택할 수 있습니다.";
      }
    }
    $("refund-refresh").hidden = !readLocal;
    $("refund-refresh").addEventListener("click", () => loadLocal(true));
    $("refund-clear").addEventListener("click", () => clear());
    $("refund-file").addEventListener("change", async () => {
      const file = $("refund-file").files?.[0], ticket = ++epoch;
      if (!active() || !file) return;
      try {
        if (file.size > maxBytes) throw Error("집계 파일은 2MiB 이하만 허용합니다.");
        const text = await file.text();
        if (!active() || ticket !== epoch) return;
        if (new TextEncoder().encode(text).length > maxBytes) throw Error("집계 파일은 2MiB 이하만 허용합니다.");
        let input;
        try { input = JSON.parse(text); } catch { throw Error("환불 집계 파일의 JSON 형식을 확인해 주세요."); }
        const now = Date.now();
        const isLegacy = input?.kind === "underspark_hub_summary";
        const validated = isLegacy && legacyParser ? legacyParser(text, now) : parseSnapshot(input, games, now);
        if (isLegacy && !validated.commerce) throw Error("UnderSpark 구매·환불 집계가 포함된 파일이 필요합니다.");
        show(validated, now);
      } catch (error) {
        if (active() && ticket === epoch) {
          clear();
          $("refund-status").textContent = error.message;
        }
      } finally {
        if (ticket === epoch) $("refund-file").value = "";
      }
    });
    return {clear, render, loadLocal};
  }
  const api = {parseSnapshot, createController};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RefundOperations = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis);
