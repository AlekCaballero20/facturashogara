"use strict";

/* ============================================================================
   FACTURAS HOGAR ALEK · ui.render.js (Pro v2)
   - Render eficiente y seguro
   - Tabla principal + KPIs + stats + histórico + proyección
   - Toast + Busy accesible
   - Helpers UI reutilizables
   - Compatible con app.js / index.html nuevos
============================================================================ */

(function () {
  if (window.UI) return;

  const CFG = window.CFG || {
    TOAST_MS: 3200,
    LIMITS: { PENDIENTES_PREVIEW: 12 },
    LOCALE: "es-CO",
    CURRENCY: "COP",
  };

  const STATE = window.STATE || {};
  const DBG = window.__DBG__ || (() => {});

  /* =========================
     DOM HELPERS
  ========================= */
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

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
    statsHistorico: $("#statsHistorico"),
    statsProyeccion: $("#statsProyeccion"),
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

  function formatMonthKey(ym) {
    if (!ym) return "—";
    const m = String(ym).match(/^(\d{4})-(\d{2})$/);
    if (!m) return String(ym);
    const year = Number(m[1]);
    const month = Number(m[2]) - 1;
    const dt = new Date(year, month, 1);
    return dt.toLocaleDateString("es-CO", { month: "long", year: "numeric" });
  }

  function monthKeyFromDate(v) {
    const dt = parseDateFlexible(v);
    if (!dt) return "";
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
  }

  function isPagoDelMes(fechaStr) {
    if (typeof STATE.isPagoDelMes === "function") return STATE.isPagoDelMes(fechaStr);

    const dt = parseDateFlexible(fechaStr);
    if (!dt) return false;

    const hoy = new Date();
    return dt.getMonth() === hoy.getMonth() && dt.getFullYear() === hoy.getFullYear();
  }

  function formatPercent(v) {
    const n = Number(v || 0);
    if (!Number.isFinite(n)) return "—";
    return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
  }

  function trendClass(v) {
    const n = Number(v || 0);
    if (!Number.isFinite(n) || n === 0) return "neutral";
    return n > 0 ? "up" : "down";
  }

  function safeArray(v) {
    return Array.isArray(v) ? v : [];
  }

  /* =========================
     TOAST / BUSY
  ========================= */
  function toast(text, type = "ok") {
    if (!els.msg) return;

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

    if (STATE && typeof STATE.setBusy === "function") {
      try {
        STATE.setBusy(!!isBusy, { silent: true });
      } catch {}
    }
  }

  /* =========================
     SMALL HTML HELPERS
  ========================= */
  function metricCard(title, value, hint = "") {
    return `
      <div class="stat">
        <div class="k">${escapeHtml(title)}</div>
        <div class="v">${escapeHtml(value)}</div>
        ${hint ? `<div class="h muted">${escapeHtml(hint)}</div>` : ""}
      </div>
    `;
  }

  function buildMiniTable(headers, rowsHtml) {
    return `
      <div class="mini-table">
        <div class="row head">
          ${headers.map((h) => `<div>${escapeHtml(h)}</div>`).join("")}
        </div>
        ${rowsHtml}
      </div>
    `;
  }

  function buildEmpty(title, sub, emoji = "🧾") {
    return `
      <div class="empty">
        <div class="empty-emoji" aria-hidden="true">${emoji}</div>
        <div class="empty-title">${escapeHtml(title)}</div>
        <div class="empty-sub muted">${escapeHtml(sub)}</div>
      </div>
    `;
  }

  function buildDeltaBadge(text, cls = "neutral") {
    return `<span class="delta ${escapeHtml(cls)}">${escapeHtml(text)}</span>`;
  }

  function buildBarRows(items, getLabel, getValue) {
    const list = safeArray(items);
    if (!list.length) return `<p class="muted">Sin datos suficientes todavía.</p>`;

    const values = list.map((x) => Number(getValue(x) || 0));
    const max = Math.max(...values, 1);

    return `
      <div class="bars">
        ${list
          .map((item) => {
            const label = String(getLabel(item) ?? "—");
            const value = Number(getValue(item) || 0);
            const pct = Math.max(4, Math.round((value / max) * 100));

            return `
              <div class="bar-row">
                <div class="bar-meta">
                  <span class="bar-label">${escapeHtml(label)}</span>
                  <span class="bar-value">${escapeHtml(fmtCOP(value))}</span>
                </div>
                <div class="bar-track" aria-hidden="true">
                  <div class="bar-fill" style="width:${pct}%"></div>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }

  /* =========================
     TABLE MAIN
  ========================= */
  function buildRow(f) {
    const tr = document.createElement("tr");
    tr.dataset.row = String(f?.row ?? "");

    const nombre = String(f?.nombre ?? "");
    const referencia = String(f?.referencia ?? "");
    const ultimo = String(f?.ultimo ?? "");
    const pagadoEsteMes = isPagoDelMes(ultimo);
    const valorNumerico = Number(isNaN(f?.valor) ? parseCOP(f?.valor) : f?.valor) || 0;
    const metodoTxt = String(f?.metodo ?? "").trim();

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

      <td class="fecha">${escapeHtml(ultimo || "—")}</td>
      <td class="estado">${estadoBadge}</td>

      <td>
        <button class="btn"
                data-row="${escapeHtml(String(f?.row ?? ""))}"
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
    const rows = safeArray(list);

    if (!els.tbody) return;

    if (!rows.length) {
      els.tbody.textContent = "";
      els.empty?.classList.remove("hide");
      return;
    }

    els.empty?.classList.add("hide");

    const frag = document.createDocumentFragment();
    for (const f of rows) frag.appendChild(buildRow(f));

    els.tbody.textContent = "";
    els.tbody.appendChild(frag);
  }

  /* =========================
     KPI HELPERS
  ========================= */
  function computeTopMetodo(list) {
    const byMetodo = Object.create(null);
    for (const f of safeArray(list)) {
      const m = String(f?.metodo ?? "").trim();
      if (!m) continue;
      const val = parseCOP(f?.valor) || 0;
      byMetodo[m] = (byMetodo[m] || 0) + val;
    }
    const top = Object.entries(byMetodo).sort((a, b) => b[1] - a[1])[0];
    return top ? { metodo: top[0], total: top[1] } : null;
  }

  function computeCurrentMonthTotals(facturas) {
    const list = safeArray(facturas);
    const pagadasMes = list.filter((f) => isPagoDelMes(f?.ultimo));
    const pendientes = list.filter((f) => !isPagoDelMes(f?.ultimo));

    return {
      totalFacturas: list.length,
      pagadas: pagadasMes.length,
      pendientes: pendientes.length,
      totalMes: pagadasMes.reduce((acc, f) => acc + (parseCOP(f?.valor) || 0), 0),
      valorPendiente: pendientes.reduce((acc, f) => acc + (parseCOP(f?.valor) || 0), 0),
    };
  }

  /* =========================
     RENDER KPIs
  ========================= */
  function renderKPIs(facturas) {
    const list = safeArray(facturas);
    const totals = computeCurrentMonthTotals(list);
    const topMetodo = computeTopMetodo(list);

    if (els.kpiTotalMes) els.kpiTotalMes.textContent = fmtCOP(totals.totalMes);
    if (els.kpiPagadas) els.kpiPagadas.textContent = String(totals.pagadas);
    if (els.kpiTotalFacturas) els.kpiTotalFacturas.textContent = String(totals.totalFacturas);
    if (els.kpiPendientes) els.kpiPendientes.textContent = String(totals.pendientes);
    if (els.kpiValorPendiente) els.kpiValorPendiente.textContent = fmtCOP(totals.valorPendiente);
    if (els.kpiMetodoTop) els.kpiMetodoTop.textContent = topMetodo ? topMetodo.metodo : "—";

    const delta = Number(STATE?.getStats?.()?.variacionMensualPct ?? STATE?.stats?.variacionMensualPct ?? 0);
    if (els.kpiDeltaMes) {
      if (Number.isFinite(delta) && delta !== 0) {
        els.kpiDeltaMes.textContent = `vs. mes anterior: ${formatPercent(delta)}`;
      } else {
        els.kpiDeltaMes.textContent = "vs. mes anterior: —";
      }
    }
  }

  /* =========================
     RENDER STATS: RESUMEN
  ========================= */
  function renderStatsResumen(stats, facturas) {
    if (!els.statsBody) return;

    const s = stats || {};
    const list = safeArray(facturas);

    const totals = computeCurrentMonthTotals(list);
    const totalHistorico = Number(s?.totalPagado ?? 0);
    const numPagos = Number(s?.numPagos ?? s?.totalRegistros ?? 0);
    const pagosEsteMes = Number(s?.pagosEsteMes ?? totals.pagadas ?? 0);
    const totalEsteMes = Number(s?.totalEsteMes ?? totals.totalMes ?? 0);
    const totalMesAnterior = Number(s?.totalMesAnterior ?? 0);
    const promedioPago = Number(s?.promedioPago ?? 0);
    const promedio6 = Number(s?.promedioUltimos6Meses ?? 0);
    const proyeccion = Number(s?.proyeccionMesActual ?? totalEsteMes);
    const variacion = Number(s?.variacionMensualPct ?? 0);

    const topFacturaHist = safeArray(s?.porFactura)[0] || null;
    const topMetodo = safeArray(s?.byMetodo)[0] || computeTopMetodo(list);

    els.statsBody.innerHTML = `
      <div class="stats-grid">
        ${metricCard("Total histórico", fmtCOP(totalHistorico))}
        ${metricCard("Registros", String(numPagos || 0))}
        ${metricCard("Pagos este mes", String(pagosEsteMes || 0))}
        ${metricCard("Total este mes", fmtCOP(totalEsteMes))}
        ${metricCard("Mes anterior", fmtCOP(totalMesAnterior))}
        ${metricCard("Promedio por pago", fmtCOP(promedioPago))}
        ${metricCard("Promedio base", fmtCOP(promedio6 || promedioPago))}
        ${metricCard("Proyección", fmtCOP(proyeccion))}
      </div>

      <div class="stats-section">
        <h3 class="panel-title">Lectura rápida</h3>
        <div class="stats-grid">
          <div class="stat">
            <div class="k">Variación mensual</div>
            <div class="v">${buildDeltaBadge(formatPercent(variacion), trendClass(variacion))}</div>
            <div class="h muted">Comparado con el mes anterior</div>
          </div>

          <div class="stat">
            <div class="k">Método más usado</div>
            <div class="v">${escapeHtml(topMetodo?.metodo || topMetodo?.[0] || "—")}</div>
            <div class="h muted">Según total registrado</div>
          </div>

          <div class="stat">
            <div class="k">Factura top histórica</div>
            <div class="v">${escapeHtml(topFacturaHist?.factura || "—")}</div>
            <div class="h muted">${topFacturaHist ? fmtCOP(topFacturaHist.total || 0) : "Sin datos"}</div>
          </div>

          <div class="stat">
            <div class="k">Pendientes hoy</div>
            <div class="v">${escapeHtml(String(totals.pendientes))}</div>
            <div class="h muted">${escapeHtml(fmtCOP(totals.valorPendiente))}</div>
          </div>
        </div>
      </div>
    `;
  }

  /* =========================
     RENDER STATS: MÉTODOS
  ========================= */
  function renderStatsMetodos(stats, facturas) {
    if (!els.statsMetodos) return;

    const byMetodo =
      safeArray(stats?.byMetodo).length
        ? safeArray(stats?.byMetodo)
        : buildMetodoFallbackFromFacturas(facturas);

    if (!byMetodo.length) {
      els.statsMetodos.innerHTML = buildEmpty(
        "Sin métodos para mostrar",
        "Aún no hay suficiente información registrada por método.",
        "💳"
      );
      return;
    }

    const tableRows = byMetodo
      .map((x) => {
        const metodo = String(x?.metodo ?? x?.nombre ?? "—");
        const total = Number(x?.total ?? 0);
        const count = Number(x?.count ?? x?.cantidad ?? 0);

        return `
          <div class="row">
            <div>${escapeHtml(metodo)}</div>
            <div>${escapeHtml(fmtCOP(total))}</div>
            <div>${escapeHtml(String(count || "—"))}</div>
          </div>
        `;
      })
      .join("");

    els.statsMetodos.innerHTML = `
      <div class="stats-section">
        <h3 class="panel-title">Distribución por método</h3>
        ${buildBarRows(byMetodo, (x) => x?.metodo ?? x?.nombre, (x) => x?.total)}
      </div>

      <div class="stats-section">
        <h3 class="panel-title">Detalle</h3>
        ${buildMiniTable(["Método", "Total", "Registros"], tableRows)}
      </div>
    `;
  }

  function buildMetodoFallbackFromFacturas(facturas) {
    const map = new Map();

    for (const f of safeArray(facturas)) {
      const metodo = String(f?.metodo ?? "").trim();
      if (!metodo) continue;
      const val = parseCOP(f?.valor) || 0;
      if (!map.has(metodo)) map.set(metodo, { metodo, total: 0, count: 0 });
      const row = map.get(metodo);
      row.total += val;
      row.count += 1;
    }

    return [...map.values()].sort((a, b) => b.total - a.total);
  }

  /* =========================
     RENDER STATS: MESES
  ========================= */
  function renderStatsMeses(stats, facturas) {
    if (!els.statsMeses) return;

    const byMes =
      safeArray(stats?.porMes).length
        ? safeArray(stats?.porMes)
        : safeArray(stats?.byMes).length
          ? safeArray(stats?.byMes)
          : buildMesesFallbackFromFacturas(facturas);

    if (!byMes.length) {
      els.statsMeses.innerHTML = buildEmpty(
        "Sin meses para mostrar",
        "Todavía no hay histórico suficiente para armar la serie mensual.",
        "📅"
      );
      return;
    }

    const normalized = byMes.map((x) => ({
      ym: x?.ym ?? x?.mes ?? "",
      total: Number(x?.total ?? 0),
      count: Number(x?.count ?? x?.cantidad ?? 0),
    }));

    const rowsHtml = normalized
      .slice()
      .sort((a, b) => String(a.ym).localeCompare(String(b.ym)))
      .map((x) => {
        return `
          <div class="row">
            <div>${escapeHtml(formatMonthKey(x.ym))}</div>
            <div>${escapeHtml(fmtCOP(x.total))}</div>
            <div>${escapeHtml(String(x.count || "—"))}</div>
          </div>
        `;
      })
      .join("");

    els.statsMeses.innerHTML = `
      <div class="stats-section">
        <h3 class="panel-title">Histórico mensual</h3>
        ${buildBarRows(
          normalized.slice().sort((a, b) => String(a.ym).localeCompare(String(b.ym))),
          (x) => formatMonthKey(x.ym),
          (x) => x.total
        )}
      </div>

      <div class="stats-section">
        <h3 class="panel-title">Detalle por mes</h3>
        ${buildMiniTable(["Mes", "Total", "Registros"], rowsHtml)}
      </div>
    `;
  }

  function buildMesesFallbackFromFacturas(facturas) {
    const map = new Map();

    for (const f of safeArray(facturas)) {
      if (!f?.ultimo) continue;
      const ym = monthKeyFromDate(f.ultimo);
      if (!ym) continue;
      const val = parseCOP(f?.valor) || 0;

      if (!map.has(ym)) map.set(ym, { ym, total: 0, count: 0 });
      const row = map.get(ym);
      row.total += val;
      row.count += 1;
    }

    return [...map.values()].sort((a, b) => String(a.ym).localeCompare(String(b.ym)));
  }

  /* =========================
     RENDER STATS: PENDIENTES
  ========================= */
  function renderStatsPendientes(stats, facturas) {
    if (!els.statsPendientes) return;

    const list = safeArray(facturas);
    const pendientesEsteMes = list.filter((f) => !isPagoDelMes(f?.ultimo));
    const limit = CFG?.LIMITS?.PENDIENTES_PREVIEW ?? 12;

    if (!pendientesEsteMes.length) {
      els.statsPendientes.innerHTML = `
        <div class="stats-section">
          <h3 class="panel-title">Pendientes del mes</h3>
          <p class="muted">Nada pendiente. Una rareza estadística, pero bienvenida.</p>
        </div>
      `;
      return;
    }

    const rowsHtml = pendientesEsteMes
      .slice(0, limit)
      .map((f) => {
        const nom = String(f?.nombre ?? "—");
        const val = parseCOP(f?.valor) || 0;
        const ref = String(f?.referencia ?? "").trim();
        return `
          <div class="row">
            <div>
              <strong>${escapeHtml(nom)}</strong>
              ${ref ? `<div class="muted">${escapeHtml(ref)}</div>` : ""}
            </div>
            <div>${escapeHtml(fmtCOP(val))}</div>
          </div>
        `;
      })
      .join("");

    els.statsPendientes.innerHTML = `
      <div class="stats-section">
        <h3 class="panel-title">Pendientes este mes: ${escapeHtml(String(pendientesEsteMes.length))}</h3>
        ${buildMiniTable(["Factura", "Valor"], rowsHtml)}
        <p class="muted" style="margin-top:.6rem">
          Mostrando hasta ${limit}. Porque una cosa es administrar y otra leer testamentos de deuda 😅
        </p>
      </div>
    `;
  }

  /* =========================
     RENDER HISTÓRICO
  ========================= */
  function renderHistorico(rows) {
    if (!els.statsHistorico) return;

    const list = safeArray(rows);

    if (!list.length) {
      els.statsHistorico.innerHTML = buildEmpty(
        "No hay movimientos para mostrar",
        "Prueba cambiando los filtros del histórico o registra pagos nuevos.",
        "📚"
      );
      return;
    }

    const sorted = list.slice().sort((a, b) => {
      const da = parseDateFlexible(a?.fecha)?.getTime() || 0;
      const db = parseDateFlexible(b?.fecha)?.getTime() || 0;
      return db - da;
    });

    const rowsHtml = sorted
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
      <div class="stats-section">
        <h3 class="panel-title">Registros encontrados: ${escapeHtml(String(sorted.length))}</h3>
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
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  /* =========================
     RENDER PROJECTION
  ========================= */
  function renderProjection(stats, facturas) {
    if (!els.statsProyeccion) return;

    const s = stats || {};
    const list = safeArray(facturas);

    const totalActual = Number(
      s?.totalEsteMes ??
      list.filter((f) => isPagoDelMes(f?.ultimo)).reduce((acc, f) => acc + (parseCOP(f?.valor) || 0), 0)
    );

    const promedioBase = Number(s?.promedioUltimos6Meses ?? s?.promedioPago ?? 0);
    const proyeccion = Number(s?.proyeccionMesActual ?? totalActual);
    const variacion = promedioBase ? ((proyeccion - promedioBase) / promedioBase) * 100 : 0;
    const deltaTxt = promedioBase ? formatPercent(variacion) : "Sin base suficiente";
    const deltaCls = promedioBase ? trendClass(variacion) : "neutral";

    els.statsProyeccion.innerHTML = `
      <div class="stats-grid">
        ${metricCard("Total actual del mes", fmtCOP(totalActual))}
        ${metricCard("Promedio base", fmtCOP(promedioBase))}
        ${metricCard("Proyección de cierre", fmtCOP(proyeccion))}
        <div class="stat">
          <div class="k">Variación estimada</div>
          <div class="v">${buildDeltaBadge(deltaTxt, deltaCls)}</div>
          <div class="h muted">Comparado contra la base disponible</div>
        </div>
      </div>

      <div class="stats-section">
        <h3 class="panel-title">Lectura</h3>
        <p class="muted">
          ${
            promedioBase
              ? `Si el comportamiento del mes sigue así, el cierre proyectado sería de ${fmtCOP(proyeccion)}.`
              : "Todavía hace falta mejor base histórica para que esta proyección sea menos intuitiva y más seria."
          }
        </p>
      </div>
    `;
  }

  /* =========================
     RENDER STATS ORCHESTRATOR
  ========================= */
  function renderStats(stats, facturas) {
    renderStatsResumen(stats, facturas);
    renderStatsMetodos(stats, facturas);
    renderStatsMeses(stats, facturas);
    renderStatsPendientes(stats, facturas);
    renderProjection(stats, facturas);
  }

  /* =========================
     OPTIONAL RENDERERS
  ========================= */
  function renderMetodoOptions(selectEl, methods) {
    if (!selectEl) return;
    const list = Array.isArray(methods) ? methods : [];
    selectEl.innerHTML =
      `<option value="all">Todos</option>` +
      list.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join("");
  }

  /* =========================
     OPTIONAL STATE BIND
  ========================= */
  function bindState() {
    if (!STATE || typeof STATE.on !== "function") return;

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
    normalizeText,
    parseDateFlexible,

    // ui
    toast,
    setBusy,

    // renderers
    renderTable,
    renderKPIs,
    renderStats,
    renderHistorico,
    renderProjection,
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

  try {
    bindState();
  } catch (e) {
    DBG("UI bindState failed:", e?.message || e);
  }
})();