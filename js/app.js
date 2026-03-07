"use strict";

/* ============================================================================
  FACTURAS HOGAR ALEK · app.js (Orchestrator Pro v2)
  - Boot robusto (anti doble carga)
  - Refresh anti-race + UX busy
  - Modal stats + modal quick pay
  - Tabs con lazy loading
  - Filtros principales + filtros de histórico
  - Delegación: editar valor/método + registrar pago
  - Fallbacks UI si todavía no existen funciones nuevas en ui.render.js
============================================================================ */

(() => {
  /* =========================
     ANTI DOBLE CARGA
  ========================= */
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
     HARD GUARDS
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
      throw new Error("Missing modules: " + missing.join(", "));
    }
  })();

  /* =========================
     DOM CACHE
  ========================= */
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  const els = {
    // Main
    main: $("#main"),
    tbody: $("#tbody"),
    empty: $("#emptyState"),
    mensaje: $("#mensaje"),
    loader: $("#loader"),

    // Main filters
    q: $("#q"),
    fEstado: $("#fEstado"),
    fMetodo: $("#fMetodo"),
    btnClearFilters: $("#btnClearFilters"),

    // Main actions
    btnRefresh: $("#btnRefresh"),
    btnStats: $("#btnStats"),
    btnQuickPay: $("#btnQuickPay"),

    // Stats modal
    statsModal: $("#statsModal"),
    btnCloseStats: $("#btnCloseStats"),
    statsTabs: $$("#statsModal .tab"),
    statsPanels: $$("#statsModal .tab-panel"),

    // Stats containers
    statsBody: $("#statsBody"),
    statsMetodos: $("#statsMetodos"),
    statsMeses: $("#statsMeses"),
    statsHistorico: $("#statsHistorico"),
    statsProyeccion: $("#statsProyeccion"),
    statsPendientes: $("#statsPendientes"),

    // History filters
    historyQ: $("#historyQ"),
    historyYear: $("#historyYear"),
    historyMethod: $("#historyMethod"),

    // Quick pay modal
    quickPayModal: $("#quickPayModal"),
    btnCloseQuickPay: $("#btnCloseQuickPay"),
    quickPayForm: $("#quickPayForm"),
    btnSubmitQuickPay: $("#btnSubmitQuickPay"),
    quickFactura: $("#quickFactura"),
    quickValor: $("#quickValor"),
    quickMetodo: $("#quickMetodo"),
    quickFecha: $("#quickFecha"),
    quickNota: $("#quickNota"),
  };

  /* =========================
     INTERNAL STATE
  ========================= */
  let refreshToken = 0;
  let lastFocusEl = null;
  let statsLoaded = false;
  let historicoLoaded = false;
  let activeModal = null;

  const localState = {
    historicoRows: [],
    historyFiltered: [],
    statsData: null,
    loadedTabs: new Set(["resumen"]),
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

  function formatDateInputValue(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function getYearFromAnyDate(v) {
    const dt = parseDateFlexible(v);
    return dt ? String(dt.getFullYear()) : "";
  }

  function getMonthKeyFromAnyDate(v) {
    const dt = parseDateFlexible(v);
    if (!dt) return "";
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
  }

  function esPagoDelMes(fechaStr) {
    if (STATE && typeof STATE.isPagoDelMes === "function") {
      return STATE.isPagoDelMes(fechaStr);
    }

    const dt = parseDateFlexible(fechaStr);
    if (!dt) return false;

    const hoy = new Date();
    return dt.getMonth() === hoy.getMonth() && dt.getFullYear() === hoy.getFullYear();
  }

  function setBusy(isBusy) {
    UI?.setBusy?.(isBusy);
    if (els.main) els.main.setAttribute("aria-busy", isBusy ? "true" : "false");
    if (els.loader) els.loader.classList.toggle("hide", !isBusy);
  }

  function toast(msg, type = "ok") {
    UI?.toast?.(msg, type);
  }

  function getFacturas() {
    return (STATE?.getFacturas?.() ?? STATE?.facturas ?? []);
  }

  function getSavedFilters() {
    return STATE?.getFilters?.() ?? STATE?.filters ?? { q: "", estado: "all", metodo: "all" };
  }

  function setSavedFilters(next) {
    if (typeof STATE?.setFilters === "function") STATE.setFilters(next);
    else STATE.filters = { ...(STATE.filters || {}), ...(next || {}) };
  }

  function setFiltered(rows) {
    if (typeof STATE?.setFiltered === "function") STATE.setFiltered(rows);
    else STATE.filtered = rows;
  }

  function setStatsData(s) {
    localState.statsData = s || null;
    if (typeof STATE?.setStats === "function") STATE.setStats(s);
    else STATE.stats = s;
  }

  function getStatsData() {
    return localState.statsData || STATE?.getStats?.() || STATE?.stats || null;
  }

  /* =========================
     MAIN FILTERS + KPIS
  ========================= */
  function buildMetodoOptions() {
    if (!els.fMetodo) return;

    const methods =
      typeof STATE?.extractMetodos === "function"
        ? STATE.extractMetodos()
        : (() => {
            const set = new Set();
            getFacturas().forEach((f) => {
              const m = String(f?.metodo ?? "").trim();
              if (m) set.add(m);
            });
            return [...set].sort((a, b) => a.localeCompare(b, "es"));
          })();

    const current = els.fMetodo.value || "all";
    els.fMetodo.innerHTML =
      `<option value="all">Todos</option>` +
      methods.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join("");

    els.fMetodo.value = methods.includes(current) || current === "all" ? current : "all";
  }

  function populateQuickFacturaOptions() {
    if (!els.quickFactura) return;

    const facturas = getFacturas();
    const current = els.quickFactura.value || "";

    els.quickFactura.innerHTML =
      `<option value="">Selecciona una factura</option>` +
      facturas
        .map((f) => {
          const nombre = String(f?.nombre ?? "").trim();
          const valor = Number(f?.valor || 0);
          return `<option value="${escapeHtml(nombre)}">${escapeHtml(nombre)} · ${escapeHtml(fmtCOP(valor))}</option>`;
        })
        .join("");

    if ([...els.quickFactura.options].some((o) => o.value === current)) {
      els.quickFactura.value = current;
    }
  }

  function applyFilters() {
    const q = normalizeText(els.q?.value || "");
    const estado = els.fEstado?.value || "all";
    const metodo = els.fMetodo?.value || "all";

    setSavedFilters({ q, estado, metodo });

    const facturas = getFacturas();

    const out = facturas.filter((f) => {
      const pagado = esPagoDelMes(f?.ultimo);
      const m = String(f?.metodo ?? "").trim();

      if (estado === "pagado" && !pagado) return false;
      if (estado === "pendiente" && pagado) return false;
      if (metodo !== "all" && m !== metodo) return false;

      if (q) {
        const hay =
          normalizeText(f?.nombre).includes(q) ||
          normalizeText(f?.referencia).includes(q) ||
          normalizeText(f?.metodo).includes(q);
        if (!hay) return false;
      }

      return true;
    });

    setFiltered(out);
    UI?.renderTable?.(out);

    const has = out.length > 0;
    els.empty?.classList.toggle("hide", has);
    if (els.tbody && !has) els.tbody.textContent = "";
  }

  function updateKPIs() {
    UI?.renderKPIs?.(getFacturas());
  }

  function restoreSavedFiltersToUI() {
    const saved = getSavedFilters();
    if (els.q && typeof saved.q === "string") els.q.value = saved.q;
    if (els.fEstado && saved.estado) els.fEstado.value = saved.estado;
    if (els.fMetodo && saved.metodo) els.fMetodo.value = saved.metodo;
  }

  /* =========================
     MODALS
  ========================= */
  function openModal(modalEl) {
    if (!modalEl) return;
    lastFocusEl = document.activeElement;
    activeModal = modalEl;

    modalEl.classList.remove("hide");
    document.body.style.overflow = "hidden";

    const focusTarget =
      modalEl.querySelector("[data-close]") ||
      modalEl.querySelector("button, input, select, textarea");
    focusTarget?.focus?.();
  }

  function closeModal(modalEl) {
    if (!modalEl) return;

    modalEl.classList.add("hide");
    if (activeModal === modalEl) activeModal = null;

    if (!els.statsModal || els.statsModal.classList.contains("hide")) {
      if (!els.quickPayModal || els.quickPayModal.classList.contains("hide")) {
        document.body.style.overflow = "";
      }
    }

    lastFocusEl?.focus?.();
    lastFocusEl = null;
  }

  function trapFocusInModal(ev) {
    if (!activeModal || activeModal.classList.contains("hide")) return;
    if (ev.key !== "Tab") return;

    const focusables = activeModal.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    const list = Array.from(focusables).filter(
      (el) =>
        !el.hasAttribute("disabled") &&
        !el.classList.contains("hide") &&
        el.offsetParent !== null
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

  /* =========================
     STATS MODAL + TABS
  ========================= */
  function switchStatsTab(key) {
    els.statsTabs.forEach((t) => {
      const on = t.dataset.tab === key;
      t.classList.toggle("is-active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.setAttribute("tabindex", on ? "0" : "-1");
    });

    els.statsPanels.forEach((p) => {
      const on = p.id.toLowerCase() === `tab${key}`.toLowerCase();
      p.classList.toggle("hide", !on);
    });

    handleStatsTabLazyLoad(key);
  }

  async function openStatsModal() {
    openModal(els.statsModal);
    switchStatsTab("resumen");

    if (!statsLoaded) {
      await loadStats();
    }
  }

  function closeStatsModal() {
    closeModal(els.statsModal);
  }

  async function handleStatsTabLazyLoad(key) {
    if (key === "resumen" || key === "metodos" || key === "meses" || key === "pendientes" || key === "proyeccion") {
      if (!statsLoaded) await loadStats();
      else renderStatsEverywhere();
      return;
    }

    if (key === "historico") {
      if (!historicoLoaded) await loadHistorico();
      else {
        buildHistoryFilterOptions();
        applyHistoryFilters();
      }
    }
  }

  function resetStatsPanelsLoading() {
    if (els.statsBody) els.statsBody.innerHTML = `<p class="muted">Cargando estadísticas…</p>`;
    if (els.statsMetodos) els.statsMetodos.innerHTML = `<p class="muted">Cargando métodos…</p>`;
    if (els.statsMeses) els.statsMeses.innerHTML = `<p class="muted">Cargando meses…</p>`;
    if (els.statsPendientes) els.statsPendientes.innerHTML = `<p class="muted">Cargando pendientes…</p>`;
    if (els.statsProyeccion) els.statsProyeccion.innerHTML = `<p class="muted">Cargando proyección…</p>`;
  }

  async function loadStats() {
    resetStatsPanelsLoading();

    try {
      setBusy(true);
      const s = await API.stats();
      setStatsData(s);
      statsLoaded = true;
      renderStatsEverywhere();
    } catch (err) {
      const msg = `❌ Error: ${escapeHtml(err.message)}`;
      if (els.statsBody) els.statsBody.innerHTML = `<p class="muted">${msg}</p>`;
      if (els.statsMetodos) els.statsMetodos.innerHTML = `<p class="muted">${msg}</p>`;
      if (els.statsMeses) els.statsMeses.innerHTML = `<p class="muted">${msg}</p>`;
      if (els.statsPendientes) els.statsPendientes.innerHTML = `<p class="muted">${msg}</p>`;
      if (els.statsProyeccion) els.statsProyeccion.innerHTML = `<p class="muted">${msg}</p>`;
    } finally {
      setBusy(false);
    }
  }

  function renderStatsEverywhere() {
    const s = getStatsData();
    const facturas = getFacturas();

    UI?.renderStats?.(s, facturas);

    if (typeof UI?.renderProjection === "function") {
      UI.renderProjection(s, facturas);
    } else {
      renderProjectionFallback(s, facturas);
    }
  }

  function renderProjectionFallback(s, facturas) {
    if (!els.statsProyeccion) return;

    const list = Array.isArray(facturas) ? facturas : [];
    const pagadasMes = list.filter((f) => esPagoDelMes(f?.ultimo));
    const totalActual = pagadasMes.reduce((acc, f) => acc + (Number(f?.valor || 0) || 0), 0);

    const avg6 =
      Number(s?.promedioUltimos6Meses ?? s?.promedioPago ?? 0) || 0;

    const proy =
      Number(s?.proyeccionMesActual ?? totalActual) || totalActual;

    const delta = avg6 ? ((proy - avg6) / avg6) * 100 : 0;
    const deltaTxt =
      avg6 === 0
        ? "Sin base suficiente"
        : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}% vs promedio`;

    els.statsProyeccion.innerHTML = `
      <div class="stats-grid">
        <div class="stat">
          <div class="k">Total actual del mes</div>
          <div class="v">${escapeHtml(fmtCOP(totalActual))}</div>
        </div>
        <div class="stat">
          <div class="k">Promedio base</div>
          <div class="v">${escapeHtml(fmtCOP(avg6))}</div>
        </div>
        <div class="stat">
          <div class="k">Proyección de cierre</div>
          <div class="v">${escapeHtml(fmtCOP(proy))}</div>
        </div>
        <div class="stat">
          <div class="k">Variación estimada</div>
          <div class="v">${escapeHtml(deltaTxt)}</div>
        </div>
      </div>
      <p class="muted" style="margin-top:12px">
        Esta sección usa los datos disponibles del backend. Si luego metemos
        promedio de 6 meses y proyección real, queda bastante más fina y menos intuitiva a punta de fe.
      </p>
    `;
  }

  /* =========================
     HISTÓRICO
  ========================= */
  function normalizeHistoricoResponse(json) {
    if (!json) return [];
    if (Array.isArray(json)) return json;
    if (Array.isArray(json.rows)) return json.rows;
    if (Array.isArray(json.data)) return json.data;
    return [];
  }

  async function loadHistorico() {
    if (els.statsHistorico) {
      els.statsHistorico.innerHTML = `<p class="muted">Cargando histórico…</p>`;
    }

    try {
      setBusy(true);

      let rows = [];
      if (typeof API.historial === "function") {
        const resp = await API.historial();
        rows = normalizeHistoricoResponse(resp);
      } else {
        rows = buildHistoricoFallbackFromStats(getStatsData());
      }

      localState.historicoRows = Array.isArray(rows) ? rows : [];
      historicoLoaded = true;

      buildHistoryFilterOptions();
      applyHistoryFilters();
    } catch (err) {
      if (els.statsHistorico) {
        els.statsHistorico.innerHTML = `<p class="muted">❌ Error cargando histórico: ${escapeHtml(err.message)}</p>`;
      }
    } finally {
      setBusy(false);
    }
  }

  function buildHistoricoFallbackFromStats(stats) {
    // Fallback modesto: si no hay endpoint historial, al menos no revienta.
    // No inventa pagos. Solo muestra vacío con base en backend actual.
    if (!stats || !Array.isArray(stats?.ultimosPagos)) return [];
    return stats.ultimosPagos;
  }

  function buildHistoryFilterOptions() {
    const rows = localState.historicoRows || [];

    if (els.historyYear) {
      const years = [...new Set(rows.map((r) => getYearFromAnyDate(r?.fecha)).filter(Boolean))]
        .sort((a, b) => b.localeCompare(a));

      const current = els.historyYear.value || "all";
      els.historyYear.innerHTML =
        `<option value="all">Todos</option>` +
        years.map((y) => `<option value="${escapeHtml(y)}">${escapeHtml(y)}</option>`).join("");

      els.historyYear.value = years.includes(current) || current === "all" ? current : "all";
    }

    if (els.historyMethod) {
      const methods = [...new Set(
        rows.map((r) => String(r?.metodo ?? "").trim()).filter(Boolean)
      )].sort((a, b) => a.localeCompare(b, "es"));

      const current = els.historyMethod.value || "all";
      els.historyMethod.innerHTML =
        `<option value="all">Todos</option>` +
        methods.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join("");

      els.historyMethod.value = methods.includes(current) || current === "all" ? current : "all";
    }
  }

  function applyHistoryFilters() {
    const rows = localState.historicoRows || [];

    const q = normalizeText(els.historyQ?.value || "");
    const year = els.historyYear?.value || "all";
    const method = els.historyMethod?.value || "all";

    const filtered = rows.filter((r) => {
      const rowYear = getYearFromAnyDate(r?.fecha);
      const rowMethod = String(r?.metodo ?? "").trim();

      if (year !== "all" && rowYear !== year) return false;
      if (method !== "all" && rowMethod !== method) return false;

      if (q) {
        const hay =
          normalizeText(r?.factura).includes(q) ||
          normalizeText(r?.referencia).includes(q) ||
          normalizeText(r?.metodo).includes(q) ||
          normalizeText(r?.estado).includes(q) ||
          normalizeText(r?.fecha).includes(q);
        if (!hay) return false;
      }

      return true;
    });

    localState.historyFiltered = filtered;

    if (typeof UI?.renderHistorico === "function") {
      UI.renderHistorico(filtered);
    } else {
      renderHistoricoFallback(filtered);
    }
  }

  function renderHistoricoFallback(rows) {
    if (!els.statsHistorico) return;

    const list = Array.isArray(rows) ? rows : [];

    if (!list.length) {
      els.statsHistorico.innerHTML = `
        <div class="empty">
          <div class="empty-emoji" aria-hidden="true">🧾</div>
          <div class="empty-title">No hay movimientos para mostrar</div>
          <div class="empty-sub muted">Prueba cambiando los filtros del histórico.</div>
        </div>
      `;
      return;
    }

    const htmlRows = list
      .slice()
      .sort((a, b) => {
        const da = parseDateFlexible(a?.fecha)?.getTime() || 0;
        const db = parseDateFlexible(b?.fecha)?.getTime() || 0;
        return db - da;
      })
      .map((r) => {
        const factura = escapeHtml(r?.factura ?? r?.nombre ?? "—");
        const referencia = escapeHtml(r?.referencia ?? "—");
        const metodo = escapeHtml(r?.metodo ?? "—");
        const estado = escapeHtml(r?.estado ?? "Pagado");
        const fecha = escapeHtml(r?.fecha ?? "—");
        const valorPagado = fmtCOP(r?.valorPagado ?? r?.valor ?? 0);

        return `
          <tr>
            <td>${fecha}</td>
            <td>${factura}</td>
            <td>${referencia}</td>
            <td>${escapeHtml(valorPagado)}</td>
            <td>${metodo}</td>
            <td>${estado}</td>
          </tr>
        `;
      })
      .join("");

    els.statsHistorico.innerHTML = `
      <div class="mini-table-wrap">
        <table class="tabla">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Factura</th>
              <th>Referencia</th>
              <th>Valor pagado</th>
              <th>Método</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>${htmlRows}</tbody>
        </table>
      </div>
      <p class="muted" style="margin-top:12px">
        Mostrando ${list.length} registro(s).
      </p>
    `;
  }

  /* =========================
     QUICK PAY
  ========================= */
  function openQuickPayModal() {
    populateQuickFacturaOptions();

    if (els.quickPayForm) els.quickPayForm.reset();
    if (els.quickFecha) els.quickFecha.value = formatDateInputValue(new Date());

    openModal(els.quickPayModal);
  }

  function closeQuickPayModal() {
    closeModal(els.quickPayModal);
  }

  function findFacturaByName(nombre) {
    const norm = normalizeText(nombre);
    return getFacturas().find((f) => normalizeText(f?.nombre) === norm) || null;
  }

  async function submitQuickPay(ev) {
    ev.preventDefault();

    const factura = String(els.quickFactura?.value || "").trim();
    const valorPagado = parseCOP(els.quickValor?.value || "");
    const metodo = String(els.quickMetodo?.value || "").trim();
    const fecha = String(els.quickFecha?.value || "").trim();
    const nota = String(els.quickNota?.value || "").trim();

    if (!factura) {
      toast("Selecciona una factura.", "error");
      els.quickFactura?.focus?.();
      return;
    }

    if (valorPagado == null || !Number.isFinite(valorPagado)) {
      toast("Escribe un valor pagado válido.", "error");
      els.quickValor?.focus?.();
      return;
    }

    const submitBtn = els.btnSubmitQuickPay;
    if (submitBtn) submitBtn.disabled = true;

    try {
      setBusy(true);

      if (typeof API.quickPay === "function") {
        await API.quickPay({ factura, valorPagado, metodo, fecha, nota });
      } else {
        // fallback sensato: buscamos row y usamos registrarPago normal
        const facturaObj = findFacturaByName(factura);
        if (!facturaObj?.row) {
          throw new Error("No existe API.quickPay y no pude ubicar la fila de esa factura.");
        }
        await API.registrarPago(facturaObj.row);
      }

      toast("Pago rápido registrado ✅", "ok");
      closeQuickPayModal();

      statsLoaded = false;
      historicoLoaded = false;

      await refresh();

      if (els.statsModal && !els.statsModal.classList.contains("hide")) {
        await loadStats();
      }
    } catch (err) {
      console.error(err);
      toast("Error registrando pago rápido: " + err.message, "error");
    } finally {
      setBusy(false);
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  /* =========================
     EDITABLE CELLS
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
      const orig = String(cellMetodo.dataset.metodo || "").trim();
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

    if (!cellValor && !cellMetodo) {
      trapFocusInModal(ev);

      if (ev.key === "Escape") {
        if (els.quickPayModal && !els.quickPayModal.classList.contains("hide")) {
          closeQuickPayModal();
          return;
        }
        if (els.statsModal && !els.statsModal.classList.contains("hide")) {
          closeStatsModal();
        }
      }
      return;
    }

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
        const orig = String(cellMetodo.dataset.origMetodo || cellMetodo.dataset.metodo || "").trim();
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

        toast("Valor actualizado 💰", "ok");

        statsLoaded = false;
        updateKPIs();
        await refreshIfStatsOpen();
      } catch (err) {
        console.error(err);
        setCellTextSafely(cell, fmtCOP(origNum));
        toast("Error al editar valor: " + err.message, "error");
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

      const orig = String(cell.dataset.origMetodo || "").trim();
      const nuevo = String(cell.textContent || "").trim();

      if (!Number.isFinite(row) || nuevo === orig) {
        cell.dataset.metodo = orig;
        setCellTextSafely(cell, orig || "—");
        return;
      }

      if (typeof API.editarMetodo !== "function") {
        cell.dataset.metodo = orig;
        setCellTextSafely(cell, orig || "—");
        toast("editarMetodo aún no existe en services.api.js", "error");
        return;
      }

      try {
        await API.editarMetodo(row, nuevo);
        cell.dataset.metodo = nuevo;
        setCellTextSafely(cell, nuevo || "—");

        toast("Método actualizado 💳", "ok");

        statsLoaded = false;
        buildMetodoOptions();
        updateKPIs();
        await refreshIfStatsOpen();
      } catch (err) {
        console.error(err);
        cell.dataset.metodo = orig;
        setCellTextSafely(cell, orig || "—");
        toast("Error al editar método: " + err.message, "error");
      }
    },
    true
  );

  /* =========================
     REGISTRAR PAGO DESDE TABLA
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

      toast("Pago registrado ✅", "ok");

      statsLoaded = false;
      historicoLoaded = false;

      await refresh();

      if (els.statsModal && !els.statsModal.classList.contains("hide")) {
        await loadStats();
      }
    } catch (err) {
      console.error(err);
      toast("Error al registrar: " + err.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = prevTxt || "Registrar";
    }
  });

  /* =========================
     REFRESH / BOOT
  ========================= */
  async function refresh() {
    const token = ++refreshToken;

    try {
      setBusy(true);
      if (els.btnRefresh) els.btnRefresh.disabled = true;

      const rows = await API.listarFacturas();
      if (token !== refreshToken) return;

      if (typeof STATE?.setFacturas === "function") STATE.setFacturas(rows);
      else STATE.facturas = rows;

      buildMetodoOptions();
      populateQuickFacturaOptions();
      updateKPIs();
      restoreSavedFiltersToUI();
      applyFilters();
    } catch (err) {
      if (token !== refreshToken) return;

      console.error(err);
      if (els.tbody) els.tbody.textContent = "";
      els.empty?.classList.remove("hide");
      toast("Error cargando: " + err.message, "error");
    } finally {
      if (token === refreshToken) {
        setBusy(false);
        if (els.btnRefresh) els.btnRefresh.disabled = false;
      }
    }
  }

  async function refreshIfStatsOpen() {
    if (els.statsModal && !els.statsModal.classList.contains("hide")) {
      await loadStats();
      if (!$("#tabHistorico")?.classList.contains("hide") && historicoLoaded) {
        await loadHistorico();
      }
    }
  }

  /* =========================
     EVENTS
  ========================= */
  const onSearch = debounce(applyFilters, CFG?.DEBOUNCE_MS ?? 180);
  const onHistorySearch = debounce(applyHistoryFilters, CFG?.DEBOUNCE_MS ?? 180);

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
  els.btnStats?.addEventListener("click", openStatsModal);
  els.btnCloseStats?.addEventListener("click", closeStatsModal);

  els.btnQuickPay?.addEventListener("click", openQuickPayModal);
  els.btnCloseQuickPay?.addEventListener("click", closeQuickPayModal);
  els.quickPayForm?.addEventListener("submit", submitQuickPay);

  els.statsTabs.forEach((t) => {
    t.addEventListener("click", () => switchStatsTab(t.dataset.tab));
  });

  els.historyQ?.addEventListener("input", onHistorySearch);
  els.historyYear?.addEventListener("change", applyHistoryFilters);
  els.historyMethod?.addEventListener("change", applyHistoryFilters);

  document.addEventListener("click", (ev) => {
    const closeStats = ev.target.closest("[data-close='stats']");
    if (closeStats) {
      closeStatsModal();
      return;
    }

    const closeQuick = ev.target.closest("[data-close='quickpay']");
    if (closeQuick) {
      closeQuickModal();
    }
  });

  function closeQuickModal() {
    closeQuickPayModal();
  }

  /* =========================
     BOOT
  ========================= */
  function boot() {
    if (els.quickFecha && !els.quickFecha.value) {
      els.quickFecha.value = formatDateInputValue(new Date());
    }
    refresh();
  }

  boot();
})();