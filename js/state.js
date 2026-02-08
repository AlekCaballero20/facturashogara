"use strict";

/* ============================================================================
   FACTURAS HOGAR ALEK · state.js (vNext+++)
   - Estado centralizado (facturas, filtered, stats, filtros, meta)
   - Pub/Sub liviano (on/off/once) + wildcard
   - Mutación controlada + snapshots seguros
   - Helpers de negocio (isPagoDelMes, extractMetodos)
   - Persistencia opcional (si existe __CACHE__)
   - Protecciones: no pisar window.STATE si ya existe
============================================================================ */

(function () {
  // Evita doble carga accidental
  if (window.STATE) return;

  const CFG = window.CFG || {};
  const DBG = window.__DBG__ || (() => {});
  const CACHE = window.__CACHE__ || null;

  const DEFAULTS = Object.freeze({
    facturas: [],
    filtered: [],
    stats: null,

    filters: {
      q: "",
      estado: "all", // all | pagado | pendiente
      metodo: "all", // all | "Nequi" | "Daviplata" | etc
    },

    meta: {
      lastLoadedAt: 0,
      lastStatsAt: 0,
      isBusy: false,
      lastError: "",
      version: 1,
    },
  });

  /* =========================
     INTERNAL STORE
  ========================= */
  const store = structuredCloneSafe(DEFAULTS);

  // eventName -> Set(fn)
  const listeners = new Map();
  // wildcard listeners ("*") receives (eventName, payload)
  const wildcards = new Set();

  function structuredCloneSafe(obj) {
    try {
      return structuredClone(obj);
    } catch {
      return JSON.parse(JSON.stringify(obj));
    }
  }

  function emit(eventName, payload) {
    // exact listeners
    const set = listeners.get(eventName);
    if (set && set.size) {
      set.forEach((fn) => {
        try {
          fn(payload);
        } catch (e) {
          console.error("[STATE] listener error:", e);
        }
      });
    }

    // wildcard listeners
    if (wildcards.size) {
      wildcards.forEach((fn) => {
        try {
          fn(eventName, payload);
        } catch (e) {
          console.error("[STATE] wildcard listener error:", e);
        }
      });
    }
  }

  function on(eventName, fn) {
    if (eventName === "*") {
      wildcards.add(fn);
      return () => wildcards.delete(fn);
    }
    if (!listeners.has(eventName)) listeners.set(eventName, new Set());
    listeners.get(eventName).add(fn);
    return () => off(eventName, fn);
  }

  function once(eventName, fn) {
    const unsub = on(eventName, (payload, maybePayload) => {
      // Si es wildcard, firma (eventName, payload)
      // Si es normal, firma (payload)
      unsub();
      if (eventName === "*") fn(payload, maybePayload);
      else fn(payload);
    });
    return unsub;
  }

  function off(eventName, fn) {
    if (eventName === "*") {
      wildcards.delete(fn);
      return;
    }
    const set = listeners.get(eventName);
    if (!set) return;
    set.delete(fn);
  }

  /* =========================
     GETTERS (solo lectura)
  ========================= */
  function getFacturas() {
    return store.facturas;
  }
  function getFiltered() {
    return store.filtered;
  }
  function getStats() {
    return store.stats;
  }
  function getFilters() {
    return store.filters;
  }
  function getMeta() {
    return store.meta;
  }

  /* =========================
     PRIVATE: set + optional cache
  ========================= */
  function _cacheSet(key, value) {
    if (!CACHE) return;
    try {
      CACHE.set(key, value);
    } catch {}
  }

  function _cacheGet(key) {
    if (!CACHE) return null;
    try {
      return CACHE.get(key);
    } catch {
      return null;
    }
  }

  /* =========================
     SETTERS (mutación controlada)
  ========================= */
  function setFacturas(rows, { silent = false } = {}) {
    store.facturas = Array.isArray(rows) ? rows : [];
    store.meta.lastLoadedAt = Date.now();

    // Opcional: persistir snapshot (si quieres)
    if (CFG?.CACHE?.ENABLED && CFG?.CACHE?.FACTURAS_KEY) {
      _cacheSet(CFG.CACHE.FACTURAS_KEY, store.facturas);
    }

    if (!silent) emit("facturas:changed", store.facturas);
    return store.facturas;
  }

  function setFiltered(rows, { silent = false } = {}) {
    store.filtered = Array.isArray(rows) ? rows : [];
    if (!silent) emit("filtered:changed", store.filtered);
    return store.filtered;
  }

  function setStats(stats, { silent = false } = {}) {
    store.stats = stats || null;
    store.meta.lastStatsAt = Date.now();

    if (CFG?.CACHE?.ENABLED && CFG?.CACHE?.STATS_KEY) {
      _cacheSet(CFG.CACHE.STATS_KEY, store.stats);
    }

    if (!silent) emit("stats:changed", store.stats);
    return store.stats;
  }

  function setFilters(next, { silent = false } = {}) {
    store.filters = {
      ...store.filters,
      ...(next || {}),
    };
    if (!silent) emit("filters:changed", store.filters);
    return store.filters;
  }

  function setBusy(isBusy, { silent = false } = {}) {
    store.meta.isBusy = !!isBusy;
    if (!silent) emit("meta:busy", store.meta.isBusy);
    return store.meta.isBusy;
  }

  function setError(msg, { silent = false } = {}) {
    store.meta.lastError = String(msg || "");
    if (!silent) emit("meta:error", store.meta.lastError);
    return store.meta.lastError;
  }

  /* =========================
     HELPERS DE NEGOCIO
  ========================= */

  function isPagoDelMes(fechaStr) {
    if (!fechaStr) return false;

    const base = String(fechaStr).trim().split(" ")[0];
    const p = base.split("/");
    if (p.length < 3) return false;

    const [, mes, anio] = p.map(Number);
    const hoy = new Date();

    return mes === hoy.getMonth() + 1 && anio === hoy.getFullYear();
  }

  function extractMetodos() {
    const set = new Set();
    store.facturas.forEach((f) => {
      const m = (f.metodo ?? "").toString().trim();
      if (m) set.add(m);
    });
    return [...set].sort((a, b) => a.localeCompare(b, "es"));
  }

  /* =========================
     BOOT: Hydrate desde cache (si hay)
  ========================= */
  function hydrateFromCache() {
    if (!CFG?.CACHE?.ENABLED) return;

    const facturasKey = CFG?.CACHE?.FACTURAS_KEY;
    const statsKey = CFG?.CACHE?.STATS_KEY;

    const cachedFacturas = facturasKey ? _cacheGet(facturasKey) : null;
    const cachedStats = statsKey ? _cacheGet(statsKey) : null;

    if (Array.isArray(cachedFacturas) && cachedFacturas.length) {
      DBG("STATE hydrate: facturas desde cache");
      setFacturas(cachedFacturas, { silent: true });
      // filtered por defecto = facturas hasta que app aplique filtros
      setFiltered(cachedFacturas, { silent: true });
    }

    if (cachedStats) {
      DBG("STATE hydrate: stats desde cache");
      setStats(cachedStats, { silent: true });
    }

    if ((cachedFacturas && cachedFacturas.length) || cachedStats) {
      emit("hydrate", { facturas: !!cachedFacturas, stats: !!cachedStats });
    }
  }

  /* Reset total */
  function reset({ keepCache = false } = {}) {
    const fresh = structuredCloneSafe(DEFAULTS);
    Object.assign(store, fresh);

    if (!keepCache && CFG?.CACHE?.ENABLED && CACHE) {
      try {
        CACHE.del?.(CFG.CACHE.FACTURAS_KEY);
        CACHE.del?.(CFG.CACHE.STATS_KEY);
      } catch {}
    }

    emit("reset", null);
  }

  /* =========================
     SNAPSHOTS (para debug)
  ========================= */
  function snapshot() {
    return structuredCloneSafe(store);
  }

  /* =========================
     PUBLIC API
  ========================= */
  const PUBLIC = Object.freeze({
    // events
    on,
    once,
    off,

    // getters
    getFacturas,
    getFiltered,
    getStats,
    getFilters,
    getMeta,

    // setters
    setFacturas,
    setFiltered,
    setStats,
    setFilters,
    setBusy,
    setError,

    // business helpers
    isPagoDelMes,
    extractMetodos,

    // tools
    reset,
    snapshot,

    // debug
    _dump: snapshot,
  });

  Object.defineProperty(window, "STATE", {
    value: PUBLIC,
    writable: false,
    configurable: false,
    enumerable: true,
  });

  // Hydrate al final (no dispara renders de una)
  hydrateFromCache();
})();
