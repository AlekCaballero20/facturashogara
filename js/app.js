"use strict";

/* ============================================================================
  FACTURAS HOGAR ALEK · app.js (Orchestrator vNext+++++)
  - Boot robusto (anti doble carga)
  - No ensucia el scope global con const CFG/STATE/API/UI
  - Refresh anti-race + UX: busy, disable botones, toasts
  - Modal: open/close + focus trap + tabs
  - Delegación: editar valor/método + registrar pago
============================================================================ */

(() => {
  // Anti doble carga (si por accidente incluyes app.js 2 veces)
  if (window.__FACTURAS_APP_LOADED__) {
    console.warn("[BOOT] app.js ya estaba cargado. Evito doble init.");
    return;
  }
  window.__FACTURAS_APP_LOADED__ = true;

  /* =========================
     REQUIRED MODULES
  ========================= */
  const CFG = window.CFG;
  const STATE = window.STATE;
  const API = window.API;
  const UI = window.UI;

  /* =========================
     HARD GUARDS (fail fast)
  ========================= */
  function fail(msg) {
    console.error(msg);
    const el = document.querySelector("#mensaje");
    if (el) {
      el.textContent = msg;
      el.className = "error";
      el.classList.remove("hide");
    }
  }

  (function assertModules() {
    const missing = [];
    if (!CFG) missing.push("CFG (config.js)");
    if (!STATE) missing.push("STATE (state.js)");
    if (!API) missing.push("API (services.api.js)");
    if (!UI) missing.push("UI (ui.render.js)");

    if (missing.length) {
      fail("❌ Faltan módulos JS: " + missing.join(", ") + ". Revisa rutas y orden de <script>.");
      // Salimos: sin módulos no hay app
      throw new Error("Missing modules: " + missing.join(", "));
    }
  })();

  /* =========================
     DOM CACHE
  ========================= */
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  const els = {
    tbody: $("#tbody"),
    empty: $("#emptyState"),
    q: $("#q"),
    fEstado: $("#fEstado"),
    fMetodo: $("#fMetodo"),
    btnClearFilters: $("#btnClearFilters"),
    btnRefresh: $("#btnRefresh"),
    btnStats: $("#btnStats"),
    statsModal: $("#statsModal"),
    btnCloseStats: $("#btnCloseStats"),
    tabs: $$(".tab"),
    tabPanels: $$(".tab-panel"),
  };

  /* =========================
     UTILS
  ========================= */
  function debounce(fn, wait = 180) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  const money = new Intl.NumberFormat(CFG?.LOCALE ?? "es-CO", {
    style: "currency",
    currency: CFG?.CURRENCY ?? "COP",
    maximumFractionDigits: 0,
  });

  function fmtCOP(n) {
    return money.format(Number(n || 0));
  }

  function parseCOP(str) {
    if (str == null) return null;
    const digits = String(str).replace(/[^\d]/g, "");
    if (!digits) return null;
    return Number(digits);
  }

  function esPagoDelMes(fechaStr) {
    if (STATE && typeof STATE.isPagoDelMes === "function") return STATE.isPagoDelMes(fechaStr);

    if (!fechaStr) return false;
    const base = String(fechaStr).trim().split(" ")[0];
    const p = base.split("/");
    if (p.length < 3) return false;
    const [, mes, anio] = p.map(Number);
    const hoy = new Date();
    return mes === hoy.getMonth() + 1 && anio === hoy.getFullYear();
  }

  /* =========================
     FILTERS + KPIs
  ========================= */
  function buildMetodoOptions() {
    if (!els.fMetodo) return;

    const methods =
      STATE && typeof STATE.extractMetodos === "function"
        ? STATE.extractMetodos()
        : (() => {
            const set = new Set();
            (STATE.getFacturas?.() ?? STATE.facturas ?? []).forEach((f) => {
              const m = (f.metodo ?? "").toString().trim();
              if (m) set.add(m);
            });
            return [...set].sort((a, b) => a.localeCompare(b, "es"));
          })();

    els.fMetodo.innerHTML =
      `<option value="all">Todos</option>` +
      methods.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join("");
  }

  function applyFilters() {
    const q = (els.q?.value || "").toLowerCase().trim();
    const estado = els.fEstado?.value || "all";
    const metodo = els.fMetodo?.value || "all";

    if (STATE && typeof STATE.setFilters === "function") STATE.setFilters({ q, estado, metodo });
    else STATE.filters = { q, estado, metodo };

    const facturas =
      (STATE && typeof STATE.getFacturas === "function" ? STATE.getFacturas() : STATE.facturas) || [];

    const out = facturas.filter((f) => {
      const pagado = esPagoDelMes(f.ultimo);

      if (estado === "pagado" && !pagado) return false;
      if (estado === "pendiente" && pagado) return false;

      const m = (f.metodo ?? "").toString().trim();
      if (metodo !== "all" && m !== metodo) return false;

      if (q) {
        const hay =
          (f.nombre ?? "").toString().toLowerCase().includes(q) ||
          (f.referencia ?? "").toString().toLowerCase().includes(q);
        if (!hay) return false;
      }
      return true;
    });

    if (STATE && typeof STATE.setFiltered === "function") STATE.setFiltered(out);
    else STATE.filtered = out;

    UI?.renderTable?.(out);

    const has = out.length > 0;
    els.empty?.classList.toggle("hide", has);
    if (els.tbody && !has) els.tbody.textContent = "";
  }

  function updateKPIs() {
    const facturas =
      (STATE && typeof STATE.getFacturas === "function" ? STATE.getFacturas() : STATE.facturas) || [];
    UI?.renderKPIs?.(facturas);
  }

  /* =========================
     MODAL: open/close + focus handling
  ========================= */
  let lastFocusEl = null;

  function switchTab(key) {
    els.tabs.forEach((t) => {
      const on = t.dataset.tab === key;
      t.classList.toggle("is-active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });

    els.tabPanels.forEach((p) => {
      const match = p.id.toLowerCase().includes(key);
      p.classList.toggle("hide", !match);
    });
  }

  function openStatsModal() {
    if (!els.statsModal) return;
    lastFocusEl = document.activeElement;

    els.statsModal.classList.remove("hide");
    document.body.style.overflow = "hidden";

    (els.btnCloseStats || els.statsModal)?.focus?.();
    switchTab("resumen");
  }

  function closeStatsModal() {
    if (!els.statsModal) return;
    els.statsModal.classList.add("hide");
    document.body.style.overflow = "";

    lastFocusEl?.focus?.();
    lastFocusEl = null;
  }

  function trapFocusInModal(ev) {
    if (!els.statsModal || els.statsModal.classList.contains("hide")) return;
    if (ev.key !== "Tab") return;

    const focusables = els.statsModal.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const list = Array.from(focusables).filter(
      (el) => !el.hasAttribute("disabled") && !el.classList.contains("hide")
    );
    if (!list.length) return;

    const first = list[0];
    const last = list[list.length - 1];

    if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault();
      first.focus();
    }
  }

  async function loadStats() {
    const body = $("#statsBody");
    const met = $("#statsMetodos");
    const mes = $("#statsMeses");
    const pen = $("#statsPendientes");

    body && (body.innerHTML = `<p class="muted">Cargando estadísticas…</p>`);
    met && (met.innerHTML = `<p class="muted">Cargando métodos…</p>`);
    mes && (mes.innerHTML = `<p class="muted">Cargando meses…</p>`);
    pen && (pen.innerHTML = `<p class="muted">Cargando pendientes…</p>`);

    try {
      UI?.setBusy?.(true);
      const s = await API.stats();

      STATE?.setStats?.(s);
      const facturas = STATE?.getFacturas?.() ?? STATE.facturas ?? [];

      UI?.renderStats?.(s, facturas);
    } catch (err) {
      const msg = `❌ Error: ${escapeHtml(err.message)}`;
      body && (body.innerHTML = `<p class="muted">${msg}</p>`);
      met && (met.innerHTML = `<p class="muted">${msg}</p>`);
      mes && (mes.innerHTML = `<p class="muted">${msg}</p>`);
      pen && (pen.innerHTML = `<p class="muted">${msg}</p>`);
    } finally {
      UI?.setBusy?.(false);
    }
  }

  /* =========================
     EDITABLE CELLS (delegated)
  ========================= */
  function setCellTextSafely(cell, text) {
    cell.textContent = text;
  }

  document.addEventListener("focusin", (ev) => {
    const cellValor = ev.target.closest(".editable.valor");
    const cellMetodo = ev.target.closest(".editable.metodo");

    if (cellValor) {
      const v = Number(cellValor.dataset.valor || 0);
      cellValor.dataset.orig = String(v);
      setCellTextSafely(cellValor, String(v));
      cellValor.classList.add("editing");
      return;
    }

    if (cellMetodo) {
      const orig = (cellMetodo.dataset.metodo || "").trim();
      cellMetodo.dataset.origMetodo = orig;
      setCellTextSafely(cellMetodo, orig);
      cellMetodo.classList.add("editing");
    }
  });

  document.addEventListener("input", (ev) => {
    const cell = ev.target.closest(".editable.valor");
    if (!cell) return;

    const digits = cell.textContent.replace(/[^\d]/g, "");
    if (cell.textContent !== digits) setCellTextSafely(cell, digits);
  });

  document.addEventListener("keydown", (ev) => {
    const cellValor = ev.target.closest(".editable.valor");
    const cellMetodo = ev.target.closest(".editable.metodo");
    if (!cellValor && !cellMetodo) return;

    if (ev.key === "Enter") {
      ev.preventDefault();
      (cellValor || cellMetodo).blur();
      return;
    }

    if (ev.key === "Escape") {
      ev.preventDefault();

      if (cellValor) {
        const origNum = Number(cellValor.dataset.orig || cellValor.dataset.valor || 0);
        setCellTextSafely(cellValor, fmtCOP(origNum));
        cellValor.blur();
        return;
      }

      if (cellMetodo) {
        const orig = (cellMetodo.dataset.origMetodo || cellMetodo.dataset.metodo || "").trim();
        setCellTextSafely(cellMetodo, orig || "—");
        cellMetodo.blur();
      }
    }
  });

  document.addEventListener(
    "focusout",
    async (ev) => {
      const cell = ev.target.closest(".editable.valor");
      if (!cell) return;

      cell.classList.remove("editing");

      const tr = cell.closest("tr");
      const row = Number(tr?.dataset?.row);

      const origNum = Number(cell.dataset.orig || cell.dataset.valor || 0);
      const newNum = parseCOP(cell.textContent);

      if (!Number.isFinite(row) || newNum === null || newNum === origNum) {
        setCellTextSafely(cell, fmtCOP(origNum));
        return;
      }

      try {
        await API.editarValor(row, newNum);
        cell.dataset.valor = String(newNum);
        setCellTextSafely(cell, fmtCOP(newNum));
        UI.toast?.("Valor actualizado 💰", "ok");
        updateKPIs();
      } catch (err) {
        console.error(err);
        setCellTextSafely(cell, fmtCOP(origNum));
        UI.toast?.("Error al editar valor: " + err.message, "error");
      }
    },
    true
  );

  document.addEventListener(
    "focusout",
    async (ev) => {
      const cell = ev.target.closest(".editable.metodo");
      if (!cell) return;

      cell.classList.remove("editing");

      const tr = cell.closest("tr");
      const row = Number(tr?.dataset?.row);

      const orig = (cell.dataset.origMetodo || "").trim();
      const nuevo = (cell.textContent || "").trim();

      if (!Number.isFinite(row) || nuevo === orig) {
        cell.dataset.metodo = orig;
        setCellTextSafely(cell, orig || "—");
        return;
      }

      try {
        await API.editarMetodo(row, nuevo);
        cell.dataset.metodo = nuevo;
        setCellTextSafely(cell, nuevo || "—");
        UI.toast?.("Método actualizado 💳", "ok");

        buildMetodoOptions();
        updateKPIs();
      } catch (err) {
        console.error(err);
        cell.dataset.metodo = orig;
        setCellTextSafely(cell, orig || "—");
        UI.toast?.("Error al editar método: " + err.message, "error");
      }
    },
    true
  );

  /* =========================
     Registrar pago (delegated)
  ========================= */
  document.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("button[data-action='registrar']");
    if (!btn) return;

    const row = Number(btn.dataset.row);
    const tr = btn.closest("tr");
    if (!Number.isFinite(row)) return;

    btn.disabled = true;
    const prevTxt = btn.textContent;
    btn.textContent = "⏳";

    try {
      const r = await API.registrarPago(row);
      const fecha = r?.fecha ?? "";

      const $fecha = tr?.querySelector(".fecha");
      const $estado = tr?.querySelector(".estado");

      if ($fecha) $fecha.textContent = fecha || "";
      if ($estado) {
        $estado.innerHTML = esPagoDelMes(fecha)
          ? `<span class="badge ok">Pagado</span>`
          : `<span class="badge pendiente">Pendiente</span>`;
      }

      UI.toast?.("Pago registrado ✅", "ok");
      await refresh();
    } catch (err) {
      console.error(err);
      UI.toast?.("Error al registrar: " + err.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = prevTxt || "Registrar";
    }
  });

  /* =========================
     EVENTS: filters + refresh + modal + tabs
  ========================= */
  const onSearch = debounce(applyFilters, CFG?.DEBOUNCE_MS ?? 180);

  els.q?.addEventListener("input", onSearch);
  els.fEstado?.addEventListener("change", applyFilters);
  els.fMetodo?.addEventListener("change", applyFilters);

  els.btnClearFilters?.addEventListener("click", () => {
    if (els.q) els.q.value = "";
    if (els.fEstado) els.fEstado.value = "all";
    if (els.fMetodo) els.fMetodo.value = "all";
    applyFilters();
  });

  els.btnRefresh?.addEventListener("click", refresh);

  els.btnStats?.addEventListener("click", async () => {
    openStatsModal();
    await loadStats();
  });

  els.btnCloseStats?.addEventListener("click", closeStatsModal);

  document.addEventListener("click", (ev) => {
    if (ev.target.closest("[data-close='stats']")) closeStatsModal();
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && els.statsModal && !els.statsModal.classList.contains("hide")) {
      closeStatsModal();
      return;
    }
    trapFocusInModal(ev);
  });

  els.tabs.forEach((t) => t.addEventListener("click", () => switchTab(t.dataset.tab)));

  /* =========================
     DATA FLOW: refresh + boot (anti-race)
  ========================= */
  let refreshToken = 0;

  async function refresh() {
    const token = ++refreshToken;

    try {
      UI?.setBusy?.(true);
      els.btnRefresh && (els.btnRefresh.disabled = true);

      const rows = await API.listarFacturas();

      if (token !== refreshToken) return;

      STATE?.setFacturas?.(rows);
      buildMetodoOptions();
      updateKPIs();

      // Si STATE trae filtros guardados, aplicarlos al boot
      const saved = STATE?.getFilters?.() ?? STATE.filters ?? null;
      if (saved) {
        if (els.q && typeof saved.q === "string") els.q.value = saved.q;
        if (els.fEstado && saved.estado) els.fEstado.value = saved.estado;
        if (els.fMetodo && saved.metodo) els.fMetodo.value = saved.metodo;
      }

      applyFilters();
    } catch (err) {
      if (token !== refreshToken) return;

      console.error(err);
      if (els.tbody) els.tbody.textContent = "";
      els.empty?.classList.remove("hide");

      UI.toast?.("Error cargando: " + err.message, "error");
    } finally {
      if (token === refreshToken) {
        UI?.setBusy?.(false);
        els.btnRefresh && (els.btnRefresh.disabled = false);
      }
    }
  }

  function boot() {
    refresh();
  }

  boot();
})();
