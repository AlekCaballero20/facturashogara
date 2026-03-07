"use strict";

/* ============================================================================
  FACTURAS HOGAR ALEK · config.js (Pro v2)
  - Un solo lugar para constants, flags y límites
  - Exporta window.CFG (con freeze superficial)
  - Helpers globales: debug, cache, app meta
  - Config segura: valida URL y evita dobles cargas
============================================================================ */

/* =========================
   ENV / ENDPOINT
   (Cambia solo esto cuando migres)
========================= */
const SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbz75jA0ReegbfBr4yO0zZh41KnlRAfFocQgsSUh2kRaV2A1IQLZAG9AyasRtw6IYrM7/exec";

/* =========================
   BUILD CFG
========================= */
(function () {
  if (window.CFG) return;

  let _scriptUrl = String(SCRIPT_URL || "").trim();
  try {
    _scriptUrl = new URL(_scriptUrl).toString();
  } catch {
    console.warn("[CFG] SCRIPT_URL inválida. Revisa tu endpoint.");
  }

  const CFG = {
    /* API */
    SCRIPT_URL: _scriptUrl,

    API: {
      TIMEOUT_MS: 15000,
      RETRY: 1,
    },

    /* APP */
    APP_NAME: "Facturas Hogar Alek",
    APP_SUBTITLE: "Control de pagos · Hogar · Histórico y analítica",

    /* UI/UX */
    DEBOUNCE_MS: 180,
    TOAST_MS: 3200,

    /* Cache */
    CACHE: {
      ENABLED: true,

      FACTURAS_KEY: "facturas_hogar_cache_v1",
      STATS_KEY: "facturas_hogar_stats_cache_v1",
      HISTORICO_KEY: "facturas_hogar_historico_cache_v1",

      // TTL global por defecto: 5 min
      TTL_MS: 1000 * 60 * 5,
    },

    /* Behavior / Limits */
    LIMITS: {
      PENDIENTES_PREVIEW: 12,
      HISTORY_PREVIEW: 100,
      TOP_FACTURAS: 20,
      TOP_METODOS: 12,
      MONTHS_PREVIEW: 18,
    },

    /* Features */
    FEATURES: {
      QUICK_PAY: true,
      HISTORICO: true,
      PROYECCION: true,
      EDIT_METODO: true,
      EDIT_VALOR: true,
      EXPORT: false,
      IMPORT: false,
    },

    /* Default values */
    DEFAULTS: {
      STATS_TAB: "resumen",
      HISTORY_YEAR: "all",
      HISTORY_METHOD: "all",
    },

    /* Intl / Locale */
    LOCALE: "es-CO",
    CURRENCY: "COP",
    TIMEZONE: "America/Bogota",

    /* Debug */
    DEBUG: false,
  };

  Object.defineProperty(window, "CFG", {
    value: Object.freeze(CFG),
    writable: false,
    configurable: false,
    enumerable: true,
  });

  /* =========================
     OPTIONAL GLOBAL HELPERS
  ========================= */

  Object.defineProperty(window, "__DBG__", {
    value: function (...args) {
      if (window.CFG && window.CFG.DEBUG) {
        console.log("[DBG]", ...args);
      }
    },
    writable: false,
    configurable: false,
    enumerable: false,
  });

  Object.defineProperty(window, "__CACHE__", {
    value: {
      get(key) {
        try {
          if (!window.CFG?.CACHE?.ENABLED) return null;

          const raw = localStorage.getItem(key);
          if (!raw) return null;

          const parsed = JSON.parse(raw);
          if (!parsed || typeof parsed.t !== "number") return null;

          const age = Date.now() - parsed.t;
          if (age > (window.CFG?.CACHE?.TTL_MS ?? 0)) return null;

          return parsed.v ?? null;
        } catch {
          return null;
        }
      },

      set(key, value) {
        try {
          if (!window.CFG?.CACHE?.ENABLED) return false;
          localStorage.setItem(key, JSON.stringify({ t: Date.now(), v: value }));
          return true;
        } catch {
          return false;
        }
      },

      del(key) {
        try {
          localStorage.removeItem(key);
        } catch {}
      },

      has(key) {
        try {
          return localStorage.getItem(key) != null;
        } catch {
          return false;
        }
      },

      clearAll() {
        try {
          const keys = [
            window.CFG?.CACHE?.FACTURAS_KEY,
            window.CFG?.CACHE?.STATS_KEY,
            window.CFG?.CACHE?.HISTORICO_KEY,
          ].filter(Boolean);

          keys.forEach((k) => localStorage.removeItem(k));
        } catch {}
      },

      keys() {
        try {
          return [
            window.CFG?.CACHE?.FACTURAS_KEY,
            window.CFG?.CACHE?.STATS_KEY,
            window.CFG?.CACHE?.HISTORICO_KEY,
          ].filter(Boolean);
        } catch {
          return [];
        }
      },
    },
    writable: false,
    configurable: false,
    enumerable: false,
  });

  Object.defineProperty(window, "__APP__", {
    value: Object.freeze({
      NAME: CFG.APP_NAME,
      VERSION: "2.0.0",
      BUILD: "pro-v2",
      TZ: CFG.TIMEZONE,
      LOCALE: CFG.LOCALE,
    }),
    writable: false,
    configurable: false,
    enumerable: false,
  });

  Object.defineProperty(window, "__TIME__", {
    value: Object.freeze({
      now() {
        return Date.now();
      },
      todayInputValue() {
        const d = new Date();
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
      },
    }),
    writable: false,
    configurable: false,
    enumerable: false,
  });
})();