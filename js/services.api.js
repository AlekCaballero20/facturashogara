"use strict";

/* ============================================================================
   FACTURAS HOGAR ALEK · services.api.js (Pro v2)
   - Centraliza comunicación con GAS (Apps Script)
   - Retry básico e inteligente
   - AbortController ready
   - Cache opcional con invalidación clara
   - Normalización de respuestas
   - Endpoints nuevos: historial, quickPay
============================================================================ */

(function () {
  if (window.API) return;

  if (!window.CFG) {
    throw new Error("CFG no existe. Carga config.js antes.");
  }

  const CFG = window.CFG;
  const BASE = String(CFG.SCRIPT_URL || "").trim();

  if (!BASE) {
    throw new Error("CFG.SCRIPT_URL está vacío.");
  }

  const DBG = window.__DBG__ || (() => {});
  const CACHE = window.__CACHE__ || null;

  const DEFAULTS = Object.freeze({
    RETRY: 1,
    TIMEOUT_MS: 15000,
  });

  const CACHE_KEYS = Object.freeze({
    FACTURAS: CFG.CACHE?.FACTURAS_KEY || "facturas_hogar_cache_v1",
    STATS: CFG.CACHE?.STATS_KEY || "facturas_hogar_stats_cache_v1",
    HISTORICO: "facturas_hogar_historico_cache_v1",
  });

  /* =========================
     INTERNAL HELPERS
  ========================= */

  function buildURL(params = {}) {
    const url = new URL(BASE);

    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, String(v));
      }
    });

    return url.toString();
  }

  function withTimeoutSignal(timeoutMs, externalSignal) {
    const ctrl = new AbortController();
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort(new DOMException("La solicitud tardó demasiado.", "AbortError"));
    }, timeoutMs || DEFAULTS.TIMEOUT_MS);

    if (externalSignal) {
      if (externalSignal.aborted) {
        clearTimeout(timer);
        ctrl.abort(externalSignal.reason || new DOMException("Solicitud abortada.", "AbortError"));
      } else {
        externalSignal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            ctrl.abort(externalSignal.reason || new DOMException("Solicitud abortada.", "AbortError"));
          },
          { once: true }
        );
      }
    }

    return {
      signal: ctrl.signal,
      cleanup() {
        clearTimeout(timer);
      },
      wasTimeout() {
        return timedOut;
      },
    };
  }

  async function fetchJSON(url, opts = {}, retry = DEFAULTS.RETRY) {
    const {
      method = "GET",
      signal,
      timeoutMs = DEFAULTS.TIMEOUT_MS,
      headers,
      body,
      ...rest
    } = opts || {};

    const timeout = withTimeoutSignal(timeoutMs, signal);

    DBG("API request:", method, url);

    try {
      const res = await fetch(url, {
        method,
        cache: "no-store",
        signal: timeout.signal,
        headers,
        body,
        ...rest,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const text = await res.text();

      let json;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        throw new Error("La respuesta no es JSON válido.");
      }

      return json;
    } catch (err) {
      const isAbort = err?.name === "AbortError";
      const canRetry = retry > 0 && !isAbort;

      DBG("API error:", err?.message || err);

      if (canRetry) {
        DBG("Retrying request…", url);
        return fetchJSON(url, opts, retry - 1);
      }

      if (isAbort && timeout.wasTimeout()) {
        throw new Error("La solicitud tardó demasiado.");
      }

      throw err;
    } finally {
      timeout.cleanup();
    }
  }

  function assertOk(json, defaultMsg = "Error API") {
    if (!json || json.ok === false) {
      throw new Error(json?.error || defaultMsg);
    }
    return json;
  }

  function getCache(key) {
    if (!CACHE || !CFG.CACHE?.ENABLED || !key) return null;
    try {
      return CACHE.get(key);
    } catch {
      return null;
    }
  }

  function setCache(key, value) {
    if (!CACHE || !CFG.CACHE?.ENABLED || !key) return false;
    try {
      return CACHE.set(key, value);
    } catch {
      return false;
    }
  }

  function delCache(key) {
    if (!CACHE || !key) return;
    try {
      CACHE.del(key);
    } catch {}
  }

  function invalidateCoreCaches() {
    delCache(CACHE_KEYS.FACTURAS);
    delCache(CACHE_KEYS.STATS);
    delCache(CACHE_KEYS.HISTORICO);
  }

  function normalizeRowsPayload(json, label = "rows") {
    if (Array.isArray(json)) return json;
    if (json && Array.isArray(json.rows)) return json.rows;
    if (json && Array.isArray(json.data)) return json.data;
    throw new Error(`Formato inesperado (${label})`);
  }

  function normalizeStatsPayload(json) {
    const out = assertOk(json, "No se pudieron cargar estadísticas");
    return out;
  }

  function cleanPayload(obj = {}) {
    const out = {};
    Object.entries(obj).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") out[k] = v;
    });
    return out;
  }

  function numberOrEmpty(v) {
    if (v == null || v === "") return "";
    const n = Number(v);
    return Number.isFinite(n) ? n : "";
  }

  /* =========================
     REQUEST WRAPPERS
  ========================= */

  async function getAction(action, params = {}, opts = {}) {
    const url = buildURL({ action, ...cleanPayload(params) });
    return fetchJSON(url, opts, opts?.retry ?? DEFAULTS.RETRY);
  }

  /* =========================
     API METHODS
  ========================= */

  async function listarFacturas(opts = {}) {
    const cacheKey = CACHE_KEYS.FACTURAS;

    const cached = getCache(cacheKey);
    if (cached) {
      DBG("Cache HIT facturas");
      return cached;
    }

    const json = await getAction("listar", {}, opts);
    const rows = normalizeRowsPayload(json, "listar");

    setCache(cacheKey, rows);
    return rows;
  }

  async function registrarPago(row, opts = {}) {
    const json = await getAction(
      "registrar",
      { row: numberOrEmpty(row) },
      opts
    );

    invalidateCoreCaches();
    return assertOk(json, "Error al registrar pago");
  }

  async function editarValor(row, valor, opts = {}) {
    const json = await getAction(
      "editar",
      {
        row: numberOrEmpty(row),
        valor: numberOrEmpty(valor),
      },
      opts
    );

    invalidateCoreCaches();
    return assertOk(json, "Error al editar valor");
  }

  async function editarMetodo(row, metodo, opts = {}) {
    const json = await getAction(
      "editarMetodo",
      {
        row: numberOrEmpty(row),
        metodo: String(metodo ?? "").trim(),
      },
      opts
    );

    invalidateCoreCaches();
    return assertOk(json, "Error al editar método");
  }

  async function stats(opts = {}) {
    const cacheKey = CACHE_KEYS.STATS;

    const cached = getCache(cacheKey);
    if (cached) {
      DBG("Cache HIT stats");
      return cached;
    }

    const json = await getAction("stats", {}, opts);
    const out = normalizeStatsPayload(json);

    setCache(cacheKey, out);
    return out;
  }

  async function historial(opts = {}) {
    const cacheKey = CACHE_KEYS.HISTORICO;

    const cached = getCache(cacheKey);
    if (cached) {
      DBG("Cache HIT historico");
      return cached;
    }

    const json = await getAction("historial", {}, opts);
    const rows = normalizeRowsPayload(json, "historial");

    setCache(cacheKey, rows);
    return rows;
  }

  async function quickPay(payload = {}, opts = {}) {
    const factura = String(payload.factura ?? "").trim();
    const valorPagado = numberOrEmpty(payload.valorPagado);
    const metodo = String(payload.metodo ?? "").trim();
    const fecha = String(payload.fecha ?? "").trim();
    const nota = String(payload.nota ?? "").trim();

    if (!factura) {
      throw new Error("Falta la factura para quickPay.");
    }

    if (valorPagado === "" || !Number.isFinite(Number(valorPagado))) {
      throw new Error("Falta un valor pagado válido para quickPay.");
    }

    const json = await getAction(
      "quickpay",
      cleanPayload({
        factura,
        valorPagado,
        metodo,
        fecha,
        nota,
      }),
      opts
    );

    invalidateCoreCaches();
    return assertOk(json, "No se pudo registrar el pago rápido");
  }

  /* =========================
     OPTIONAL UTILITIES
  ========================= */

  function clearCache() {
    invalidateCoreCaches();
  }

  function getBaseUrl() {
    return BASE;
  }

  /* =========================
     PUBLIC API
  ========================= */

  window.API = Object.freeze({
    listarFacturas,
    registrarPago,
    editarValor,
    editarMetodo,
    stats,
    historial,
    quickPay,
    clearCache,
    getBaseUrl,
  });
})();