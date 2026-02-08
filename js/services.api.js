"use strict";

/* ============================================================================
   FACTURAS HOGAR ALEK · services.api.js (vNext+++)
   - Centraliza comunicación con GAS (Apps Script)
   - Retry inteligente
   - AbortController ready
   - Cache opcional (usa __CACHE__ si existe)
   - Debug integrado
============================================================================ */

(function () {

  if (!window.CFG) {
    throw new Error("CFG no existe. Carga config.js antes.");
  }

  const CFG = window.CFG;
  const BASE = CFG.SCRIPT_URL;

  const DBG = window.__DBG__ || (() => {});
  const CACHE = window.__CACHE__ || null;

  /* =========================
     INTERNAL HELPERS
  ========================= */

  function buildURL(params = {}) {
    const url = new URL(BASE);

    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) {
        url.searchParams.set(k, String(v));
      }
    });

    return url.toString();
  }

  async function fetchJSON(url, opts = {}, retry = 1) {

    DBG("API request:", url);

    try {

      const res = await fetch(url, {
        method: "GET",
        cache: "no-store",
        ...opts
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const json = await res.json();

      return json;

    } catch (err) {

      if (retry > 0) {
        DBG("Retrying request…", url);
        return fetchJSON(url, opts, retry - 1);
      }

      throw err;
    }
  }

  function assertOk(json, defaultMsg = "Error API") {
    if (!json || json.ok === false) {
      throw new Error(json?.error || defaultMsg);
    }
    return json;
  }

  /* =========================
     API METHODS
  ========================= */

  async function listarFacturas(opts = {}) {

    const cacheKey = CFG.CACHE?.FACTURAS_KEY;

    if (CACHE) {
      const cached = CACHE.get(cacheKey);
      if (cached) {
        DBG("Cache HIT facturas");
        return cached;
      }
    }

    const json = await fetchJSON(
      buildURL({ action: "listar" }),
      opts
    );

    let rows;

    if (Array.isArray(json)) rows = json;
    else if (json && Array.isArray(json.rows)) rows = json.rows;
    else throw new Error("Formato inesperado (listar)");

    if (CACHE) CACHE.set(cacheKey, rows);

    return rows;
  }

  async function registrarPago(row, opts = {}) {

    const json = await fetchJSON(
      buildURL({
        action: "registrar",
        row
      }),
      opts
    );

    CACHE?.del(CFG.CACHE.FACTURAS_KEY);

    return assertOk(json, "Error al registrar pago");
  }

  async function editarValor(row, valor, opts = {}) {

    const json = await fetchJSON(
      buildURL({
        action: "editar",
        row,
        valor
      }),
      opts
    );

    CACHE?.del(CFG.CACHE.FACTURAS_KEY);

    return assertOk(json, "Error al editar valor");
  }

  async function editarMetodo(row, metodo, opts = {}) {

    const json = await fetchJSON(
      buildURL({
        action: "editarMetodo",
        row,
        metodo
      }),
      opts
    );

    CACHE?.del(CFG.CACHE.FACTURAS_KEY);

    return assertOk(json, "Error al editar método");
  }

  async function stats(opts = {}) {

    const cacheKey = CFG.CACHE?.STATS_KEY;

    if (CACHE) {
      const cached = CACHE.get(cacheKey);
      if (cached) {
        DBG("Cache HIT stats");
        return cached;
      }
    }

    const json = await fetchJSON(
      buildURL({ action: "stats" }),
      opts
    );

    const out = assertOk(json, "No se pudieron cargar estadísticas");

    CACHE?.set(cacheKey, out);

    return out;
  }

  /* =========================
     PUBLIC API (no fallback duplicado)
  ========================= */

  window.API = Object.freeze({
    listarFacturas,
    registrarPago,
    editarValor,
    editarMetodo,
    stats
  });

})();
