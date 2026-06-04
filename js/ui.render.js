"use strict";

(function () {
  if (window.UI) return;
  const CFG = window.CFG;
  const STATE = window.STATE;
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const money = new Intl.NumberFormat(CFG.LOCALE, { style: "currency", currency: CFG.CURRENCY, maximumFractionDigits: 0 });
  const fmtCOP = (n) => money.format(Number(n || 0));
  const esc = (s) => String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const els = {
    msg: $("#mensaje"), loader: $("#loader"), main: $("#main"), tbody: $("#tbody"), empty: $("#emptyState"),
    kpiGrid: $("#kpiGrid"), due: $("#dueDashboard"), stats: $("#statsContent"), historyBody: $("#historyBody"),
    closePreview: $("#closeMonthPreview"),
  };
  function toast(text, type = "ok") {
    if (!els.msg) return;
    els.msg.textContent = text;
    els.msg.className = type;
    els.msg.classList.remove("hide");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => els.msg.classList.add("hide"), CFG.TOAST_MS);
  }
  function busy(on) {
    els.loader?.classList.toggle("hide", !on);
    els.main?.setAttribute("aria-busy", on ? "true" : "false");
  }
  function badge(status) {
    const labels = { pagada: "Pagada", pendiente: "Pendiente", proxima: "Próxima", urgente: "Urgente", hoy: "Vence hoy", vencida: "Vencida", sin_vencimiento: "Sin vencimiento" };
    return `<span class="badge ${esc(status || "pendiente")}">${esc(labels[status] || "Pendiente")}</span>`;
  }
  function kpi(title, value, hint = "") {
    return `<article class="kpi-card"><div class="k">${esc(title)}</div><div class="v">${esc(value)}</div>${hint ? `<div class="h muted">${esc(hint)}</div>` : ""}</article>`;
  }
  function renderKPIs() {
    const d = STATE.dashboard();
    const stats = STATE.getStats() || {};
    const presupuesto = Number(stats.presupuestoTotalMes || STATE.getFacturas().reduce((a, f) => a + Number(f.presupuestoMensual || 0), 0));
    const consumido = presupuesto ? Math.round(((d.valorPagadoMes + d.valorPendienteMes) / presupuesto) * 100) : 0;
    els.kpiGrid.innerHTML = [
      kpi("Total pagado este mes", fmtCOP(stats.totalEsteMes ?? d.valorPagadoMes), `${d.pagadasMes.length} factura(s) pagadas`),
      kpi("Pendiente del mes", String(STATE.getFacturas().length - d.pagadasMes.length), `${fmtCOP(d.valorPendienteMes)} por pagar`),
      kpi("Facturas vencidas", String(d.vencidas.length), fmtCOP(d.vencidasValor)),
      kpi("Próximo vencimiento", d.proximoVencimiento ? d.proximoVencimiento.factura : "—", d.proximoVencimiento?.venceTexto || "Sin alertas"),
      kpi("Método más usado", stats.metodoTop?.metodo || stats.byMetodo?.[0]?.metodo || "—", "Según histórico"),
      kpi("Categoría más alta", stats.categoriaTop?.categoria || stats.byCategoria?.[0]?.categoria || "—", "Según histórico"),
      kpi("Presupuesto consumido", presupuesto ? `${consumido}%` : "—", presupuesto ? `Presupuesto: ${fmtCOP(presupuesto)}` : "Sin presupuesto"),
      kpi("Valor pendiente", fmtCOP(d.valorPendienteMes), "Mes actual"),
    ].join("");
  }
  function dueCard(label, value, hint) {
    return `<div class="due-card"><strong>${esc(value)}</strong><span>${esc(label)}</span>${hint ? `<span class="cell-sub">${esc(hint)}</span>` : ""}</div>`;
  }
  function renderDueDashboard() {
    const d = STATE.dashboard();
    els.due.innerHTML = [
      dueCard("Vencidas", d.vencidas.length, fmtCOP(d.vencidasValor)),
      dueCard("Vencen hoy", d.hoy.length, fmtCOP(d.hoy.reduce((a, f) => a + f.valorBase, 0))),
      dueCard("Vencen esta semana", d.semana.length, fmtCOP(d.totalSemana)),
      dueCard("Total a pagar esta semana", fmtCOP(d.totalSemana)),
      dueCard("Próximo vencimiento", d.proximoVencimiento ? d.proximoVencimiento.factura : "—", d.proximoVencimiento?.venceTexto || ""),
      dueCard("Valor pendiente del mes", fmtCOP(d.valorPendienteMes)),
    ].join("");
  }
  function actionButton(action, row, text, extra = "") {
    return `<button class="btn ghost" type="button" data-action="${action}" data-row="${esc(row)}" ${extra}>${esc(text)}</button>`;
  }
  function rowHTML(f) {
    return `<tr class="row-${esc(f.estadoCalculado)}" data-row="${esc(f.row)}">
      <td data-label="Factura"><span class="cell-main">${esc(f.factura || "—")}</span><span class="cell-sub">${esc(f.nota || "")}</span></td>
      <td data-label="Referencia">${esc(f.referencia || "—")}</td>
      <td data-label="Valor base">${esc(fmtCOP(f.valorBase))}</td>
      <td data-label="Estado">${badge(f.estadoCalculado)}</td>
      <td data-label="Vence"><span class="cell-main">${esc(f.venceTexto || "—")}</span><span class="cell-sub">${esc(f.fechaVencimientoTexto || (f.diaVencimiento ? `Día ${f.diaVencimiento}` : ""))}</span></td>
      <td data-label="Método">${esc(f.metodo || "—")}</td>
      <td data-label="Categoría">${esc(f.categoria || "—")}</td>
      <td data-label="Responsable">${esc(f.responsable || "—")}</td>
      <td data-label="Último pago">${esc(f.ultimoPago || "—")}</td>
      <td data-label="Acciones"><div class="actions">
        ${actionButton("pay", f.row, "Registrar pago")}
        ${actionButton("edit", f.row, "Editar")}
        ${actionButton("history", f.row, "Historial")}
        ${f.linkPago ? `<a class="btn ghost" href="${esc(f.linkPago)}" target="_blank" rel="noopener">Abrir portal</a>` : ""}
      </div></td>
    </tr>`;
  }
  function renderTable(rows) {
    els.tbody.innerHTML = rows.map(rowHTML).join("");
    els.empty?.classList.toggle("hide", rows.length > 0);
  }
  function options(select, values, allLabel) {
    if (!select) return;
    const current = select.value;
    select.innerHTML = `<option value="all">${esc(allLabel)}</option>` + values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
    select.value = values.includes(current) ? current : "all";
  }
  function renderFilterOptions() {
    options($("#fMetodo"), STATE.extractMetodos(), "Todos");
    options($("#fCategoria"), STATE.extractCategorias(), "Todas");
    options($("#fResponsable"), STATE.extractResponsables(), "Todos");
    const list = $("#facturasList");
    if (list) list.innerHTML = STATE.getFacturas().map((f) => `<option value="${esc(f.factura)}">${esc(f.referencia || "")}</option>`).join("");
  }
  function statCard(t, v, h = "") { return `<div class="stat"><div class="k">${esc(t)}</div><div class="v">${esc(v)}</div>${h ? `<div class="h muted">${esc(h)}</div>` : ""}</div>`; }
  function bars(items, labelKey, valueKey) {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return emptyHTML("Sin datos suficientes", "Registra pagos para ver esta sección.");
    const max = Math.max(...list.map((x) => Number(x[valueKey] || 0)), 1);
    return `<div class="bars">${list.map((x) => {
      const val = Number(x[valueKey] || 0);
      return `<div class="bar-row"><div class="bar-meta"><strong>${esc(x[labelKey] || x.ym || x.mes || "—")}</strong><span>${esc(fmtCOP(val))}</span></div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(4, Math.round((val / max) * 100))}%"></div></div></div>`;
    }).join("")}</div>`;
  }
  function emptyHTML(title, sub) {
    return `<div class="empty"><div class="empty-title">${esc(title)}</div><div class="empty-sub muted">${esc(sub || "")}</div></div>`;
  }
  function table(headers, rows) {
    return `<div class="mini-table-wrap"><table class="mini-table"><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  function renderStats(tab, historyRows = null) {
    const s = STATE.getStats() || {};
    const d = STATE.dashboard();
    const h = historyRows || STATE.getHistorico();
    $(".stats-filter-row")?.classList.toggle("is-visible", tab === "historico");
    if (tab === "resumen") {
      els.stats.innerHTML = `<div class="stats-grid">
        ${statCard("Total pagado histórico", fmtCOP(s.totalPagadoHistorico ?? s.totalPagado ?? 0))}
        ${statCard("Total pagado este mes", fmtCOP(s.totalEsteMes ?? 0))}
        ${statCard("Mes anterior", fmtCOP(s.totalMesAnterior ?? 0))}
        ${statCard("Variación mensual", `${Number(s.variacionMensualPct || 0).toFixed(1)}%`)}
        ${statCard("Promedio últimos 6 meses", fmtCOP(s.promedioUltimos6Meses ?? 0))}
        ${statCard("Proyección mes actual", fmtCOP(s.proyeccionMesActual ?? 0))}
        ${statCard("Valor pendiente", fmtCOP(s.valorPendienteMes ?? d.valorPendienteMes))}
        ${statCard("Valor vencido", fmtCOP(s.valorVencido ?? d.vencidasValor))}
        ${statCard("Top factura del mes", s.topFacturaMes?.factura || "—", s.topFacturaMes ? fmtCOP(s.topFacturaMes.total) : "")}
      </div>`;
    } else if (tab === "meses") {
      els.stats.innerHTML = bars((s.porMes || s.byMes || []).slice(-CFG.LIMITS.MONTHS_PREVIEW), "label", "total");
    } else if (tab === "metodos") {
      els.stats.innerHTML = bars(s.porMetodo || s.byMetodo || [], "metodo", "total");
    } else if (tab === "categorias") {
      els.stats.innerHTML = bars(s.porCategoria || s.byCategoria || [], "categoria", "total");
    } else if (tab === "pendientes") {
      const rows = [...d.vencidas, ...d.hoy, ...d.semana.filter((f) => f.estadoCalculado !== "hoy")];
      els.stats.innerHTML = rows.length ? table(["Factura", "Estado", "Valor", "Vence"], rows.map((f) => `<tr><td>${esc(f.factura)}</td><td>${badge(f.estadoCalculado)}</td><td>${esc(fmtCOP(f.valorBase))}</td><td>${esc(f.venceTexto)}</td></tr>`)) : emptyHTML("No hay pendientes críticos", "Todo está bajo control por ahora.");
    } else if (tab === "historico") {
      els.stats.innerHTML = h.length ? table(["Fecha", "Factura", "Valor", "Método", "Categoría", "Nota"], h.slice(0, CFG.LIMITS.HISTORY_PREVIEW).map((r) => `<tr><td>${esc(r.fecha)}</td><td>${esc(r.factura)}</td><td>${esc(fmtCOP(r.valorPagado))}</td><td>${esc(r.metodo || "—")}</td><td>${esc(r.categoria || "—")}</td><td>${esc(r.nota || "")}</td></tr>`)) : emptyHTML("Sin histórico", "Aún no hay pagos para mostrar.");
    } else if (tab === "presupuesto") {
      const presupuesto = Number(s.presupuestoTotalMes || STATE.getFacturas().reduce((a, f) => a + Number(f.presupuestoMensual || 0), 0));
      const usado = Number(s.totalEsteMes || 0) + d.valorPendienteMes;
      els.stats.innerHTML = `<div class="stats-grid">${statCard("Presupuesto total mensual", fmtCOP(presupuesto))}${statCard("Pagado + pendiente", fmtCOP(usado))}${statCard("Diferencia", fmtCOP(presupuesto - usado))}${statCard("Porcentaje consumido", presupuesto ? `${Math.round((usado / presupuesto) * 100)}%` : "—")}</div>`;
    }
  }
  function renderFacturaHistory(f, rows) {
    const total = rows.reduce((a, r) => a + r.valorPagado, 0);
    const avg = rows.length ? total / rows.length : 0;
    $("#historyTitle").textContent = `Historial · ${f.factura}`;
    $("#historySubtitle").textContent = f.referencia || "";
    els.historyBody.innerHTML = `<div class="stats-grid">${statCard("Total histórico", fmtCOP(total))}${statCard("Promedio de pago", fmtCOP(avg))}${statCard("Registros", String(rows.length))}</div>` +
      (rows.length ? table(["Fecha", "Valor pagado", "Método", "Categoría", "Responsable", "Nota", "Comprobante"], rows.map((r) => `<tr><td>${esc(r.fecha)}</td><td>${esc(fmtCOP(r.valorPagado))}</td><td>${esc(r.metodo || "—")}</td><td>${esc(r.categoria || "—")}</td><td>${esc(r.responsable || "—")}</td><td>${esc(r.nota || "")}</td><td>${r.comprobante ? `<a href="${esc(r.comprobante)}" target="_blank" rel="noopener">Abrir</a>` : "—"}</td></tr>`)) : emptyHTML("Sin pagos registrados", "No hay histórico para esta factura."));
  }
  function renderClosePreview(summary) {
    if (!summary) { els.closePreview.innerHTML = emptyHTML("Sin resumen", "Selecciona un mes para previsualizar."); return; }
    els.closePreview.innerHTML = `<div class="stats-grid">${statCard("Total pagado", fmtCOP(summary.totalPagado))}${statCard("Total pendiente", fmtCOP(summary.totalPendiente))}${statCard("Facturas pagadas", String(summary.facturasPagadas))}${statCard("Facturas pendientes", String(summary.facturasPendientes))}${statCard("Facturas vencidas", String(summary.facturasVencidas))}${statCard("Valor vencido", fmtCOP(summary.valorVencido))}</div>`;
  }
  window.UI = Object.freeze({ $, $$, fmtCOP, esc, toast, busy, badge, renderKPIs, renderDueDashboard, renderTable, renderFilterOptions, renderStats, renderFacturaHistory, renderClosePreview, emptyHTML });
})();
