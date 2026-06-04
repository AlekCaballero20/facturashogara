"use strict";

(function () {
  if (window.STATE) return;

  const store = {
    facturas: [],
    filtered: [],
    stats: null,
    historico: [],
    cierres: [],
    filters: { q: "", estado: "all", metodo: "all", categoria: "all", responsable: "all", orden: "urgencia" },
    ui: { activeStatsTab: "resumen", selectedFactura: null },
  };

  const listeners = new Map();
  const emit = (event, payload) => (listeners.get(event) || []).forEach((fn) => fn(payload));
  const on = (event, fn) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => listeners.get(event).delete(fn);
  };

  function norm(v) {
    return String(v ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }
  function text(v) { return String(v ?? "").trim(); }
  function num(v) {
    if (typeof v === "number") return Number.isFinite(v) ? v : 0;
    const digits = String(v ?? "").replace(/[^\d.-]/g, "");
    return digits ? Number(digits) || 0 : 0;
  }
  function parseDate(v) {
    if (!v) return null;
    if (v instanceof Date && !isNaN(v)) return v;
    const s = String(v).trim();
    let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (m) return new Date(Number(m[3].length === 2 ? "20" + m[3] : m[3]), Number(m[2]) - 1, Number(m[1]));
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const d = new Date(s);
    return isNaN(d) ? null : d;
  }
  function fmtInputDate(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function monthKey(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  function isPaidThisMonth(fecha) {
    const d = parseDate(fecha);
    const h = new Date();
    return !!d && d.getFullYear() === h.getFullYear() && d.getMonth() === h.getMonth();
  }
  function lastDay(year, monthIndex) {
    return new Date(year, monthIndex + 1, 0).getDate();
  }
  function calcLocalStatus(f, ref = new Date()) {
    if (isPaidThisMonth(f.ultimoPago)) {
      return { estadoCalculado: "pagada", diasParaVencer: null, fechaVencimiento: "", venceTexto: "Pagada este mes" };
    }
    const dia = Number(f.diaVencimiento);
    if (!dia || dia < 1 || dia > 31) {
      return { estadoCalculado: "sin_vencimiento", diasParaVencer: null, fechaVencimiento: "", venceTexto: "Sin vencimiento" };
    }
    const hoy = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
    const venc = new Date(ref.getFullYear(), ref.getMonth(), Math.min(dia, lastDay(ref.getFullYear(), ref.getMonth())));
    const diff = Math.ceil((venc - hoy) / 86400000);
    let estado = "pendiente";
    if (diff < 0) estado = "vencida";
    else if (diff === 0) estado = "hoy";
    else if (diff <= 3) estado = "urgente";
    else if (diff <= 7) estado = "proxima";
    const texto = diff < 0 ? `Vencida hace ${Math.abs(diff)} día${Math.abs(diff) === 1 ? "" : "s"}` :
      diff === 0 ? "Vence hoy" : diff <= 7 ? `Vence en ${diff} día${diff === 1 ? "" : "s"}` : "Pendiente";
    return {
      estadoCalculado: estado,
      diasParaVencer: diff,
      fechaVencimiento: fmtInputDate(venc),
      fechaVencimientoTexto: venc.toLocaleDateString("es-CO"),
      venceTexto: texto,
    };
  }
  function normalizeFactura(raw = {}) {
    const base = {
      row: Number(raw.row || raw.fila || 0),
      factura: text(raw.factura || raw.nombre || raw.Nombre || raw.Factura),
      referencia: text(raw.referencia || raw.ref || raw.Referencia || raw.Ref),
      valorBase: num(raw.valorBase ?? raw.valor ?? raw.valorEstimado ?? raw["Valor Base"]),
      estado: text(raw.estado || raw.estadoMensual),
      metodo: text(raw.metodo || raw.metodoPago || raw["Método de Pago"]),
      ultimoPago: text(raw.ultimoPago || raw.ultimo || raw.fechaPago || raw["Fecha de Pago"]),
      diaVencimiento: Number(raw.diaVencimiento || raw.vencimiento || raw.diaCorte || raw["Día de Vencimiento"] || 0) || "",
      categoria: text(raw.categoria || raw["Categoría"]),
      responsable: text(raw.responsable),
      presupuestoMensual: num(raw.presupuestoMensual ?? raw.presupuesto),
      linkPago: text(raw.linkPago || raw["Link de Pago"]),
      comprobante: text(raw.comprobante),
      nota: text(raw.nota),
      activa: raw.activa === false || norm(raw.activa) === "no" || norm(raw.activa) === "inactiva" ? false : true,
      raw,
    };
    const backendStatus = text(raw.estadoCalculado);
    return { ...base, ...calcLocalStatus(base), ...(backendStatus ? { estadoCalculado: backendStatus } : {}) };
  }
  function normalizeHistorico(raw = {}) {
    const fecha = text(raw.fecha || raw.fechaPago || raw["Fecha de Pago"]);
    return {
      row: Number(raw.row || 0),
      fecha,
      mes: text(raw.mes) || (parseDate(fecha) ? monthKey(parseDate(fecha)) : ""),
      factura: text(raw.factura || raw.nombre),
      referencia: text(raw.referencia || raw.ref),
      valorBase: num(raw.valorBase || raw.valor),
      valorPagado: num(raw.valorPagado || raw.pagado),
      estado: text(raw.estado || "Pagado"),
      metodo: text(raw.metodo || raw.metodoPago),
      categoria: text(raw.categoria),
      responsable: text(raw.responsable),
      nota: text(raw.nota),
      comprobante: text(raw.comprobante),
      rowFactura: Number(raw.rowFactura || raw["Row Factura"] || 0),
      raw,
    };
  }
  function uniq(field) {
    return [...new Set(store.facturas.map((f) => text(f[field])).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
  }
  function statusRank(f) {
    const map = { vencida: 0, hoy: 1, urgente: 2, proxima: 3, pendiente: 4, sin_vencimiento: 5, pagada: 6 };
    return map[f.estadoCalculado] ?? 9;
  }
  function applyFilters() {
    const f = store.filters;
    let rows = store.facturas.filter((x) => {
      if (f.estado !== "all" && x.estadoCalculado !== f.estado) return false;
      if (f.metodo !== "all" && x.metodo !== f.metodo) return false;
      if (f.categoria !== "all" && x.categoria !== f.categoria) return false;
      if (f.responsable !== "all" && x.responsable !== f.responsable) return false;
      if (f.q) {
        const q = norm(f.q);
        if (![x.factura, x.referencia, x.metodo, x.categoria, x.responsable].some((v) => norm(v).includes(q))) return false;
      }
      return true;
    });
    rows = sortFacturas(rows, f.orden);
    store.filtered = rows;
    emit("filtered", rows);
    return rows;
  }
  function sortFacturas(rows, orden = "urgencia") {
    const out = rows.slice();
    out.sort((a, b) => {
      if (orden === "valor_desc") return b.valorBase - a.valorBase;
      if (orden === "valor_asc") return a.valorBase - b.valorBase;
      if (orden === "nombre") return a.factura.localeCompare(b.factura, "es");
      if (orden === "ultimo_pago") return (parseDate(b.ultimoPago)?.getTime() || 0) - (parseDate(a.ultimoPago)?.getTime() || 0);
      if (orden === "vencimiento") return (Number(a.diaVencimiento) || 99) - (Number(b.diaVencimiento) || 99);
      return statusRank(a) - statusRank(b) || (Number(a.diasParaVencer) || 99) - (Number(b.diasParaVencer) || 99);
    });
    return out;
  }
  function dashboard() {
    const unpaid = store.facturas.filter((f) => f.estadoCalculado !== "pagada");
    const vencidas = unpaid.filter((f) => f.estadoCalculado === "vencida");
    const hoy = unpaid.filter((f) => f.estadoCalculado === "hoy");
    const semana = unpaid.filter((f) => Number(f.diasParaVencer) >= 0 && Number(f.diasParaVencer) <= 7);
    const prox = sortFacturas(unpaid, "urgencia").find((f) => f.estadoCalculado !== "sin_vencimiento") || null;
    return {
      vencidas,
      hoy,
      semana,
      totalSemana: semana.reduce((a, f) => a + f.valorBase, 0),
      proximoVencimiento: prox,
      valorPendienteMes: unpaid.reduce((a, f) => a + f.valorBase, 0),
      pagadasMes: store.facturas.filter((f) => f.estadoCalculado === "pagada"),
      valorPagadoMes: store.facturas.filter((f) => f.estadoCalculado === "pagada").reduce((a, f) => a + f.valorBase, 0),
      vencidasValor: vencidas.reduce((a, f) => a + f.valorBase, 0),
    };
  }
  function setFacturas(rows) {
    store.facturas = (Array.isArray(rows) ? rows : []).map(normalizeFactura);
    applyFilters();
    emit("facturas", store.facturas);
  }
  function setHistorico(rows) {
    store.historico = (Array.isArray(rows) ? rows : []).map(normalizeHistorico);
    emit("historico", store.historico);
  }
  function setStats(stats) { store.stats = stats || null; emit("stats", store.stats); }
  function setFilters(next) { store.filters = { ...store.filters, ...next }; return applyFilters(); }
  function getByRow(row) { return store.facturas.find((f) => Number(f.row) === Number(row)); }
  function findFactura(term) {
    const q = norm(term);
    return store.facturas.find((f) => norm(f.factura) === q || norm(f.referencia) === q || String(f.row) === String(term)) ||
      store.facturas.find((f) => norm(f.factura).includes(q) || norm(f.referencia).includes(q));
  }

  window.STATE = Object.freeze({
    on, store, norm, num, text, parseDate, fmtInputDate, monthKey, isPaidThisMonth, calcLocalStatus,
    normalizeFactura, normalizeHistorico, setFacturas, setHistorico, setStats, setFilters, applyFilters,
    sortFacturas, dashboard, getByRow, findFactura,
    getFacturas: () => store.facturas, getFiltered: () => store.filtered, getHistorico: () => store.historico, getStats: () => store.stats,
    extractMetodos: () => uniq("metodo"), extractCategorias: () => uniq("categoria"), extractResponsables: () => uniq("responsable"),
  });
})();
