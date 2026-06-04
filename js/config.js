"use strict";

const SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbxqXKF7GW0PMJPRPUcPjuaoGTTpVozpgYFxAqPd6QrYtyW63f4w80PeaXO0NrO5wiY/exec";

(function () {
  if (window.CFG) return;

  const CFG = {
    SCRIPT_URL,
    API_KEY: "",
    API: { TIMEOUT_MS: 18000, RETRY: 1 },
    APP: {
      NAME: "Hogar Manager · Facturas",
      SUBTITLE: "Control mensual de pagos, vencimientos e historial",
    },
    FEATURES: {
      QUICK_PAY: true,
      HISTORICO: true,
      PROYECCION: true,
      EDIT_FACTURA: true,
      CIERRE_MENSUAL: true,
      EXPORT: true,
      RECORDATORIOS: true,
    },
    LIMITS: {
      TOP_FACTURAS: 20,
      TOP_METODOS: 12,
      TOP_CATEGORIAS: 12,
      MONTHS_PREVIEW: 18,
      HISTORY_PREVIEW: 120,
    },
    CACHE: {
      ENABLED: true,
      TTL_MS: 1000 * 60 * 5,
      FACTURAS_KEY: "hm_facturas_v3",
      STATS_KEY: "hm_stats_v3",
      HISTORICO_KEY: "hm_historico_v3",
    },
    LOCALE: "es-CO",
    CURRENCY: "COP",
    TIMEZONE: "America/Bogota",
    TOAST_MS: 3200,
    DEBOUNCE_MS: 180,
    DEBUG: false,
  };

  Object.defineProperty(window, "CFG", { value: Object.freeze(CFG) });
  Object.defineProperty(window, "__DBG__", {
    value: (...args) => CFG.DEBUG && console.log("[HM]", ...args),
  });
  Object.defineProperty(window, "__TIME__", {
    value: Object.freeze({
      todayInputValue(date = new Date()) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      },
      monthInputValue(date = new Date()) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      },
    }),
  });
  Object.defineProperty(window, "__CACHE__", {
    value: {
      get(key) {
        try {
          const raw = localStorage.getItem(key);
          if (!raw) return null;
          const parsed = JSON.parse(raw);
          if (!parsed || Date.now() - parsed.t > CFG.CACHE.TTL_MS) return null;
          return parsed.v;
        } catch {
          return null;
        }
      },
      set(key, value) {
        try {
          localStorage.setItem(key, JSON.stringify({ t: Date.now(), v: value }));
        } catch {}
      },
      del(key) {
        try { localStorage.removeItem(key); } catch {}
      },
      clearAll() {
        [CFG.CACHE.FACTURAS_KEY, CFG.CACHE.STATS_KEY, CFG.CACHE.HISTORICO_KEY].forEach((k) => this.del(k));
      },
    },
  });
})();
