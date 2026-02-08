"use strict";

/* ============================================================================
   FACTURAS HOGAR ALEK · ui.render.js (vNext+++)
   - Render eficiente (DocumentFragment)
   - KPIs (con fallback seguro)
   - Toast + Busy (accesible)
   - Render de Stats (modal tabs)
   - Helpers UI: $, $$, escape, format money
   - Protecciones: no pisar window.UI si ya existe
============================================================================ */

(function () {
  if (window.UI) return;

  const CFG = window.CFG || { TOAST_MS: 3200, LIMITS: { PENDIENTES_PREVIEW: 12 } };
  const STATE = window.STATE || {};

  const DBG = window.__DBG__ || (() => {});

  /* =========================
     DOM HELPERS
  ========================= */
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  /* Cache DOM */
  const els = {
    tbody: $("#tbody"),
    empty: $("#emptyState"),
    msg: $("#mensaje"),
    loader: $("#loader"),
    main: $("#main"),

    // KPIs
    kpiTotalMes: $("#kpiTotalMes"),
    kpiDeltaMes: $("#kpiDeltaMes"),
    kpiPagadas: $("#kpiPagadas"),
    kpiTotalFacturas: $("#kpiTotalFacturas"),
    kpiPendientes: $("#kpiPendientes"),
    kpiValorPendiente: $("#kpiValorPendiente"),
    kpiMetodoTop: $("#kpiMetodoTop"),

    // Stats panels
    statsBody: $("#statsBody"),
    statsMetodos: $("#statsMetodos"),
    statsMeses: $("#statsMeses"),
    statsPendientes: $("#statsPendientes"),
  };

  /* =========================
     FORMATTERS
  ========================= */
  const money = new Intl.NumberFormat(CFG.LOCALE || "es-CO", {
    style: "currency",
    currency: CFG.CURRENCY || "COP",
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

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function isPagoDelMes(fechaStr) {
    if (typeof STATE.isPagoDelMes === "function") return STATE.isPagoDelMes(fechaStr);

    if (!fechaStr) return false;
    const base = String(fechaStr).trim().split(" ")[0];
    const p = base.split("/");
    if (p.length < 3) return false;
    const [, mes, anio] = p.map(Number);
    const hoy = new Date();
    return mes === hoy.getMonth() + 1 && anio === hoy.getFullYear();
  }

  /* =========================
     TOAST / BUSY (a11y)
  ========================= */
  function toast(text, type = "ok") {
    if (!els.msg) return;

    // aria-live: si no está en HTML, lo ponemos
    els.msg.setAttribute("role", "status");
    els.msg.setAttribute("aria-live", "polite");

    els.msg.textContent = text;
    els.msg.className = "";
    els.msg.classList.add(type);
    els.msg.classList.remove("hide");

    clearTimeout(toast._t);
    toast._t = setTimeout(() => els.msg.classList.add("hide"), CFG.TOAST_MS ?? 3200);
  }

  function setBusy(isBusy) {
    if (els.main) els.main.setAttribute("aria-busy", isBusy ? "true" : "false");
    if (els.loader) els.loader.classList.toggle("hide", !isBusy);

    // Si STATE expone setBusy, lo sincronizamos
    if (STATE && typeof STATE.setBusy === "function") {
      try {
        STATE.setBusy(!!isBusy, { silent: true });
      } catch {}
    }
  }

  /* =========================
     RENDER: TABLE (faster + safer)
  ========================= */

  function buildRow(f) {
    const tr = document.createElement("tr");
    tr.dataset.row = String(f.row ?? "");

    const nombre = (f.nombre ?? "").toString();
    const referencia = (f.referencia ?? "").toString();
    const ultimo = (f.ultimo ?? "").toString();

    const pagadoEsteMes = isPagoDelMes(ultimo);

    const valorNumerico =
      Number(isNaN(f.valor) ? parseCOP(f.valor) : f.valor) || 0;

    const metodoTxt = (f.metodo ?? "").toString().trim();

    // Para reducir XSS: todo escapado excepto badge/btn.
    const estadoBadge = pagadoEsteMes
      ? `<span class="badge ok">Pagado</span>`
      : `<span class="badge pendiente">Pendiente</span>`;

    tr.innerHTML = `
      <td>${escapeHtml(nombre)}</td>
      <td>${escapeHtml(referencia)}</td>

      <td class="editable valor"
          contenteditable="true"
          spellcheck="false"
          inputmode="numeric"
          data-valor="${escapeHtml(String(valorNumerico))}"
          aria-label="Editar valor">
        ${escapeHtml(fmtCOP(valorNumerico))}
      </td>

      <td class="editable metodo"
          contenteditable="true"
          spellcheck="false"
          data-metodo="${escapeHtml(metodoTxt)}"
          aria-label="Editar método de pago">
        ${escapeHtml(metodoTxt || "—")}
      </td>

      <td class="fecha">${escapeHtml(ultimo)}</td>
      <td class="estado">${estadoBadge}</td>

      <td>
        <button class="btn"
                data-row="${escapeHtml(String(f.row ?? ""))}"
                data-action="registrar"
                type="button"
                aria-label="Registrar pago">
          Registrar
        </button>
      </td>
    `;

    return tr;
  }

  function renderTable(list) {
    const rows = Array.isArray(list) ? list : [];

    if (!els.tbody) return;

    if (!rows.length) {
      els.tbody.textContent = "";
      els.empty?.classList.remove("hide");
      return;
    }

    els.empty?.classList.add("hide");

    const frag = document.createDocumentFragment();
    for (const f of rows) frag.appendChild(buildRow(f));

    // replace in one go
    els.tbody.textContent = "";
    els.tbody.appendChild(frag);
  }

  /* =========================
     RENDER: KPIs
  ========================= */
  function renderKPIs(facturas) {
    const list = Array.isArray(facturas) ? facturas : [];

    const total = list.length;
    const pagadas = list.filter((f) => isPagoDelMes(f.ultimo)).length;
    const pendientes = total - pagadas;

    const totalMes = list
      .filter((f) => isPagoDelMes(f.ultimo))
      .reduce((acc, f) => acc + (parseCOP(f.valor) || 0), 0);

    const valorPendiente = list
      .filter((f) => !isPagoDelMes(f.ultimo))
      .reduce((acc, f) => acc + (parseCOP(f.valor) || 0), 0);

    if (els.kpiTotalMes) els.kpiTotalMes.textContent = fmtCOP(totalMes);
    if (els.kpiPagadas) els.kpiPagadas.textContent = String(pagadas);
    if (els.kpiTotalFacturas) els.kpiTotalFacturas.textContent = String(total);
    if (els.kpiPendientes) els.kpiPendientes.textContent = String(pendientes);
    if (els.kpiValorPendiente) els.kpiValorPendiente.textContent = fmtCOP(valorPendiente);

    // Método top: suma por método
    const byMetodo = Object.create(null);
    for (const f of list) {
      const m = (f.metodo ?? "").toString().trim();
      if (!m) continue;
      const val = parseCOP(f.valor) || 0;
      byMetodo[m] = (byMetodo[m] || 0) + val;
    }
    const top = Object.entries(byMetodo).sort((a, b) => b[1] - a[1])[0];
    if (els.kpiMetodoTop) els.kpiMetodoTop.textContent = top ? top[0] : "—";

    // Delta placeholder
    if (els.kpiDeltaMes) els.kpiDeltaMes.textContent = "vs mes anterior: (próximamente)";
  }

  /* =========================
     RENDER: STATS (Modal tabs)
  ========================= */
  function renderStats(stats, facturas) {
    const s = stats || {};
    const list = Array.isArray(facturas) ? facturas : [];

    // Resumen
    if (els.statsBody) {
      els.statsBody.innerHTML = `
        <div class="stats-grid">
          <div class="stat"><div class="k">Total histórico</div><div class="v">${escapeHtml(fmtCOP(s.totalPagado ?? 0))}</div></div>
          <div class="stat"><div class="k">Pagos este mes</div><div class="v">${escapeHtml(String(s.pagosEsteMes ?? "—"))}</div></div>
          <div class="stat"><div class="k">Total este mes</div><div class="v">${escapeHtml(fmtCOP(s.totalEsteMes ?? 0))}</div></div>
          <div class="stat"><div class="k">Registros</div><div class="v">${escapeHtml(String(s.totalRegistros ?? "—"))}</div></div>
        </div>
      `;
    }

    // Métodos
    if (els.statsMetodos) {
      if (Array.isArray(s.byMetodo) && s.byMetodo.length) {
        els.statsMetodos.innerHTML = `
          <div class="mini-table">
            <div class="row head"><div>Método</div><div>Total</div></div>
            ${s.byMetodo
              .map((x) => {
                const met = (x.metodo ?? "").toString();
                const tot = Number(x.total ?? 0);
                return `<div class="row"><div>${escapeHtml(met)}</div><div>${escapeHtml(fmtCOP(tot))}</div></div>`;
              })
              .join("")}
          </div>
        `;
      } else {
        els.statsMetodos.innerHTML = `<p class="muted">Próximamente: breakdown por método 💳</p>`;
      }
    }

    // Meses
    if (els.statsMeses) {
      if (Array.isArray(s.byMes) && s.byMes.length) {
        els.statsMeses.innerHTML = `
          <div class="mini-table">
            <div class="row head"><div>Mes</div><div>Total</div></div>
            ${s.byMes
              .map((x) => {
                const mes = (x.mes ?? "").toString();
                const tot = Number(x.total ?? 0);
                return `<div class="row"><div>${escapeHtml(mes)}</div><div>${escapeHtml(fmtCOP(tot))}</div></div>`;
              })
              .join("")}
          </div>
        `;
      } else {
        els.statsMeses.innerHTML = `<p class="muted">Próximamente: histórico por mes 📅</p>`;
      }
    }

    // Pendientes (calculado frontend)
    if (els.statsPendientes) {
      const pendientesEsteMes = list.filter((f) => !isPagoDelMes(f.ultimo));
      const limit = CFG?.LIMITS?.PENDIENTES_PREVIEW ?? 12;

      els.statsPendientes.innerHTML = `
        <p><strong>Pendientes este mes:</strong> ${pendientesEsteMes.length}</p>
        ${
          pendientesEsteMes.length
            ? `<div class="mini-table">
                <div class="row head"><div>Factura</div><div>Valor</div></div>
                ${pendientesEsteMes
                  .slice(0, limit)
                  .map((f) => {
                    const nom = (f.nombre ?? "").toString();
                    const val = parseCOP(f.valor) || 0;
                    return `<div class="row"><div>${escapeHtml(nom)}</div><div>${escapeHtml(fmtCOP(val))}</div></div>`;
                  })
                  .join("")}
              </div>
              <p class="muted" style="margin-top:.6rem">
                Mostrando hasta ${limit}. (Porque nadie quiere leer una biblia de pendientes 😅)
              </p>`
            : `<p class="muted">Nada pendiente. Milagro.</p>`
        }
      `;
    }
  }

  /* =========================
     OPTIONAL: Método options
  ========================= */
  function renderMetodoOptions(selectEl, methods) {
    if (!selectEl) return;
    const list = Array.isArray(methods) ? methods : [];
    selectEl.innerHTML =
      `<option value="all">Todos</option>` +
      list.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join("");
  }

  /* =========================
     OPTIONAL: Bind to STATE events
     (no rompe nada si STATE no tiene pubsub)
  ========================= */
  function bindState() {
    if (!STATE || typeof STATE.on !== "function") return;

    // Si quieres UI reactiva sin que app.js llame todo a mano:
    // - al cambiar facturas: KPIs
    // - al cambiar filtered: tabla
    // (La app ya lo hace, pero esto te da redundancia controlada)
    STATE.on("filtered:changed", (rows) => renderTable(rows));
    STATE.on("facturas:changed", (rows) => renderKPIs(rows));
    STATE.on("meta:error", (msg) => msg && toast(String(msg), "error"));
  }

  /* =========================
     PUBLIC API
  ========================= */
  const PUBLIC = Object.freeze({
    $,
    $$,

    // formatters
    fmtCOP,
    parseCOP,
    escapeHtml,

    // ui
    toast,
    setBusy,

    // renderers
    renderTable,
    renderKPIs,
    renderStats,
    renderMetodoOptions,

    // internal
    _bindState: bindState,
  });

  Object.defineProperty(window, "UI", {
    value: PUBLIC,
    writable: false,
    configurable: false,
    enumerable: true,
  });

  // Activar bind si STATE está listo
  try {
    bindState();
  } catch (e) {
    DBG("UI bindState failed:", e?.message || e);
  }
})();
