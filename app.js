/* ===========================
   CONFIGURACIÓN
=========================== */
// ⚠️ Pega aquí tu URL del Web App (la que termina en /exec)
const scriptURL = "https://script.google.com/macros/s/AKfycbzouhLqSS5c-P2bQHzfXG54kClc1gPUeIQfu6APDQurbqgeuh8b_rfqoKYnUOUXAIrG/exec";

/* ===========================
   UTILIDADES UI / FORMATO
=========================== */
const $ = (sel, ctx=document) => ctx.querySelector(sel);
const $tbody = $("#tbody");
const $msg   = $("#mensaje");
const $loader= $("#loader");

const money = new Intl.NumberFormat("es-CO", { style:"currency", currency:"COP", maximumFractionDigits:0 });

function showMsg(text, type="ok"){
  $msg.textContent = text;
  $msg.className = "";
  $msg.classList.add(type);
  $msg.classList.remove("hide");
  clearTimeout(showMsg._t);
  showMsg._t = setTimeout(()=> $msg.classList.add("hide"), 3000);
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
  const p = fechaStr.split("/");
  if (p.length < 3) return false;
  const [ , mes, anio ] = p.map(Number);
  const hoy = new Date();
  return mes === (hoy.getMonth()+1) && anio === hoy.getFullYear();
}

/* ===========================
   CONEXIÓN GAS
=========================== */
async function fetchFacturas(){
  const res = await fetch(`${scriptURL}?action=listar`, { cache:"no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.rows)) return data.rows;
  throw new Error("Formato inesperado");
}

async function registrarPago(row){
  const res = await fetch(`${scriptURL}?action=registrar&row=${encodeURIComponent(row)}`);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "Error al registrar");
  return json;
}

async function editarValor(row, nuevoValor){
  const params = new URLSearchParams({ action:"editar", row, valor:String(nuevoValor) });
  const res = await fetch(`${scriptURL}?${params.toString()}`);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "Error al editar");
  return json;
}

/* ===========================
   RENDER
=========================== */
function rowHTML(f){
  const pagadoEsteMes = esPagoDelMes(f.ultimo);
  const estadoBadge = pagadoEsteMes
    ? `<span class="badge ok">Pagado</span>`
    : `<span class="badge pendiente">Pendiente</span>`;

  // Guardamos el valor numérico en data-valor para comparaciones fiables
  const valorNumerico = Number(isNaN(f.valor) ? parseCOP(f.valor) : f.valor) || 0;

  return `
    <tr data-row="${f.row}">
      <td>${f.nombre ?? ""}</td>
      <td>${f.referencia ?? ""}</td>

      <td class="editable"
          contenteditable="true"
          data-valor="${valorNumerico}"
          aria-label="Editar valor">
          ${fmtCOP(valorNumerico)}
      </td>

      <td>${f.ultimo ?? ""}</td>
      <td>${estadoBadge}</td>
      <td><button class="btn" data-row="${f.row}" data-action="registrar">Registrar</button></td>
    </tr>
  `;
}

function renderTable(facturas){
  if (!facturas || !facturas.length){
    $tbody.innerHTML = `<tr><td colspan="6">Sin registros disponibles.</td></tr>`;
    return;
  }
  $tbody.innerHTML = facturas.map(rowHTML).join("");
}

/* ===========================
   EVENTOS
=========================== */
// Registrar pago (botón siempre activo)
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
    tr.querySelector("td:nth-child(4)").textContent = fecha || "";
    const pagadoEsteMes = esPagoDelMes(fecha);
    tr.querySelector("td:nth-child(5)").innerHTML = pagadoEsteMes
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

/* ---------- Editor robusto para “Valor” ---------- */
// 1) Al enfocar: guardamos el original y mostramos solo números (sin $ ni puntos)
document.addEventListener("focusin", (ev)=>{
  const cell = ev.target.closest(".editable");
  if (!cell) return;
  const v = Number(cell.dataset.valor || 0);
  cell.dataset.orig = String(v);           // guarda original numérico
  cell.textContent = String(v);            // muestra limpio para editar
  // estilo de edición opcional
  cell.classList.add("editing");
});

// 2) Validamos mientras escribe (solo dígitos)
document.addEventListener("input", (ev)=>{
  const cell = ev.target.closest(".editable");
  if (!cell) return;
  const digits = cell.textContent.replace(/[^\d]/g, "");
  if (cell.textContent !== digits){
    // Mantiene solo dígitos sin mover el caret “mucho”
    const sel = window.getSelection();
    const off = sel && sel.focusOffset || 0;
    cell.textContent = digits;
    try{
      const range = document.createRange();
      range.selectNodeContents(cell);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }catch(_){}
  }
});

// 3) Enter = guardar, Esc = cancelar
document.addEventListener("keydown", (ev)=>{
  const cell = ev.target.closest(".editable");
  if (!cell) return;
  if (ev.key === "Enter"){
    ev.preventDefault();
    cell.blur();
  }else if (ev.key === "Escape"){
    ev.preventDefault();
    // revertir
    cell.textContent = cell.dataset.orig ?? cell.textContent;
    cell.blur();
  }
});

// 4) Al salir (blur): validamos, comparamos y guardamos si cambió
document.addEventListener("focusout", async (ev)=>{
  const cell = ev.target.closest(".editable");
  if (!cell) return;

  cell.classList.remove("editing");

  const tr  = cell.closest("tr");
  const row = +tr.dataset.row;

  const origNum = Number(cell.dataset.orig || cell.dataset.valor || 0);
  const newNum  = parseCOP(cell.textContent);

  // Si lo dejaron vacío o no cambió, re-formateamos y salimos
  if (newNum === null){
    cell.textContent = fmtCOP(origNum);
    return;
  }
  if (newNum === origNum){
    cell.textContent = fmtCOP(origNum);
    return;
  }

  // Intentar guardar
  try{
    await editarValor(row, newNum);
    cell.dataset.valor = String(newNum);
    cell.textContent   = fmtCOP(newNum);
    showMsg("Valor actualizado 💰", "ok");
  }catch(err){
    console.error(err);
    // revertir
    cell.textContent = fmtCOP(origNum);
    showMsg("Error al editar valor: " + err.message, "error");
  }
}, true);

/* ===========================
   INICIO
=========================== */
(async function init(){
  try{
    $loader.classList.remove("hide");
    const facturas = await fetchFacturas();
    renderTable(facturas);
  }catch(err){
    console.error(err);
    $tbody.innerHTML = `<tr><td colspan="6">❌ Error cargando datos</td></tr>`;
    showMsg("Error al cargar datos: " + err.message, "error");
  }finally{
    $loader.classList.add("hide");
  }
})();
