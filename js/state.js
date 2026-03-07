"use strict";

/* ============================================================================
   FACTURAS HOGAR ALEK · state.js (Pro v2)
   - Estado centralizado:
     facturas, filtered, stats, historico, filtros principales, filtros histórico, ui, meta
   - Pub/Sub liviano (on/off/once) + wildcard
   - Mutación controlada + snapshots seguros
   - Helpers de negocio (isPagoDelMes, extractMetodos, extractHistoricoYears, etc.)
   - Persistencia opcional (si existe __CACHE__)
   - Protecciones: no pisar window.STATE si ya existe
============================================================================ */

(function () {
  if (window.STATE) return;

  const CFG = window.CFG || {};
  const DBG = window.__DBG__ || (() => {});
  const CACHE = window.__CACHE__ || null;

  const CACHE_KEYS = Object.freeze({
    FACTURAS: CFG?.CACHE?.FACTURAS_KEY || "facturas_hogar_cache_v1",
    STATS: CFG?.CACHE?.STATS_KEY || "facturas_hogar_stats_cache_v1",
    HISTORICO: "facturas_hogar_historico_cache_v1",
  });

  const DEFAULTS = Object.freeze({
    facturas: [],
    filtered: [],
    stats: null,

    historico: [],
    historicoFiltered: [],

    filters: {
      q: "",
      estado: "all",   // all | pagado | pendiente
      metodo: "all",   // all | "Nequi" | "Daviplata" | etc
    },

    historyFilters: {
      q: "",
      year: "all",
      method: "all",
    },

    ui: {
      activeStatsTab: "resumen",
      loadedStatsTabs: ["resumen"],
      statsOpen: false,
      quickPayOpen: false,
    },

    meta: {
      lastLoadedAt: 0,
      lastStatsAt: 0,
      lastHistoricoAt: 0,
      isBusy: false,
      lastError: "",
      version: 2,
    },
  });

  /* =========================
     INTERNAL STORE
  ========================= */
  const store = structuredCloneSafe(DEFAULTS);

  const listeners = new Map();
  const wildcards = new Set();

  function structuredCloneSafe(obj) {
    try {
      return structuredClone(obj);
    } catch {
      return JSON.parse(JSON.stringify(obj));
    }
  }

  function emit(eventName, payload) {
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
     PRIVATE CACHE HELPERS
  ========================= */
  function _cacheSet(key, value) {
    if (!CACHE || !CFG?.CACHE?.ENABLED || !key) return;
    try {
      CACHE.set(key, value);
    } catch {}
  }

  function _cacheGet(key) {
    if (!CACHE || !CFG?.CACHE?.ENABLED || !key) return null;
    try {
      return CACHE.get(key);
    } catch {
      return null;
    }
  }

  function _cacheDel(key) {
    if (!CACHE || !key) return;
    try {
      CACHE.del?.(key);
    } catch {}
  }

  function _touchMeta(key) {
    store.meta[key] = Date.now();
  }

  /* =========================
     NORMALIZERS / HELPERS
  ========================= */
  function safeArray(v) {
    return Array.isArray(v) ? v : [];
  }

  function normalizeText(v) {
    return String(v ?? "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function parseDateFlexible(v) {
    if (!v) return null;
    if (v instanceof Date && !isNaN(v.getTime())) return v;

    const s = String(v).trim();

    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) {
      const d = Number(m[1]);
      const mo = Number(m[2]) - 1;
      const y = Number(m[3].length === 2 ? "20" + m[3] : m[3]);
      const dt = new Date(y, mo, d);
      return isNaN(dt.getTime()) ? null : dt;
    }

    const dt = new Date(s);
    return isNaN(dt.getTime()) ? null : dt;
  }

  function getYearFromDateLike(v) {
    const dt = parseDateFlexible(v);
    return dt ? String(dt.getFullYear()) : "";
  }

  function getMonthKeyFromDateLike(v) {
    const dt = parseDateFlexible(v);
    if (!dt) return "";
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
  }

  /* =========================
     GETTERS (SOLO LECTURA)
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

  function getHistorico() {
    return store.historico;
  }

  function getHistoricoFiltered() {
    return store.historicoFiltered;
  }

  function getFilters() {
    return store.filters;
  }

  function getHistoryFilters() {
    return store.historyFilters;
  }

  function getUI() {
    return store.ui;
  }

  function getMeta() {
    return store.meta;
  }

  /* =========================
     SETTERS (MUTACIÓN CONTROLADA)
  ========================= */
  function setFacturas(rows, { silent = false } = {}) {
    store.facturas = safeArray(rows);
    _touchMeta("lastLoadedAt");

    _cacheSet(CACHE_KEYS.FACTURAS, store.facturas);

    if (!silent) emit("facturas:changed", store.facturas);
    return store.facturas;
  }

  function setFiltered(rows, { silent = false } = {}) {
    store.filtered = safeArray(rows);
    if (!silent) emit("filtered:changed", store.filtered);
    return store.filtered;
  }

  function setStats(stats, { silent = false } = {}) {
    store.stats = stats || null;
    _touchMeta("lastStatsAt");

    _cacheSet(CACHE_KEYS.STATS, store.stats);

    if (!silent) emit("stats:changed", store.stats);
    return store.stats;
  }

  function setHistorico(rows, { silent = false } = {}) {
    store.historico = safeArray(rows);
    _touchMeta("lastHistoricoAt");

    _cacheSet(CACHE_KEYS.HISTORICO, store.historico);

    if (!silent) emit("historico:changed", store.historico);
    return store.historico;
  }

  function setHistoricoFiltered(rows, { silent = false } = {}) {
    store.historicoFiltered = safeArray(rows);
    if (!silent) emit("historico:filtered:changed", store.historicoFiltered);
    return store.historicoFiltered;
  }

  function setFilters(next, { silent = false } = {}) {
    store.filters = {
      ...store.filters,
      ...(next || {}),
    };
    if (!silent) emit("filters:changed", store.filters);
    return store.filters;
  }

  function setHistoryFilters(next, { silent = false } = {}) {
    store.historyFilters = {
      ...store.historyFilters,
      ...(next || {}),
    };
    if (!silent) emit("historyFilters:changed", store.historyFilters);
    return store.historyFilters;
  }

  function setUI(next, { silent = false } = {}) {
    store.ui = {
      ...store.ui,
      ...(next || {}),
    };
    if (!silent) emit("ui:changed", store.ui);
    return store.ui;
  }

  function setActiveStatsTab(tab, { silent = false } = {}) {
    store.ui.activeStatsTab = String(tab || "resumen");
    if (!silent) emit("ui:activeStatsTab", store.ui.activeStatsTab);
    return store.ui.activeStatsTab;
  }

  function markStatsTabLoaded(tab, { silent = false } = {}) {
    const key = String(tab || "").trim();
    if (!key) return store.ui.loadedStatsTabs;

    if (!Array.isArray(store.ui.loadedStatsTabs)) {
      store.ui.loadedStatsTabs = [];
    }
    if (!store.ui.loadedStatsTabs.includes(key)) {
      store.ui.loadedStatsTabs.push(key);
    }

    if (!silent) emit("ui:loadedStatsTabs", store.ui.loadedStatsTabs);
    return store.ui.loadedStatsTabs;
  }

  function setStatsOpen(isOpen, { silent = false } = {}) {
    store.ui.statsOpen = !!isOpen;
    if (!silent) emit("ui:statsOpen", store.ui.statsOpen);
    return store.ui.statsOpen;
  }

  function setQuickPayOpen(isOpen, { silent = false } = {}) {
    store.ui.quickPayOpen = !!isOpen;
    if (!silent) emit("ui:quickPayOpen", store.ui.quickPayOpen);
    return store.ui.quickPayOpen;
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

  function clearError({ silent = false } = {}) {
    store.meta.lastError = "";
    if (!silent) emit("meta:error", store.meta.lastError);
    return store.meta.lastError;
  }

  /* =========================
     HELPERS DE NEGOCIO
  ========================= */
  function isPagoDelMes(fechaStr) {
    const dt = parseDateFlexible(fechaStr);
    if (!dt) return false;

    const hoy = new Date();
    return dt.getMonth() === hoy.getMonth() && dt.getFullYear() === hoy.getFullYear();
  }

  function extractMetodos() {
    const set = new Set();
    store.facturas.forEach((f) => {
      const m = String(f?.metodo ?? "").trim();
      if (m) set.add(m);
    });
    return [...set].sort((a, b) => a.localeCompare(b, "es"));
  }

  function extractHistoricoMetodos() {
    const set = new Set();
    store.historico.forEach((r) => {
      const m = String(r?.metodo ?? "").trim();
      if (m) set.add(m);
    });
    return [...set].sort((a, b) => a.localeCompare(b, "es"));
  }

  function extractHistoricoYears() {
    const set = new Set();
    store.historico.forEach((r) => {
      const y = getYearFromDateLike(r?.fecha);
      if (y) set.add(y);
    });
    return [...set].sort((a, b) => b.localeCompare(a));
  }

  function getTopMetodoFromFacturas() {
    const acc = Object.create(null);

    store.facturas.forEach((f) => {
      const metodo = String(f?.metodo ?? "").trim();
      if (!metodo) return;
      const valor = Number(String(f?.valor ?? "").replace(/[^\d]/g, "")) || 0;
      acc[metodo] = (acc[metodo] || 0) + valor;
    });

    const top = Object.entries(acc).sort((a, b) => b[1] - a[1])[0];
    return top ? { metodo: top[0], total: top[1] } : null;
  }

  function getPendientesActuales() {
    return store.facturas.filter((f) => !isPagoDelMes(f?.ultimo));
  }

  /* =========================
     BOOT: HYDRATE DESDE CACHE
  ========================= */
  function hydrateFromCache() {
    if (!CFG?.CACHE?.ENABLED) return;

    const cachedFacturas = _cacheGet(CACHE_KEYS.FACTURAS);
    const cachedStats = _cacheGet(CACHE_KEYS.STATS);
    const cachedHistorico = _cacheGet(CACHE_KEYS.HISTORICO);

    let hydratedSomething = false;

    if (Array.isArray(cachedFacturas) && cachedFacturas.length) {
      DBG("STATE hydrate: facturas desde cache");
      setFacturas(cachedFacturas, { silent: true });
      setFiltered(cachedFacturas, { silent: true });
      hydratedSomething = true;
    }

    if (cachedStats) {
      DBG("STATE hydrate: stats desde cache");
      setStats(cachedStats, { silent: true });
      hydratedSomething = true;
    }

    if (Array.isArray(cachedHistorico) && cachedHistorico.length) {
      DBG("STATE hydrate: histórico desde cache");
      setHistorico(cachedHistorico, { silent: true });
      setHistoricoFiltered(cachedHistorico, { silent: true });
      hydratedSomething = true;
    }

    if (hydratedSomething) {
      emit("hydrate", {
        facturas: !!cachedFacturas,
        stats: !!cachedStats,
        historico: !!cachedHistorico,
      });
    }
  }

  /* =========================
     RESET / TOOLS
  ========================= */
  function reset({ keepCache = false } = {}) {
    const fresh = structuredCloneSafe(DEFAULTS);

    Object.keys(store).forEach((k) => delete store[k]);
    Object.assign(store, fresh);

    if (!keepCache) {
      _cacheDel(CACHE_KEYS.FACTURAS);
      _cacheDel(CACHE_KEYS.STATS);
      _cacheDel(CACHE_KEYS.HISTORICO);
    }

    emit("reset", null);
  }

  function snapshot() {
    return structuredCloneSafe(store);
  }

  function replaceAll(nextState, { silent = false } = {}) {
    const fresh = structuredCloneSafe(DEFAULTS);
    const merged = {
      ...fresh,
      ...(nextState || {}),
      filters: {
        ...fresh.filters,
        ...(nextState?.filters || {}),
      },
      historyFilters: {
        ...fresh.historyFilters,
        ...(nextState?.historyFilters || {}),
      },
      ui: {
        ...fresh.ui,
        ...(nextState?.ui || {}),
      },
      meta: {
        ...fresh.meta,
        ...(nextState?.meta || {}),
      },
    };

    Object.keys(store).forEach((k) => delete store[k]);
    Object.assign(store, merged);

    if (!silent) emit("replaceAll", snapshot());
    return store;
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
    getHistorico,
    getHistoricoFiltered,
    getFilters,
    getHistoryFilters,
    getUI,
    getMeta,

    // setters
    setFacturas,
    setFiltered,
    setStats,
    setHistorico,
    setHistoricoFiltered,
    setFilters,
    setHistoryFilters,
    setUI,
    setActiveStatsTab,
    markStatsTabLoaded,
    setStatsOpen,
    setQuickPayOpen,
    setBusy,
    setError,
    clearError,

    // helpers
    normalizeText,
    parseDateFlexible,
    getYearFromDateLike,
    getMonthKeyFromDateLike,
    isPagoDelMes,
    extractMetodos,
    extractHistoricoMetodos,
    extractHistoricoYears,
    getTopMetodoFromFacturas,
    getPendientesActuales,

    // tools
    reset,
    snapshot,
    replaceAll,

    // debug
    _dump: snapshot,
  });

  Object.defineProperty(window, "STATE", {
    value: PUBLIC,
    writable: false,
    configurable: false,
    enumerable: true,
  });

  hydrateFromCache();
})();