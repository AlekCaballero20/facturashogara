"use strict";

/* ============================================================================
  FACTURAS HOGAR ALEK · config.js (vNext+++)
  - Un solo lugar para constants y flags
  - Exporta window.CFG (con freeze para evitar pisadas)
  - Helpers: debug logger + time helpers + cache helpers (opcional)
  - Config “segura”: valida URL y evita dobles cargas sin querer
============================================================================ */

/* =========================
   ENV / ENDPOINT
   (Cambia solo esto cuando migres)
========================= */
const SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbx5LlLSTdjj5YZdP7AZTf4i0BBKmD3OfWeoxgBZ9kxzTu9IW-WJXbeWbeLizBWbgfM/exec";

/* =========================
   BUILD CFG
========================= */
(function () {
  // Si ya existe CFG, no la pisamos (evita bugs raros por doble <script>)
  if (window.CFG) return;

  // Validación mínima de URL (sí, paranoia sana)
  let _scriptUrl = String(SCRIPT_URL || "").trim();
  try {
    // URL() también normaliza
    _scriptUrl = new URL(_scriptUrl).toString();
  } catch {
    console.warn("[CFG] SCRIPT_URL inválida. Revisa tu endpoint.");
  }

  const CFG = {
    /* API */
    SCRIPT_URL: _scriptUrl,

    /* UI/UX */
    APP_NAME: "Facturas Hogar Alek",
    DEBOUNCE_MS: 180,
    TOAST_MS: 3200,

    /* Cache (si luego metes localStorage para facturas/stats) */
    CACHE: {
      ENABLED: true,
      FACTURAS_KEY: "facturas_hogar_cache_v1",
      STATS_KEY: "facturas_hogar_stats_cache_v1",
      // TTL por defecto: 5 min
      TTL_MS: 1000 * 60 * 5,
    },

    /* Behavior */
    LIMITS: {
      // en modal "Pendientes"
      PENDIENTES_PREVIEW: 12,
    },

    /* Intl / Locale */
    LOCALE: "es-CO",
    CURRENCY: "COP",

    /* Debug */
    DEBUG: false,
  };

  /* Freeze superficial (evita que te lo pisen por accidente) */
  // (No deep freeze para no volverte loco si luego quieres mutar flags en runtime)
  Object.defineProperty(window, "CFG", {
    value: Object.freeze(CFG),
    writable: false,
    configurable: false,
    enumerable: true,
  });

  /* =========================
     OPTIONAL GLOBAL HELPERS
     (cómodos para debug y cache)
  ========================= */

  // Debug logger (no ensucia consola si DEBUG = false)
  Object.defineProperty(window, "__DBG__", {
    value: function (...args) {
      if (window.CFG && window.CFG.DEBUG) console.log("[DBG]", ...args);
    },
    writable: false,
    configurable: false,
    enumerable: false,
  });

  // Cache helpers (solo si CACHE.ENABLED)
  Object.defineProperty(window, "__CACHE__", {
    value: {
      get(key) {
        try {
          if (!window.CFG.CACHE.ENABLED) return null;
          const raw = localStorage.getItem(key);
          if (!raw) return null;

          const parsed = JSON.parse(raw);
          // { t: number, v: any }
          if (!parsed || typeof parsed.t !== "number") return null;

          const age = Date.now() - parsed.t;
          if (age > window.CFG.CACHE.TTL_MS) return null;

          return parsed.v ?? null;
        } catch {
          return null;
        }
      },
      set(key, value) {
        try {
          if (!window.CFG.CACHE.ENABLED) return false;
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
      clearAll() {
        try {
          localStorage.removeItem(window.CFG.CACHE.FACTURAS_KEY);
          localStorage.removeItem(window.CFG.CACHE.STATS_KEY);
        } catch {}
      },
    },
    writable: false,
    configurable: false,
    enumerable: false,
  });

  // Versión simple (si luego quieres mostrarla en footer)
  Object.defineProperty(window, "__APP__", {
    value: Object.freeze({
      NAME: CFG.APP_NAME,
      VERSION: "1.0.0",
      BUILD: "vNext+++",
    }),
    writable: false,
    configurable: false,
    enumerable: false,
  });
})();
