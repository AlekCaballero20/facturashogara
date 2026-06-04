"use strict";

(() => {
  if (window.__HM_FACTURAS__) return;
  window.__HM_FACTURAS__ = true;

  const { CFG, STATE, API, UI } = window;
  const $ = UI.$;
  const $$ = UI.$$;
  let activeModal = null;
  let lastFocus = null;
  let statsTab = "resumen";

  const els = {
    q: $("#q"), fEstado: $("#fEstado"), fMetodo: $("#fMetodo"), fCategoria: $("#fCategoria"), fResponsable: $("#fResponsable"), fOrden: $("#fOrden"),
    payForm: $("#payForm"), editForm: $("#editForm"), closeMonthForm: $("#closeMonthForm"),
  };

  function debounce(fn, wait) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), wait); }; }
  function openModal(id) {
    const modal = typeof id === "string" ? $(id) : id;
    if (!modal) return;
    lastFocus = document.activeElement;
    activeModal = modal;
    modal.classList.remove("hide");
    document.body.style.overflow = "hidden";
    setTimeout(() => modal.querySelector("button,input,select,textarea")?.focus(), 0);
  }
  function closeModal(modal) {
    if (!modal) return;
    modal.classList.add("hide");
    if (activeModal === modal) activeModal = null;
    if (!$(".modal:not(.hide)")) document.body.style.overflow = "";
    lastFocus?.focus?.();
  }
  function closeAll() { $$(".modal").forEach(closeModal); }
  function parseMoney(v) { return STATE.num(v); }
  function validURL(v) {
    if (!String(v || "").trim()) return true;
    try { new URL(v); return true; } catch { return false; }
  }
  function htmlDateToDMY(v) {
    if (!v) return "";
    const [y, m, d] = v.split("-");
    return `${Number(d)}/${Number(m)}/${y}`;
  }
  function download(name, content, type = "text/csv;charset=utf-8") {
    const blob = new Blob([content], { type });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function csv(rows) {
    return rows.map((row) => row.map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
  }

  async function refresh(force = true) {
    try {
      UI.busy(true);
      const rows = await API.listarFacturas({ force });
      STATE.setFacturas(rows);
      UI.renderFilterOptions();
      renderAll();
      loadStatsSoft();
    } catch (err) {
      console.error(err);
      UI.toast("No se pudo cargar la información. Revisa la conexión o el despliegue de Apps Script.", "error");
    } finally {
      UI.busy(false);
    }
  }
  async function loadStatsSoft() {
    try {
      const [stats, hist] = await Promise.all([API.stats({ force: true }), API.historial({}, { force: true })]);
      STATE.setStats(stats);
      STATE.setHistorico(hist);
      populateHistoryFilters();
      renderAll();
      if (!$(`#statsModal`).classList.contains("hide")) UI.renderStats(statsTab, filterHistory());
    } catch (err) {
      console.warn(err);
    }
  }
  function renderAll() {
    UI.renderKPIs();
    UI.renderDueDashboard();
    UI.renderTable(STATE.getFiltered());
  }
  function applyFiltersFromUI() {
    STATE.setFilters({
      q: els.q.value,
      estado: els.fEstado.value,
      metodo: els.fMetodo.value,
      categoria: els.fCategoria.value,
      responsable: els.fResponsable.value,
      orden: els.fOrden.value,
    });
    UI.renderTable(STATE.getFiltered());
  }
  function fillPayForm(f = null) {
    $("#payForm").reset();
    $("#payFecha").value = window.__TIME__.todayInputValue();
    $("#payRow").value = f?.row || "";
    $("#paySearch").value = f ? f.factura : "";
    $("#payValorBase").value = f ? UI.fmtCOP(f.valorBase) : "";
    $("#payValor").value = f ? String(f.valorBase) : "";
    $("#payMetodo").value = f?.metodo || "";
    $("#payCategoria").value = f?.categoria || "";
    $("#payResponsable").value = f?.responsable || "";
    $("#payNota").value = "";
    $("#payComprobante").value = "";
    $("#paySelectedInfo").classList.toggle("hide", !f);
    $("#paySelectedInfo").classList.toggle("warning", !!f && f.estadoCalculado === "pagada");
    $("#paySelectedInfo").innerHTML = f ? `${UI.badge(f.estadoCalculado)} <strong>${UI.esc(f.factura)}</strong> · ${UI.esc(f.referencia || "Sin referencia")}<br>${f.estadoCalculado === "pagada" ? "Esta factura ya aparece pagada este mes. Puedes registrar otro pago si fue parcial, duplicado o ajuste." : UI.esc(f.venceTexto || "")}` : "";
    $("#payPortalWrap").classList.toggle("hide", !f?.linkPago);
    $("#payPortalWrap").innerHTML = f?.linkPago ? `<a class="btn ghost" href="${UI.esc(f.linkPago)}" target="_blank" rel="noopener">Abrir portal de pago</a>` : "";
  }
  function openPay(row) {
    fillPayForm(row ? STATE.getByRow(row) : null);
    openModal("#payModal");
  }
  function fillEditForm(f) {
    $("#editForm").reset();
    $("#editRow").value = f.row;
    $("#editSubtitle").textContent = `${f.factura} · ${f.referencia || "Sin referencia"}`;
    $("#editValorBase").value = String(f.valorBase || "");
    $("#editMetodo").value = f.metodo || "";
    $("#editDia").value = f.diaVencimiento || "";
    $("#editCategoria").value = f.categoria || "";
    $("#editResponsable").value = f.responsable || "";
    $("#editPresupuesto").value = f.presupuestoMensual || "";
    $("#editLinkPago").value = f.linkPago || "";
    $("#editNota").value = f.nota || "";
    $("#editActiva").checked = f.activa !== false;
  }
  function openEdit(row) {
    const f = STATE.getByRow(row);
    if (!f) return;
    fillEditForm(f);
    openModal("#editModal");
  }
  async function submitPay(ev) {
    ev.preventDefault();
    let f = STATE.getByRow($("#payRow").value) || STATE.findFactura($("#paySearch").value);
    const valorPagado = parseMoney($("#payValor").value);
    if (!f && !$("#paySearch").value.trim()) return UI.toast("Selecciona o busca una factura.", "error");
    if (!valorPagado || valorPagado <= 0) return UI.toast("Escribe un valor pagado positivo.", "error");
    if (!validURL($("#payComprobante").value)) return UI.toast("El comprobante debe ser una URL válida.", "error");
    const payload = {
      row: f?.row || "",
      factura: f?.factura || $("#paySearch").value.trim(),
      valorPagado,
      metodo: $("#payMetodo").value.trim(),
      fecha: htmlDateToDMY($("#payFecha").value),
      categoria: $("#payCategoria").value.trim(),
      responsable: $("#payResponsable").value.trim(),
      nota: $("#payNota").value.trim(),
      comprobante: $("#payComprobante").value.trim(),
    };
    try {
      UI.busy(true);
      if (payload.row) await API.registrarPago(payload);
      else await API.quickPay(payload);
      UI.toast("Pago registrado correctamente.", "ok");
      closeModal($("#payModal"));
      await refresh(true);
    } catch (err) {
      console.error(err);
      UI.toast("No se pudo registrar el pago. Inténtalo nuevamente.", "error");
    } finally {
      UI.busy(false);
    }
  }
  async function submitEdit(ev) {
    ev.preventDefault();
    const payload = {
      row: $("#editRow").value,
      valorBase: parseMoney($("#editValorBase").value),
      metodo: $("#editMetodo").value.trim(),
      diaVencimiento: $("#editDia").value,
      categoria: $("#editCategoria").value.trim(),
      responsable: $("#editResponsable").value.trim(),
      presupuestoMensual: parseMoney($("#editPresupuesto").value),
      linkPago: $("#editLinkPago").value.trim(),
      nota: $("#editNota").value.trim(),
      activa: $("#editActiva").checked ? "Sí" : "No",
    };
    if (!payload.valorBase || payload.valorBase <= 0) return UI.toast("El valor base debe ser positivo.", "error");
    if (payload.diaVencimiento && (Number(payload.diaVencimiento) < 1 || Number(payload.diaVencimiento) > 31)) return UI.toast("El día de vencimiento debe estar entre 1 y 31.", "error");
    if (payload.presupuestoMensual < 0) return UI.toast("El presupuesto no puede ser negativo.", "error");
    if (!validURL(payload.linkPago)) return UI.toast("El link de pago debe ser una URL válida.", "error");
    try {
      UI.busy(true);
      await API.editarFactura(payload);
      UI.toast("Factura actualizada.", "ok");
      closeModal($("#editModal"));
      await refresh(true);
    } catch (err) {
      console.error(err);
      UI.toast("No se pudo editar la factura. Revisa la conexión o el despliegue.", "error");
    } finally {
      UI.busy(false);
    }
  }
  async function openHistory(row) {
    const f = STATE.getByRow(row);
    if (!f) return;
    openModal("#historyModal");
    $("#historyBody").innerHTML = UI.emptyHTML("Cargando historial", "Un momento...");
    try {
      const rows = await API.historial({ factura: f.factura, referencia: f.referencia, limit: 100 }, { force: true });
      const normalized = rows.map(STATE.normalizeHistorico);
      UI.renderFacturaHistory(f, normalized);
    } catch {
      const local = STATE.getHistorico().filter((r) => STATE.norm(r.factura) === STATE.norm(f.factura) || STATE.norm(r.referencia) === STATE.norm(f.referencia));
      UI.renderFacturaHistory(f, local);
    }
  }
  function populateHistoryFilters() {
    const rows = STATE.getHistorico();
    const years = [...new Set(rows.map((r) => STATE.parseDate(r.fecha)?.getFullYear()).filter(Boolean))].sort((a, b) => b - a);
    const months = [...new Set(rows.map((r) => r.mes).filter(Boolean))].sort().reverse();
    const methods = [...new Set(rows.map((r) => r.metodo).filter(Boolean))].sort();
    const cats = [...new Set(rows.map((r) => r.categoria).filter(Boolean))].sort();
    const set = (sel, vals, all) => { const el = $(sel); if (el) el.innerHTML = `<option value="all">${all}</option>` + vals.map((v) => `<option value="${UI.esc(v)}">${UI.esc(v)}</option>`).join(""); };
    set("#historyYear", years, "Todos"); set("#historyMonth", months, "Todos"); set("#historyMethod", methods, "Todos"); set("#historyCategory", cats, "Todas");
  }
  function filterHistory() {
    const q = STATE.norm($("#historyQ").value);
    const y = $("#historyYear").value, m = $("#historyMonth").value, method = $("#historyMethod").value, cat = $("#historyCategory").value;
    return STATE.getHistorico().filter((r) => {
      const d = STATE.parseDate(r.fecha);
      if (y !== "all" && String(d?.getFullYear()) !== String(y)) return false;
      if (m !== "all" && r.mes !== m) return false;
      if (method !== "all" && r.metodo !== method) return false;
      if (cat !== "all" && r.categoria !== cat) return false;
      if (q && ![r.factura, r.referencia, r.metodo, r.categoria, r.nota].some((v) => STATE.norm(v).includes(q))) return false;
      return true;
    });
  }
  async function openStats() {
    openModal("#statsModal");
    UI.renderStats(statsTab, filterHistory());
    if (!STATE.getStats()) await loadStatsSoft();
  }
  async function previewMonth() {
    const mes = $("#closeMonthInput").value || window.__TIME__.monthInputValue();
    $("#closeMonthInput").value = mes;
    UI.renderClosePreview(null);
    try {
      const res = await API.resumenMes({ mes });
      UI.renderClosePreview(res.resumen || res);
    } catch {
      const d = STATE.dashboard();
      UI.renderClosePreview({ totalPagado: d.valorPagadoMes, totalPendiente: d.valorPendienteMes, facturasPagadas: d.pagadasMes.length, facturasPendientes: STATE.getFacturas().length - d.pagadasMes.length, facturasVencidas: d.vencidas.length, valorVencido: d.vencidasValor });
      UI.toast("Se mostró un resumen local porque el backend no respondió.", "error");
    }
  }
  async function submitCloseMonth(ev) {
    ev.preventDefault();
    if (!confirm("¿Cerrar este mes y guardar el snapshot en Google Sheets?")) return;
    try {
      await API.cerrarMes({ mes: $("#closeMonthInput").value, observaciones: $("#closeMonthNotes").value.trim() });
      UI.toast("Cierre mensual guardado.", "ok");
      closeModal($("#closeMonthModal"));
    } catch (err) {
      UI.toast(err.message || "No se pudo hacer el cierre mensual.", "error");
    }
  }
  function exportFiltered() {
    const rows = [["Factura", "Referencia", "Valor Base", "Estado", "Vence", "Método", "Categoría", "Responsable", "Último Pago"], ...STATE.getFiltered().map((f) => [f.factura, f.referencia, f.valorBase, f.estadoCalculado, f.venceTexto, f.metodo, f.categoria, f.responsable, f.ultimoPago])];
    if (rows.length <= 1) return UI.toast("No hay datos para exportar.", "error");
    download("facturas-filtradas.csv", csv(rows));
  }
  async function exportHistory() {
    if (!STATE.getHistorico().length) await loadStatsSoft();
    const rows = [["Fecha", "Mes", "Factura", "Referencia", "Valor Pagado", "Método", "Categoría", "Responsable", "Nota", "Comprobante"], ...STATE.getHistorico().map((r) => [r.fecha, r.mes, r.factura, r.referencia, r.valorPagado, r.metodo, r.categoria, r.responsable, r.nota, r.comprobante])];
    if (rows.length <= 1) return UI.toast("No hay histórico para exportar.", "error");
    download("historico-pagos.csv", csv(rows));
  }
  function exportMonthSummary() {
    const d = STATE.dashboard();
    download("resumen-mensual.txt", `Hogar Manager · Facturas\nMes: ${window.__TIME__.monthInputValue()}\nTotal pagado: ${UI.fmtCOP(d.valorPagadoMes)}\nTotal pendiente: ${UI.fmtCOP(d.valorPendienteMes)}\nFacturas pagadas: ${d.pagadasMes.length}\nFacturas pendientes: ${STATE.getFacturas().length - d.pagadasMes.length}\nFacturas vencidas: ${d.vencidas.length}\n`);
  }

  document.addEventListener("click", (ev) => {
    const close = ev.target.closest("[data-close]");
    if (close) return closeModal(close.closest(".modal"));
    const btn = ev.target.closest("[data-action]");
    if (!btn) return;
    const row = btn.dataset.row;
    if (btn.dataset.action === "pay") openPay(row);
    if (btn.dataset.action === "edit") openEdit(row);
    if (btn.dataset.action === "history") openHistory(row);
  });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") closeAll(); });
  ["input", "change"].forEach((eventName) => {
    [els.q, els.fEstado, els.fMetodo, els.fCategoria, els.fResponsable, els.fOrden].forEach((el) => el?.addEventListener(eventName, eventName === "input" ? debounce(applyFiltersFromUI, CFG.DEBOUNCE_MS) : applyFiltersFromUI));
  });
  $("#btnClearFilters").addEventListener("click", () => {
    els.q.value = ""; els.fEstado.value = "all"; els.fMetodo.value = "all"; els.fCategoria.value = "all"; els.fResponsable.value = "all"; els.fOrden.value = "urgencia"; applyFiltersFromUI();
  });
  $("#btnRefresh").addEventListener("click", () => refresh(true));
  $("#btnOpenPay").addEventListener("click", () => openPay(null));
  $("#btnStats").addEventListener("click", openStats);
  $("#btnExport").addEventListener("click", () => openModal("#exportModal"));
  $("#btnCloseMonth").addEventListener("click", () => { $("#closeMonthInput").value = window.__TIME__.monthInputValue(); openModal("#closeMonthModal"); previewMonth(); });
  $("#paySearch").addEventListener("change", () => fillPayForm(STATE.findFactura($("#paySearch").value)));
  els.payForm.addEventListener("submit", submitPay);
  els.editForm.addEventListener("submit", submitEdit);
  $("#btnPreviewMonth").addEventListener("click", previewMonth);
  els.closeMonthForm.addEventListener("submit", submitCloseMonth);
  $("#exportFiltered").addEventListener("click", exportFiltered);
  $("#exportHistory").addEventListener("click", exportHistory);
  $("#exportMonthSummary").addEventListener("click", exportMonthSummary);
  $$("#statsModal .tab").forEach((tab) => tab.addEventListener("click", () => {
    statsTab = tab.dataset.tab;
    $$("#statsModal .tab").forEach((t) => t.classList.toggle("is-active", t === tab));
    UI.renderStats(statsTab, filterHistory());
  }));
  ["#historyQ", "#historyYear", "#historyMonth", "#historyMethod", "#historyCategory"].forEach((sel) => $(sel)?.addEventListener("input", () => UI.renderStats("historico", filterHistory())));
  ["#historyYear", "#historyMonth", "#historyMethod", "#historyCategory"].forEach((sel) => $(sel)?.addEventListener("change", () => UI.renderStats("historico", filterHistory())));

  STATE.on("filtered", UI.renderTable);
  refresh(false);
})();
