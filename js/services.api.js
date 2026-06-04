"use strict";

(function () {
  if (window.API) return;
  const CFG = window.CFG;
  const CACHE = window.__CACHE__;
  const BASE = String(CFG.SCRIPT_URL || "").trim();

  function clean(obj = {}) {
    const out = {};
    Object.entries(obj).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") out[k] = v;
    });
    if (CFG.API_KEY) out.apiKey = CFG.API_KEY;
    return out;
  }
  function buildURL(action, params = {}) {
    const url = new URL(BASE);
    Object.entries(clean({ action, ...params })).forEach(([k, v]) => url.searchParams.set(k, String(v)));
    return url.toString();
  }
  function timeoutSignal(ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    return { signal: ctrl.signal, done: () => clearTimeout(timer) };
  }
  async function fetchJSON(url, opts = {}, retries = CFG.API.RETRY) {
    const t = timeoutSignal(opts.timeoutMs || CFG.API.TIMEOUT_MS);
    try {
      const res = await fetch(url, { method: opts.method || "GET", cache: "no-store", signal: t.signal, headers: opts.headers, body: opts.body });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const txt = await res.text();
      const json = txt ? JSON.parse(txt) : {};
      if (json && json.ok === false) throw new Error(json.error || "No se pudo completar la acción.");
      return json;
    } catch (err) {
      if (err.name === "AbortError") throw new Error("No se pudo cargar la información. Revisa la conexión o el despliegue de Apps Script.");
      if (retries > 0) return fetchJSON(url, opts, retries - 1);
      throw err;
    } finally {
      t.done();
    }
  }
  async function get(action, params, opts) {
    return fetchJSON(buildURL(action, params), opts);
  }
  async function post(action, payload, opts = {}) {
    return fetchJSON(buildURL(action, {}), {
      ...opts,
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(clean({ action, ...payload })),
    });
  }
  function rows(json) {
    if (Array.isArray(json)) return json;
    if (Array.isArray(json.rows)) return json.rows;
    if (Array.isArray(json.data)) return json.data;
    return [];
  }
  function cacheGet(key) { return CFG.CACHE.ENABLED ? CACHE.get(key) : null; }
  function cacheSet(key, value) { if (CFG.CACHE.ENABLED) CACHE.set(key, value); }
  function invalidate() { CACHE.clearAll(); }

  async function listarFacturas(opts = {}) {
    const key = CFG.CACHE.FACTURAS_KEY;
    if (!opts.force) {
      const c = cacheGet(key);
      if (c) return c;
    }
    const data = rows(await get("listar", {}, opts));
    cacheSet(key, data);
    return data;
  }
  async function registrarPago(payload = {}, opts = {}) {
    const json = await post("registrar", payload, opts);
    invalidate();
    return json;
  }
  async function quickPay(payload = {}, opts = {}) {
    const json = await post("quickpay", payload, opts);
    invalidate();
    return json;
  }
  async function editarValor(row, valor, opts = {}) {
    const json = await post("editar", { row, valor }, opts);
    invalidate();
    return json;
  }
  async function editarMetodo(row, metodo, opts = {}) {
    const json = await post("editarMetodo", { row, metodo }, opts);
    invalidate();
    return json;
  }
  async function editarFactura(payload = {}, opts = {}) {
    try {
      const json = await post("editarFactura", payload, opts);
      invalidate();
      return json;
    } catch (err) {
      const onlyLegacy = ["row", "valorBase", "metodo"].every((k) => payload[k] !== undefined || k !== "row") &&
        !["diaVencimiento", "categoria", "responsable", "presupuestoMensual", "linkPago", "nota", "activa"].some((k) => payload[k] !== undefined);
      if (!onlyLegacy) throw err;
      if (payload.valorBase !== undefined) await editarValor(payload.row, payload.valorBase, opts);
      if (payload.metodo !== undefined) await editarMetodo(payload.row, payload.metodo, opts);
      return { ok: true, fallback: true };
    }
  }
  async function stats(opts = {}) {
    const key = CFG.CACHE.STATS_KEY;
    if (!opts.force) {
      const c = cacheGet(key);
      if (c) return c;
    }
    const json = await get("stats", {}, opts);
    cacheSet(key, json);
    return json;
  }
  async function historial(params = {}, opts = {}) {
    const useCache = !Object.keys(params || {}).length && !opts.force;
    const key = CFG.CACHE.HISTORICO_KEY;
    if (useCache) {
      const c = cacheGet(key);
      if (c) return c;
    }
    const data = rows(await get("historial", params, opts));
    if (useCache) cacheSet(key, data);
    return data;
  }
  async function resumenMes(params = {}, opts = {}) {
    return get("resumenMes", params, opts);
  }
  async function cerrarMes(payload = {}, opts = {}) {
    const json = await post("cerrarMes", payload, opts);
    invalidate();
    return json;
  }

  window.API = Object.freeze({
    listarFacturas, registrarPago, quickPay, editarValor, editarMetodo, editarFactura,
    stats, historial, resumenMes, cerrarMes, clearCache: invalidate,
  });
})();
