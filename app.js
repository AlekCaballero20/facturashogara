/* ===========================
   CONFIGURACIÓN
=========================== */
const scriptURL = "https://script.google.com/macros/s/AKfycbx5LlLSTdjj5YZdP7AZTf4i0BBKmD3OfWeoxgBZ9kxzTu9IW-WJXbeWbeLizBWbgfM/exec";

/* ===========================
   UTILIDADES UI / FORMATO
=========================== */
const $ = (sel, ctx=document) => ctx.querySelector(sel);

const $tbody   = $("#tbody");
const $msg     = $("#mensaje");
const $loader  = $("#loader");
const $main    = $("#main");

// Modal stats (del index nuevo)
const $btnStats     = $("#btnStats");
const $statsModal   = $("#statsModal");
const $statsBody    = $("#statsBody");
const $btnCloseStats= $("#btnCloseStats");

const money = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0
});

function showMsg(text, type="ok"){
  if (!$msg) return;
  $msg.textContent = text;
  $msg.className = "";
  $msg.classList.add(type);
  $msg.classList.remove("hide");
  clearTimeout(showMsg._t);
  showMsg._t = setTimeout(()=> $msg.classList.add("hide"), 3200);
}

function setBusy(isBusy){
  if ($main) $main.setAttribute("aria-busy", isBusy ? "true" : "false");
  if ($loader){
    $loader.classList.toggle("hide", !isBusy);
  }
}

// Convierte texto (con $.,) a número; retorna null si no hay dígitos
function parseCOP(str){
  if (str == null) return null;
  const digits = String(str).replace(/[^\d]/g, "");
  if (!digits) return null;
  return Number(digits);
}
function fmtCOP(n){
  return money.format(Number(n || 0));
}

/* ===========================
   FECHAS
=========================== */
function esPagoDelMes(fechaStr){
  if (!fechaStr) return false;

  // Soportar "d/M/yyyy" o "d/M/yyyy hh:mm:ss"
  const base = String(fechaStr).trim().split(" ")[0];
  const p = base.split("/");
  if (p.length < 3) return false;

  const [ , mes, anio ] = p.map(Number);
  const hoy = new Date();
  return mes === (hoy.getMonth() + 1) && anio === hoy.getFullYear();
}

/* ===========================
   CONEXIÓN GAS
=========================== */
async function fetchJSON(url){
  const res = await fetch(url, { cache:"no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

async function fetchFacturas(){
  const data = await fetchJSON(`${scriptURL}?action=listar`);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.rows)) return data.rows;
  throw new Error("Formato inesperado (listar)");
}

async function registrarPago(row){
  const params = new URLSearchParams({ action:"registrar", row:String(row) });
  const json = await fetchJSON(`${scriptURL}?${params.toString()}`);
  if (!json.ok) throw new Error(json.error || "Error al registrar");
  return json; // { ok:true, fecha: 'd/M/yyyy' }
}

async function editarValor(row, nuevoValor){
  const params = new URLSearchParams({ action:"editar", row:String(row), valor:String(nuevoValor) });
  const json = await fetchJSON(`${scriptURL}?${params.toString()}`);
  if (!json.ok) throw new Error(json.error || "Error al editar valor");
  return json;
}

// ✅ Nuevo: editar método de pago (texto libre)
async function editarMetodo(row, metodo){
  const params = new URLSearchParams({
    action:"editarMetodo",
    row:String(row),
    metodo: String(metodo || "")
  });
  const json = await fetchJSON(`${scriptURL}?${params.toString()}`);
  if (!json.ok) throw new Error(json.error || "Error al editar método");
  return json;
}

// ✅ Nuevo: pedir stats
async function fetchStats(){
  const json = await fetchJSON(`${scriptURL}?action=stats`);
  if (!json.ok) throw new Error(json.error || "No se pudo cargar stats");
  return json;
}

/* ===========================
   RENDER
   Columnas (7):
   1 Factura | 2 Referencia | 3 Valor | 4 Método | 5 Último pago | 6 Estado | 7 Acción
=========================== */
function rowHTML(f){
  const ultimo = f.ultimo ?? "";
  const pagadoEsteMes = esPagoDelMes(ultimo);

  const estadoBadge = pagadoEsteMes
    ? `<span class="badge ok">Pagado</span>`
    : `<span class="badge pendiente">Pendiente</span>`;

  const valorNumerico = Number(isNaN(f.valor) ? parseCOP(f.valor) : f.valor) || 0;

  const metodoTxt = (f.metodo ?? "").toString();

  return `
    <tr data-row="${f.row}">
      <td>${f.nombre ?? ""}</td>
      <td>${f.referencia ?? ""}</td>

      <td class="editable valor"
          contenteditable="true"
          data-valor="${valorNumerico}"
          aria-label="Editar valor">
        ${fmtCOP(valorNumerico)}
      </td>

      <td class="editable metodo"
          contenteditable="true"
          data-metodo="${escapeHtml(metodoTxt)}"
          aria-label="Editar método de pago">
        ${escapeHtml(metodoTxt || "—")}
      </td>

      <td class="fecha">${ultimo}</td>

      <td class="estado">${estadoBadge}</td>

      <td>
        <button class="btn" data-row="${f.row}" data-action="registrar">Registrar</button>
      </td>
    </tr>
  `;
}

function renderTable(facturas){
  if (!facturas || !facturas.length){
    $tbody.innerHTML = `<tr><td colspan="7">Sin registros disponibles.</td></tr>`;
    return;
  }
  $tbody.innerHTML = facturas.map(rowHTML).join("");
}

/* ===========================
   HELPERS
=========================== */
function escapeHtml(str){
  return String(str ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

/* ===========================
   EVENTOS: Registrar pago
=========================== */
document.addEventListener("click", async (ev)=>{
  const btn = ev.target.closest("button[data-action='registrar']");
  if (!btn) return;

  const row = +btn.dataset.row;
  const tr  = btn.closest("tr");

  btn.disabled = true;
  const prevTxt = btn.textContent;
  btn.textContent = "⏳";

  try{
    const { fecha } = await registrarPago(row);

    tr.querySelector(".fecha").textContent = fecha || "";

    const pagadoEsteMes = esPagoDelMes(fecha);
    tr.querySelector(".estado").innerHTML = pagadoEsteMes
      ? `<span class="badge ok">Pagado</span>`
      : `<span class="badge pendiente">Pendiente</span>`;

    btn.disabled = false;
    btn.textContent = "Registrar";
    showMsg("Pago registrado correctamente ✅", "ok");
  }catch(err){
    console.error(err);
    btn.disabled = false;
    btn.textContent = prevTxt;
    showMsg("Error al registrar: " + err.message, "error");
  }
});

/* ===========================
   EDITOR: Valor (número)
=========================== */
document.addEventListener("focusin", (ev)=>{
  const cell = ev.target.closest(".editable.valor");
  if (!cell) return;

  const v = Number(cell.dataset.valor || 0);
  cell.dataset.orig = String(v);
  cell.textContent = String(v);
  cell.classList.add("editing");
});

document.addEventListener("input", (ev)=>{
  const cell = ev.target.closest(".editable.valor");
  if (!cell) return;

  const digits = cell.textContent.replace(/[^\d]/g, "");
  if (cell.textContent !== digits) cell.textContent = digits;
});

document.addEventListener("keydown", (ev)=>{
  const cellValor = ev.target.closest(".editable.valor");
  const cellMetodo= ev.target.closest(".editable.metodo");
  if (!cellValor && !cellMetodo) return;

  if (ev.key === "Enter"){
    ev.preventDefault();
    (cellValor || cellMetodo).blur();
  }else if (ev.key === "Escape"){
    ev.preventDefault();
    if (cellValor){
      cellValor.textContent = fmtCOP(Number(cellValor.dataset.orig || cellValor.dataset.valor || 0));
    } else if (cellMetodo){
      const orig = cellMetodo.dataset.origMetodo ?? cellMetodo.dataset.metodo ?? "";
      cellMetodo.textContent = orig || "—";
    }
    (cellValor || cellMetodo).blur();
  }
});

// Guardar valor
document.addEventListener("focusout", async (ev)=>{
  const cell = ev.target.closest(".editable.valor");
  if (!cell) return;

  cell.classList.remove("editing");

  const tr  = cell.closest("tr");
  const row = +tr.dataset.row;

  const origNum = Number(cell.dataset.orig || cell.dataset.valor || 0);
  const newNum  = parseCOP(cell.textContent);

  if (newNum === null || newNum === origNum){
    cell.textContent = fmtCOP(origNum);
    return;
  }

  try{
    await editarValor(row, newNum);
    cell.dataset.valor = String(newNum);
    cell.textContent   = fmtCOP(newNum);
    showMsg("Valor actualizado 💰", "ok");
  }catch(err){
    console.error(err);
    cell.textContent = fmtCOP(origNum);
    showMsg("Error al editar valor: " + err.message, "error");
  }
}, true);

/* ===========================
   EDITOR: Método (texto libre)
=========================== */
document.addEventListener("focusin", (ev)=>{
  const cell = ev.target.closest(".editable.metodo");
  if (!cell) return;

  const orig = (cell.dataset.metodo || "").trim();
  cell.dataset.origMetodo = orig;
  cell.textContent = orig; // editar limpio (sin "—")
  cell.classList.add("editing");
});

document.addEventListener("focusout", async (ev)=>{
  const cell = ev.target.closest(".editable.metodo");
  if (!cell) return;

  cell.classList.remove("editing");

  const tr  = cell.closest("tr");
  const row = +tr.dataset.row;

  const orig = (cell.dataset.origMetodo || "").trim();
  const nuevo = (cell.textContent || "").trim();

  // si no cambió, solo re-render bonito
  if (nuevo === orig){
    cell.dataset.metodo = orig;
    cell.textContent = orig || "—";
    return;
  }

  try{
    // ⚠️ Requiere endpoint action=editarMetodo en Apps Script
    await editarMetodo(row, nuevo);
    cell.dataset.metodo = nuevo;
    cell.textContent = nuevo || "—";
    showMsg("Método actualizado 💳", "ok");
  }catch(err){
    console.error(err);
    // revertir
    cell.dataset.metodo = orig;
    cell.textContent = orig || "—";
    showMsg("Error al editar método: " + err.message, "error");
  }
}, true);

/* ===========================
   MODAL STATS
=========================== */
function openStatsModal(){
  if (!$statsModal) return;
  $statsModal.classList.remove("hide");
  document.body.style.overflow = "hidden";
}
function closeStatsModal(){
  if (!$statsModal) return;
  $statsModal.classList.add("hide");
  document.body.style.overflow = "";
}

async function loadStats(){
  if (!$statsBody) return;
  $statsBody.innerHTML = `<p class="muted">Cargando estadísticas…</p>`;

  try{
    const s = await fetchStats();

    // Render simplecito (suficiente por ahora)
    $statsBody.innerHTML = `
      <div class="stats-grid">
        <div class="stat">
          <div class="k">Registros en histórico</div>
          <div class="v">${s.totalRegistros ?? "—"}</div>
        </div>
        <div class="stat">
          <div class="k">Total pagado</div>
          <div class="v">${fmtCOP(s.totalPagado ?? 0)}</div>
        </div>
        <div class="stat">
          <div class="k">Pagos este mes</div>
          <div class="v">${s.pagosEsteMes ?? "—"}</div>
        </div>
        <div class="stat">
          <div class="k">Total este mes</div>
          <div class="v">${fmtCOP(s.totalEsteMes ?? 0)}</div>
        </div>
      </div>

      ${Array.isArray(s.topFacturas) ? `
        <h3 style="margin-top:14px">Top facturas por gasto</h3>
        <div class="mini-table">
          <div class="row head"><div>Factura</div><div>Total</div></div>
          ${s.topFacturas.map(x => `
            <div class="row"><div>${escapeHtml(x.nombre ?? "")}</div><div>${fmtCOP(x.total ?? 0)}</div></div>
          `).join("")}
        </div>
      ` : ""}
    `;
  }catch(err){
    console.error(err);
    $statsBody.innerHTML = `<p class="muted">❌ No se pudieron cargar las estadísticas: ${escapeHtml(err.message)}</p>`;
  }
}

if ($btnStats){
  $btnStats.addEventListener("click", async ()=>{
    openStatsModal();
    await loadStats();
  });
}
if ($btnCloseStats){
  $btnCloseStats.addEventListener("click", closeStatsModal);
}
document.addEventListener("click", (ev)=>{
  const close = ev.target.closest("[data-close='stats']");
  if (close) closeStatsModal();
});
document.addEventListener("keydown", (ev)=>{
  if (ev.key === "Escape" && $statsModal && !$statsModal.classList.contains("hide")){
    closeStatsModal();
  }
});

/* ===========================
   INICIO
=========================== */
(async function init(){
  try{
    setBusy(true);
    const facturas = await fetchFacturas();
    renderTable(facturas);
  }catch(err){
    console.error(err);
    $tbody.innerHTML = `<tr><td colspan="7">❌ Error cargando datos</td></tr>`;
    showMsg("Error al cargar datos: " + err.message, "error");
  }finally{
    setBusy(false);
  }
})();
