/* Mi Dinero — PWA de finanzas personales en COP.
   Datos: se guardan en el celular (funciona sin internet) y se sincronizan con Google Sheets vía Apps Script.
   Regla anti doble descuento: cada movimiento tiene UN solo estado (pagado | pendiente).
   Saldo libre = Recibido − Pagado − Pendiente. Al pagar, el monto pasa de "pendiente" a "pagado" (no se resta dos veces).
   Las transferencias (p. ej. pagar la tarjeta desde el banco) NO son gasto: solo mueven dinero entre cuentas. */
(() => {
'use strict';

/* ───────── Utilidades ───────── */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const fmt = n => COP.format(Math.round(n || 0));
const num = v => Number(String(v ?? '').replace(/\D/g, '')) || 0;
const miles = v => { const n = num(v); return n ? n.toLocaleString('es-CO') : ''; };
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hoy = () => ymd(new Date());
const mesDe = f => String(f || '').slice(0, 7);
const addMes = (m, n) => { const [y, mo] = m.split('-').map(Number); return ymd(new Date(y, mo - 1 + n, 1)).slice(0, 7); };
const nombreMes = m => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo - 1, 1).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }); };
const mesCorto = m => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo - 1, 1).toLocaleDateString('es-CO', { month: 'short' }).replace('.', ''); };
const diasEntre = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5);
const clampDia = (m, dia) => { const [y, mo] = m.split('-').map(Number); const max = new Date(y, mo, 0).getDate(); return `${m}-${String(Math.min(Math.max(dia, 1), max)).padStart(2, '0')}`; };
const fechaCorta = f => new Date(f + 'T00:00:00').toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
const uid = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 16) : Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
const https = u => { try { const x = new URL(u); return x.protocol === 'https:' ? x.href : ''; } catch { return ''; } };

/* ───────── Estado y almacenamiento ───────── */
const LS_DB = 'midinero.db.v1', LS_CFG = 'midinero.cfg.v1';
const COLS = ['mov', 'cue', 'deu', 'cat'];
const CATS = [
  ['cat_mercado', 'Mercado', '🛒', '#14b8a6', 'gasto'], ['cat_arriendo', 'Arriendo', '🏠', '#6366f1', 'gasto'],
  ['cat_servicios', 'Servicios', '💡', '#f59e0b', 'gasto'], ['cat_transporte', 'Transporte', '🚌', '#3b82f6', 'gasto'],
  ['cat_salud', 'Salud', '💊', '#ef4444', 'gasto'], ['cat_educacion', 'Educación', '🎓', '#8b5cf6', 'gasto'],
  ['cat_comida', 'Restaurantes', '🍽️', '#f97316', 'gasto'], ['cat_ocio', 'Ocio', '🎬', '#ec4899', 'gasto'],
  ['cat_ropa', 'Ropa', '👕', '#06b6d4', 'gasto'], ['cat_hogar', 'Hogar', '🛋️', '#84cc16', 'gasto'],
  ['cat_suscrip', 'Suscripciones', '📺', '#a855f7', 'gasto'], ['cat_mascotas', 'Mascotas', '🐶', '#d97706', 'gasto'],
  ['cat_deuda', 'Deudas', '💳', '#64748b', 'gasto'], ['cat_otros', 'Otros', '🧾', '#94a3b8', 'gasto'],
  ['cat_sueldo', 'Sueldo', '💼', '#0f9d6a', 'ingreso'], ['cat_extra', 'Ingreso extra', '✨', '#22c55e', 'ingreso'],
  ['cat_otroing', 'Otros ingresos', '💰', '#65a30d', 'ingreso']
].map(([id, nombre, emoji, color, tipo]) => ({ id, nombre, emoji, color, tipo, u: 0 }));
const TIPOS_CUENTA = { ahorros: 'Cuenta de ahorros', corriente: 'Cuenta corriente', billetera: 'Billetera (Nequi, Daviplata…)', efectivo: 'Efectivo', tarjeta: 'Tarjeta de crédito' };
const ENLACES = [['PSE', 'https://www.pse.com.co/persona'], ['Nequi', 'https://www.nequi.com.co'], ['Daviplata', 'https://www.daviplata.com'],
  ['Bancolombia', 'https://www.bancolombia.com'], ['Davivienda', 'https://www.davivienda.com']];

const CONEXION = {
  url: 'https://script.google.com/macros/s/AKfycbz2xLYaLAf7KIR_u1GKrYTTF1XwUoftCc1PVLzTZdy9TnTYxb0ukL55T2S8xRhvjhTH/exec',
  clave: 'MiDinero-xMOAM-Ks8Zt-Y4aNR-5zRjp'
};
let DB = {}, CFG = {};
const ui = { tab: 'inicio', mes: hoy().slice(0, 7), filtro: 'todos', sync: 'idle', syncMsg: '', fm: null };

function cargar() {
  try { DB = JSON.parse(localStorage.getItem(LS_DB)) || {}; } catch { DB = {}; }
  try { CFG = JSON.parse(localStorage.getItem(LS_CFG)) || {}; } catch { CFG = {}; }
  COLS.forEach(k => { DB[k] = Array.isArray(DB[k]) ? DB[k] : []; });
  CFG = Object.assign({ url: '', clave: '', usuario: '', desde: 0, ultimaSync: 0, pin: null, notif: false, notifDia: '' }, CFG);
  // Conexión interna: cualquier aparato que abra la app queda conectado a la hoja sin escribir nada.
  if (!CFG.url) CFG.url = CONEXION.url;
  if (!CFG.clave) CFG.clave = CONEXION.clave;
  // Una sola vez por aparato: reenvía todo lo local y vuelve a bajar todo lo de la hoja.
  if (CFG.v !== 3) { COLS.forEach(k => DB[k].forEach(x => { if (x.u > 0) x.dirty = 1; })); CFG.desde = 0; CFG.v = 3; }
  CATS.forEach(c => { if (!DB.cat.some(x => x.id === c.id)) DB.cat.push({ ...c }); });
}
function persistir() {
  try { localStorage.setItem(LS_DB, JSON.stringify(DB)); localStorage.setItem(LS_CFG, JSON.stringify(CFG)); }
  catch { aviso('No se pudo guardar en el celular (almacenamiento lleno)'); }
}
const vivos = k => DB[k].filter(x => !x.del);
const buscar = (k, id) => DB[k].find(x => x.id === id);
const cue = id => buscar('cue', id), cat = id => buscar('cat', id), deu = id => buscar('deu', id);

function guardar(k, obj) {
  obj.u = Date.now(); obj.dirty = 1;
  const i = DB[k].findIndex(x => x.id === obj.id);
  if (i >= 0) DB[k][i] = obj; else DB[k].push(obj);
  persistir(); programarSync();
  return obj;
}
function borrar(k, id) { const o = buscar(k, id); if (o) guardar(k, { ...o, del: 1 }); }

/* ───────── Cálculos financieros ───────── */
const movs = () => vivos('mov');
const esTarjeta = c => c && c.tipo === 'tarjeta';

// Saldo de una cuenta. Para tarjetas devuelve lo USADO (deuda de la tarjeta).
function saldoCuenta(c) {
  let s = Number(c.saldoIni) || 0; const t = esTarjeta(c);
  for (const m of movs()) {
    if (m.estado !== 'pagado') continue;
    if (m.tipo === 'transf') {
      if (m.cuenta === c.id) s += t ? m.monto : -m.monto;
      if (m.destino === c.id) s += t ? -m.monto : m.monto;
      continue;
    }
    if (m.cuenta !== c.id) continue;
    if (m.tipo === 'ingreso') s += t ? -m.monto : m.monto; else s += t ? m.monto : -m.monto;
  }
  return s;
}
function saldoDeuda(d) {
  const pagado = movs().filter(m => m.tipo === 'pago' && m.deuda === d.id && m.estado === 'pagado').reduce((a, m) => a + m.monto, 0);
  return Math.max(0, (Number(d.total) || 0) - pagado);
}
function resumen(mes) {
  const r = { recibido: 0, esperado: 0, pagado: 0, pendiente: 0, arrastre: 0 };
  const actual = hoy().slice(0, 7);
  for (const m of movs()) {
    if (m.tipo === 'transf') continue;
    const enMes = mesDe(m.fecha) === mes;
    if (m.tipo === 'ingreso') {
      if (!enMes) continue;
      if (m.estado === 'pagado') r.recibido += m.monto; else r.esperado += m.monto;
    } else if (m.estado === 'pagado') {
      if (enMes) r.pagado += m.monto;
    } else if (enMes) r.pendiente += m.monto;
    else if (mes === actual && mesDe(m.fecha) < mes) { r.pendiente += m.monto; r.arrastre += m.monto; }
  }
  r.libre = r.recibido - r.pagado - r.pendiente;
  r.proyectado = r.libre + r.esperado;
  return r;
}
function gastosPorCategoria(mes) {
  const mp = {};
  for (const m of movs()) {
    if (m.tipo === 'ingreso' || m.tipo === 'transf' || mesDe(m.fecha) !== mes) continue;
    mp[m.categoria || 'cat_otros'] = (mp[m.categoria || 'cat_otros'] || 0) + m.monto;
  }
  return Object.entries(mp).map(([id, v]) => { const c = cat(id) || { nombre: 'Otros', color: '#94a3b8' }; return { label: c.nombre, value: v, color: c.color }; })
    .sort((a, b) => b.value - a.value);
}
function serie6(mes) {
  const out = [];
  for (let i = 5; i >= 0; i--) {
    const m = addMes(mes, -i); let ing = 0, gas = 0;
    for (const x of movs()) {
      if (x.tipo === 'transf' || mesDe(x.fecha) !== m) continue;
      if (x.tipo === 'ingreso') { if (x.estado === 'pagado') ing += x.monto; } else gas += x.monto;
    }
    out.push({ m, ing, gas });
  }
  return out;
}
function recordatorios() {
  const h = hoy(), out = [];
  for (const m of movs()) {
    if (m.estado !== 'pendiente' || m.tipo === 'transf') continue;
    const d = diasEntre(h, m.fecha);
    if (d <= 7) out.push({ kind: m.tipo === 'ingreso' ? 'cobro' : 'mov', m, d, fecha: m.fecha });
  }
  for (const c of vivos('cue')) {
    if (!esTarjeta(c) || !c.diaPago || saldoCuenta(c) <= 0) continue;
    let f = clampDia(h.slice(0, 7), Number(c.diaPago));
    if (f < h) f = clampDia(addMes(h.slice(0, 7), 1), Number(c.diaPago));
    const d = diasEntre(h, f);
    if (d <= 5) out.push({ kind: 'tarjeta', c, d, fecha: f });
  }
  return out.sort((a, b) => a.d - b.d);
}
const cuando = d => d < 0 ? `Vencido hace ${-d} d` : d === 0 ? 'Vence hoy' : d === 1 ? 'Vence mañana' : `En ${d} días`;

/* Genera cuotas de deudas y movimientos recurrentes del mes actual (ids determinísticos → no se duplican entre celulares) */
function generarAutomaticos() {
  const mes = hoy().slice(0, 7); let cambio = false;
  for (const d of vivos('deu')) {
    if (!(d.cuota > 0) || !d.dia || saldoDeuda(d) <= 0) continue;
    if (mesDe(d.creada || hoy()) > mes) continue;
    const id = `cuota_${d.id}_${mes}`;
    if (buscar('mov', id)) continue;
    if (movs().some(m => m.tipo === 'pago' && m.deuda === d.id && mesDe(m.vence || m.fecha) === mes)) continue;
    guardar('mov', { id, tipo: 'pago', monto: Math.min(d.cuota, saldoDeuda(d)), estado: 'pendiente', fecha: clampDia(mes, d.dia), vence: clampDia(mes, d.dia),
      categoria: 'cat_deuda', cuenta: '', deuda: d.id, nota: `Cuota ${d.nombre}`, enlace: d.enlace || '', usuario: CFG.usuario }); cambio = true;
  }
  const series = {};
  for (const m of movs()) if (m.rec === 'mensual') { const s = m.serie || m.id; if (!series[s] || m.fecha > series[s].fecha) series[s] = m; }
  for (const [s, base] of Object.entries(series)) {
    const dia = Number((base.vence || base.fecha).slice(8, 10));
    for (let m = addMes(mesDe(base.fecha), 1); m <= mes; m = addMes(m, 1)) {
      const id = `${s}_${m}`; if (buscar('mov', id)) continue;
      guardar('mov', { ...base, id, serie: s, estado: 'pendiente', fecha: clampDia(m, dia), vence: clampDia(m, dia), dirty: 1 }); cambio = true;
    }
  }
  return cambio;
}

/* ───────── Sincronización con Google Sheets (Apps Script) ───────── */
let tSync = null, sincronizando = false;
const programarSync = () => { clearTimeout(tSync); if (CFG.url && CFG.clave) tSync = setTimeout(() => sync(false), 1500); };
const NOMBRE_TIPO = { ingreso: 'Ingreso', gasto: 'Gasto', pago: 'Pago de deuda', transf: 'Transferencia' };
function vista(k, o) {
  if (k === 'mov') return { fecha: o.fecha, vence: o.vence || '', tipo: NOMBRE_TIPO[o.tipo] || o.tipo, monto: o.monto, estado: o.estado === 'pagado' ? 'Pagado' : 'Pendiente',
    categoria: (cat(o.categoria) || {}).nombre || '', cuenta: (cue(o.cuenta) || {}).nombre || '', destino: (cue(o.destino) || {}).nombre || '',
    deuda: (deu(o.deuda) || {}).nombre || '', nota: o.nota || '', usuario: o.usuario || '', recurrente: o.rec ? 'Mensual' : '' };
  if (k === 'cue') return { nombre: o.nombre, tipo: TIPOS_CUENTA[o.tipo] || o.tipo, saldoIni: o.saldoIni || 0, cupo: o.cupo || '', corte: o.corte || '', diaPago: o.diaPago || '', ult4: o.ult4 || '' };
  if (k === 'deu') return { nombre: o.nombre, acreedor: o.acreedor || '', total: o.total || 0, cuota: o.cuota || '', dia: o.dia || '', enlace: o.enlace || '' };
  return { nombre: o.nombre, emoji: o.emoji || '', tipo: o.tipo };
}
async function sync(manual) {
  if (!CFG.url || !CFG.clave) { if (manual) aviso('Primero configura Google Sheets en Ajustes'); return; }
  if (!navigator.onLine) { ui.sync = 'err'; ui.syncMsg = 'Sin internet: se sincroniza al volver'; pintarEstado(); if (manual) aviso(ui.syncMsg); return; }
  if (sincronizando) return; sincronizando = true; ui.sync = 'run'; pintarEstado();
  const cambios = {}, enviados = {};
  for (const k of COLS) {
    const sucios = DB[k].filter(x => x.dirty);
    cambios[k] = sucios.map(({ dirty, id, u, del, ...d }) => ({ id, u, del: del ? 1 : 0, d: { ...d, id }, v: vista(k, { ...d, id }) }));
    sucios.forEach(x => { enviados[x.id] = x.u; });
  }
  try {
    const r = await fetch(CFG.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow',
      body: JSON.stringify({ clave: CFG.clave, accion: 'sync', desde: CFG.desde || 0, usuario: CFG.usuario, cambios }) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Respuesta inválida');
    for (const k of COLS) {
      for (const it of (j.datos[k] || [])) {
        const loc = buscar(k, it.id);
        if (loc && loc.u >= it.u) continue;
        const nuevo = { ...it.d, id: it.id, u: it.u }; if (it.del) nuevo.del = 1;
        if (loc) DB[k][DB[k].indexOf(loc)] = nuevo; else DB[k].push(nuevo);
      }
      DB[k].forEach(x => { if (x.dirty && enviados[x.id] === x.u) delete x.dirty; });
    }
    CFG.desde = j.ahora; CFG.ultimaSync = Date.now(); persistir();
    ui.sync = 'ok'; ui.syncMsg = 'Sincronizado ' + new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    if (generarAutomaticos()) programarSync();
    if (manual) aviso('Sincronizado con Google Sheets ✓');
  } catch (e) {
    ui.sync = 'err'; ui.syncMsg = 'Error: ' + (e.message || e);
    if (/permisos|authoriz|SpreadsheetApp/i.test(ui.syncMsg)) ui.syncMsg = 'Falta autorizar el script: en Apps Script ejecuta "configurar", acepta permisos y publica una Nueva versión.';
    if (manual) aviso(ui.syncMsg);
  } finally { sincronizando = false; render(); }
}
function pintarEstado() { const e = $('#syncdot'); if (e) { e.className = 'dot ' + ui.sync; e.title = ui.syncMsg; } }

/* ───────── Gráficos (SVG propio, sin librerías) ───────── */
function donut(items) {
  const total = items.reduce((a, x) => a + x.value, 0);
  if (!total) return '<div class="empty">Aún no hay gastos este mes</div>';
  const R = 46, C = 2 * Math.PI * R; let off = 0;
  const arcos = items.map(x => { const len = x.value / total * C; const s = `<circle cx="60" cy="60" r="${R}" fill="none" stroke="${esc(x.color)}" stroke-width="18" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 60 60)"/>`; off += len; return s; }).join('');
  const top = items.slice(0, 5);
  const otros = items.slice(5).reduce((a, x) => a + x.value, 0);
  const leyenda = top.concat(otros ? [{ label: 'Otras', value: otros, color: '#94a3b8' }] : [])
    .map(x => `<div><i style="background:${esc(x.color)}"></i><span>${esc(x.label)}</span><em>${Math.round(x.value / total * 100)}%</em></div>`).join('');
  return `<div class="donutwrap"><svg viewBox="0 0 120 120" role="img" aria-label="Gastos por categoría">${arcos}
    <text x="60" y="57" text-anchor="middle" style="font-size:9px;fill:var(--mut)">Total</text>
    <text x="60" y="71" text-anchor="middle" style="font-size:11px;font-weight:800;fill:var(--ink)">${esc(compacto(total))}</text></svg>
    <div class="legend">${leyenda}</div></div>`;
}
const compacto = n => n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',') + ' M' : n >= 1e3 ? Math.round(n / 1e3) + ' mil' : String(Math.round(n));
function barras(serie) {
  const max = Math.max(1, ...serie.flatMap(s => [s.ing, s.gas])), W = 320, H = 130, base = 108, alto = 92, paso = W / serie.length;
  const bs = serie.map((s, i) => {
    const x = i * paso + paso / 2, h1 = s.ing / max * alto, h2 = s.gas / max * alto;
    return `<rect class="gin" x="${(x - 14).toFixed(1)}" y="${(base - h1).toFixed(1)}" width="12" height="${Math.max(h1, s.ing ? 2 : 0).toFixed(1)}" rx="3"/>
      <rect class="gout" x="${(x + 2).toFixed(1)}" y="${(base - h2).toFixed(1)}" width="12" height="${Math.max(h2, s.gas ? 2 : 0).toFixed(1)}" rx="3"/>
      <text x="${x}" y="${H - 6}" text-anchor="middle">${esc(mesCorto(s.m))}</text>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Ingresos y gastos de los últimos 6 meses"><line x1="0" x2="${W}" y1="${base}" y2="${base}" stroke="var(--line)"/>${bs}</svg>
    <div class="key"><span><i style="background:var(--ok)"></i>Recibido</span><span><i style="background:var(--pay)"></i>Gastos (pagados + pendientes)</span></div>`;
}

/* ───────── Vistas ───────── */
const $view = () => $('#view');
function render() {
  document.querySelectorAll('#nav button[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === ui.tab));
  const v = { inicio: vInicio, movs: vMovs, cuentas: vCuentas, ajustes: vAjustes }[ui.tab]();
  $view().innerHTML = v;
}
const cabecera = (titulo, sub) => {
  const n = recordatorios().filter(r => r.d <= 1 && r.kind !== 'cobro').length;
  return `<div class="top"><div><h1>${esc(titulo)}</h1><small>${sub}</small></div>
    <button class="icobtn" data-act="tab" data-tab="inicio" aria-label="Recordatorios">🔔${n ? `<span class="badge">${n}</span>` : ''}</button></div>`;
};
const selectorMes = () => `<div class="mes"><button data-act="mes" data-d="-1" aria-label="Mes anterior">‹</button><b>${esc(nombreMes(ui.mes))}</b><button data-act="mes" data-d="1" aria-label="Mes siguiente">›</button></div>`;

function filaMov(m, conPagar = true) {
  const c = cat(m.categoria) || { emoji: m.tipo === 'transf' ? '⇄' : '🧾', nombre: 'Otros', color: '#94a3b8' };
  const cu = cue(m.cuenta), de = cue(m.destino), dd = deu(m.deuda);
  const titulo = m.nota || (m.tipo === 'transf' ? 'Transferencia' : m.tipo === 'pago' && dd ? `Pago ${dd.nombre}` : c.nombre);
  const sub = m.tipo === 'transf' ? `${esc((cu || {}).nombre || '—')} → ${esc((de || {}).nombre || '—')}` : `${esc(c.nombre)}${cu ? ' · ' + esc(cu.nombre) : ''}`;
  const pen = m.estado === 'pendiente', d = pen ? diasEntre(hoy(), m.fecha) : 0;
  const chip = pen ? `<span class="chip ${d < 0 ? 'late' : 'pen'}">${d < 0 ? 'Vencido' : 'Pendiente'}</span>` : '';
  const rec = m.rec ? '<span class="chip rec">↻</span>' : '';
  const signo = m.tipo === 'ingreso' ? '+' : m.tipo === 'transf' ? '' : '−';
  const cls = m.tipo === 'ingreso' ? 'in' : pen ? 'pen' : '';
  const btn = conPagar && pen && m.tipo !== 'ingreso' ? `<button class="paybtn" data-act="pagar" data-id="${esc(m.id)}">Pagar</button>` : conPagar && pen ? `<button class="paybtn" data-act="pagar" data-id="${esc(m.id)}">Recibí</button>` : '';
  return `<div class="row" role="button" tabindex="0" data-act="editar" data-id="${esc(m.id)}">
    <div class="ico" style="background:${esc(c.color)}22">${esc(c.emoji)}</div>
    <div class="mid"><b>${esc(titulo)}${chip}${rec}</b><small>${sub} · ${esc(fechaCorta(m.fecha))}</small></div>
    <div class="amt ${cls}">${signo}${fmt(m.monto)}</div>${btn}</div>`;
}

function vInicio() {
  const r = resumen(ui.mes), tot = r.recibido + r.pagado + r.pendiente || 1;
  const cuentas = vivos('cue'), banco = cuentas.filter(c => !esTarjeta(c)).reduce((a, c) => a + saldoCuenta(c), 0);
  const tarj = cuentas.filter(esTarjeta).reduce((a, c) => a + saldoCuenta(c), 0), deudas = vivos('deu').reduce((a, d) => a + saldoDeuda(d), 0);
  const rec = recordatorios();
  const listaRec = rec.length ? `<div class="list">${rec.map(x => {
    if (x.kind === 'tarjeta') return `<div class="row"><div class="ico">💳</div><div class="mid"><b>Pago de ${esc(x.c.nombre)}</b><small>${cuando(x.d)} · usado ${fmt(saldoCuenta(x.c))}</small></div><button class="paybtn" data-act="pagartarjeta" data-id="${esc(x.c.id)}">Pagar</button></div>`;
    return `<div class="row" role="button" tabindex="0" data-act="editar" data-id="${esc(x.m.id)}"><div class="ico">${esc((cat(x.m.categoria) || { emoji: '🧾' }).emoji)}</div>
      <div class="mid"><b>${esc(x.m.nota || (cat(x.m.categoria) || { nombre: 'Pago' }).nombre)}</b><small style="color:${x.d < 0 ? 'var(--bad)' : 'var(--mut)'}">${x.kind === 'cobro' ? 'Cobro · ' : ''}${cuando(x.d)} · ${fmt(x.m.monto)}</small></div>
      <button class="paybtn" data-act="pagar" data-id="${esc(x.m.id)}">${x.kind === 'cobro' ? 'Recibí' : 'Pagar'}</button></div>`;
  }).join('')}</div>` : '<div class="empty">Sin vencimientos en los próximos 7 días 🎉</div>';
  const sinDatos = !vivos('cue').length && !movs().length;
  return `${cabecera('Mi Dinero', `<span class="dot ${ui.sync}" id="syncdot" title="${esc(ui.syncMsg)}"></span>${esc(CFG.usuario ? 'Hola, ' + CFG.usuario : 'Tus finanzas en pesos')}`)}
  ${selectorMes()}
  ${sinDatos ? `<div class="card"><h3>👋 Empieza aquí</h3><div class="help" style="margin:0 0 10px">1) Crea una cuenta (banco, efectivo o tarjeta). 2) Registra tu sueldo con el botón +. 3) Anota gastos y marca los pendientes.</div><button class="btn" data-act="nuevacuenta">Crear mi primera cuenta</button></div>` : ''}
  <div class="card hero"><div class="lbl">Saldo libre del mes</div><div class="big num ${r.libre < 0 ? 'neg' : ''}">${fmt(r.libre)}</div>
    <div class="fx">Recibido − Pagado − Pendiente${r.esperado ? ` · con lo que falta por llegar: ${fmt(r.proyectado)}` : ''}</div>
    <div class="bar"><i style="width:${Math.min(100, r.pagado / tot * 100)}%;background:#7aa2ff"></i><i style="width:${Math.min(100, r.pendiente / tot * 100)}%;background:#f3b04d"></i><i style="width:${Math.max(0, r.libre) / tot * 100}%;background:#3ddc97"></i></div></div>
  <div class="tiles"><div class="tile in"><small>Recibido</small><b class="num">${fmt(r.recibido)}</b></div>
    <div class="tile out"><small>Pagado</small><b class="num">${fmt(r.pagado)}</b></div>
    <div class="tile pen"><small>Pendiente</small><b class="num">${fmt(r.pendiente)}</b></div></div>
  ${r.arrastre ? `<div class="note">Incluye ${fmt(r.arrastre)} de meses anteriores que aún no pagas.</div>` : '<div class="note">Lo pendiente ya está reservado: cuando lo pagas pasa a “Pagado” y no se descuenta otra vez.</div>'}
  <div class="card"><h3>Recordatorios <small>próximos 7 días</small></h3>${listaRec}</div>
  <div class="card"><h3>Gastos por categoría <small>${esc(mesCorto(ui.mes))}</small></h3>${donut(gastosPorCategoria(ui.mes))}</div>
  <div class="card"><h3>Últimos 6 meses</h3>${barras(serie6(ui.mes))}</div>
  <div class="card"><h3>Mi panorama</h3>
    <div class="kv"><span>Dinero en cuentas</span><b class="num">${fmt(banco)}</b></div>
    <div class="kv"><span>Usado en tarjetas</span><b class="num">${fmt(tarj)}</b></div>
    <div class="kv"><span>Deudas por pagar</span><b class="num">${fmt(deudas)}</b></div>
    <div class="kv"><span>Patrimonio neto</span><b class="num">${fmt(banco - tarj - deudas)}</b></div></div>`;
}

function vMovs() {
  const f = ui.filtro;
  let l = movs().filter(m => mesDe(m.fecha) === ui.mes);
  if (f === 'gasto') l = l.filter(m => m.tipo === 'gasto' || m.tipo === 'pago');
  if (f === 'ingreso') l = l.filter(m => m.tipo === 'ingreso');
  if (f === 'pendiente') l = l.filter(m => m.estado === 'pendiente');
  l.sort((a, b) => b.fecha.localeCompare(a.fecha) || b.u - a.u);
  const grupos = {}; l.forEach(m => (grupos[m.fecha] = grupos[m.fecha] || []).push(m));
  const html = Object.keys(grupos).map(fe => `<div class="group">${esc(fechaCorta(fe))}</div><div class="card" style="padding:4px 14px">${grupos[fe].map(m => filaMov(m)).join('')}</div>`).join('');
  const pills = [['todos', 'Todos'], ['gasto', 'Gastos'], ['ingreso', 'Ingresos'], ['pendiente', 'Pendientes']].map(([k, t]) => `<button class="pill ${f === k ? 'on' : ''}" data-act="filtro" data-f="${k}">${t}</button>`).join('');
  return `${cabecera('Movimientos', 'Todo lo que entra y sale')}${selectorMes()}<div class="filters">${pills}</div>${html || '<div class="empty">No hay movimientos con este filtro.</div>'}`;
}

function vCuentas() {
  const cs = vivos('cue'), noT = cs.filter(c => !esTarjeta(c)), ts = cs.filter(esTarjeta), ds = vivos('deu');
  const fCuenta = c => `<div class="row" role="button" tabindex="0" data-act="editcuenta" data-id="${esc(c.id)}"><div class="ico">${{ efectivo: '💵', billetera: '📱', corriente: '🏦', ahorros: '🏦' }[c.tipo] || '🏦'}</div>
    <div class="mid"><b>${esc(c.nombre)}</b><small>${esc(TIPOS_CUENTA[c.tipo])}${c.ult4 ? ' · •••• ' + esc(c.ult4) : ''}</small></div><div class="amt num">${fmt(saldoCuenta(c))}</div></div>`;
  const fTarj = c => { const u = saldoCuenta(c), cupo = Number(c.cupo) || 0, p = cupo ? Math.min(100, u / cupo * 100) : 0;
    return `<div class="row" role="button" tabindex="0" data-act="editcuenta" data-id="${esc(c.id)}" style="align-items:flex-start"><div class="ico">💳</div>
    <div class="mid"><b>${esc(c.nombre)}${c.ult4 ? ' •••• ' + esc(c.ult4) : ''}</b><small>Cupo ${fmt(cupo)} · disponible ${fmt(Math.max(0, cupo - u))}${c.diaPago ? ' · paga el día ' + esc(c.diaPago) : ''}</small>
    <div class="progress ${p > 90 ? 'bad' : p > 70 ? 'warn' : ''}"><i style="width:${p}%"></i></div></div><div class="amt num">${fmt(u)}<small>usado</small></div></div>`; };
  const fDeuda = d => { const s = saldoDeuda(d), t = Number(d.total) || 1, p = Math.min(100, (1 - s / t) * 100);
    return `<div class="row" role="button" tabindex="0" data-act="editdeuda" data-id="${esc(d.id)}" style="align-items:flex-start"><div class="ico">📉</div>
    <div class="mid"><b>${esc(d.nombre)}</b><small>${esc(d.acreedor || 'Deuda')}${d.cuota ? ' · cuota ' + fmt(d.cuota) : ''}${d.dia ? ' · día ' + esc(d.dia) : ''}</small>
    <div class="progress"><i style="width:${p}%"></i></div></div><div class="amt num">${fmt(s)}<small>${Math.round(p)}% pagado</small></div></div>`; };
  const sec = (t, add, act, lista, vacio) => `<div class="card"><h3>${t}<button class="paybtn" data-act="${act}">+ ${add}</button></h3>${lista.length ? `<div class="list">${lista.join('')}</div>` : `<div class="empty">${vacio}</div>`}</div>`;
  return `${cabecera('Cuentas', 'Bancos, tarjetas y deudas')}
  ${sec('Cuentas', 'Cuenta', 'nuevacuenta', noT.map(fCuenta), 'Agrega tu banco, billetera o efectivo.')}
  ${sec('Tarjetas de crédito', 'Tarjeta', 'nuevatarjeta', ts.map(fTarj), 'Controla cupo y fecha de pago.')}
  ${sec('Deudas', 'Deuda', 'nuevadeuda', ds.map(fDeuda), 'Préstamos, libranzas, créditos. La cuota se programa sola cada mes.')}`;
}

function vAjustes() {
  const conf = CFG.url && CFG.clave;
  return `${cabecera('Ajustes', 'Seguridad, Google Sheets y respaldo')}
  <div class="card"><h3>Quién eres</h3><label class="f">Tu nombre (aparece en lo que registras)<input id="a-usuario" value="${esc(CFG.usuario)}" maxlength="30" placeholder="Ej: Laura" autocomplete="off"></label>
    <button class="btn sec" data-act="gusuario">Guardar nombre</button></div>
  <div class="card"><h3>Google Sheets <small><span class="dot ${ui.sync}" id="syncdot"></span>${esc(conf ? (ui.syncMsg || 'Configurado') : 'Sin configurar')}</small></h3>
    <label class="f">URL de la aplicación web (termina en /exec)<input id="a-url" value="${esc(CFG.url)}" inputmode="url" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off"></label>
    <label class="f">Clave compartida<input id="a-clave" type="password" value="${esc(CFG.clave)}" placeholder="La misma que pusiste en Code.gs" autocomplete="off"></label>
    <div class="help">Tu pareja o familia usa la misma URL y clave en su celular: todos ven y registran sobre la misma hoja.</div>
    <div class="btns"><button class="btn" data-act="gsheets">Guardar y sincronizar</button></div></div>
  <div class="card"><h3>Seguridad</h3>
    <div class="kv"><span>Bloqueo con PIN</span><b>${CFG.pin ? 'Activo' : 'Desactivado'}</b></div>
    <div class="btns" style="margin-top:10px"><button class="btn sec" data-act="pin">${CFG.pin ? 'Cambiar o quitar PIN' : 'Crear PIN de 4 dígitos'}</button></div>
    <div class="help" style="margin-top:10px">El PIN bloquea la pantalla (y se activa solo tras 1 minuto fuera de la app). Nunca guardes números completos de tarjeta ni claves bancarias: la app solo pide los últimos 4 dígitos.</div></div>
  <div class="card"><h3>Recordatorios</h3>
    <label class="switch">Avisarme al abrir la app si hay pagos próximos<input type="checkbox" id="a-notif" data-act="notif" ${CFG.notif ? 'checked' : ''}></label>
    <div class="help">Para recibir también un correo cada mañana, activa el disparador de Code.gs (ver LEEME).</div></div>
  <div class="card"><h3>Mis categorías</h3><div class="chips">${vivos('cat').map(c => `<button data-act="editcat" data-id="${esc(c.id)}">${esc(c.emoji)} ${esc(c.nombre)}</button>`).join('')}</div>
    <button class="btn sec" data-act="nuevacat">+ Nueva categoría</button></div>
  <div class="card"><h3>Respaldo</h3><div class="btns">
    <button class="btn sec" data-act="csv">Descargar movimientos (CSV)</button>
    <button class="btn sec" data-act="respaldo">Descargar respaldo completo (JSON)</button></div></div>`;
}

/* ───────── Hojas modales ───────── */
function abrirHoja(html) { const s = $('#sheet'); s.innerHTML = `<div class="panel" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`; s.hidden = false; return s; }
function cerrarHoja() { const s = $('#sheet'); s.hidden = true; s.innerHTML = ''; ui.fm = null; }
let tToast = null;
function aviso(t) { const e = $('#toast'); e.textContent = t; e.classList.add('on'); clearTimeout(tToast); tToast = setTimeout(() => e.classList.remove('on'), 2600); }
const opciones = (lista, sel, vacio) => (vacio ? `<option value="">${esc(vacio)}</option>` : '') + lista.map(([v, t]) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(t)}</option>`).join('');

/* Formulario de movimiento */
function abrirMov(m) {
  ui.fm = m ? { ...m, monto: m.monto } : { tipo: 'gasto', estado: 'pagado', fecha: hoy(), categoria: 'cat_mercado', cuenta: (vivos('cue')[0] || {}).id || '', rec: '' };
  pintarMov();
}
function leerMov() {
  const f = ui.fm, q = id => $('#' + id); if (!q('m-monto')) return;
  f.monto = num(q('m-monto').value); f.nota = q('m-nota').value.trim();
  if (q('m-cuenta')) f.cuenta = q('m-cuenta').value; if (q('m-destino')) f.destino = q('m-destino').value;
  if (q('m-deuda')) f.deuda = q('m-deuda').value; if (q('m-fecha')) f.fecha = q('m-fecha').value;
  if (q('m-enlace')) f.enlace = q('m-enlace').value.trim(); if (q('m-rec')) f.rec = q('m-rec').checked ? 'mensual' : '';
}
function pintarMov() {
  const f = ui.fm, nuevo = !f.id, t = f.tipo, cs = vivos('cue');
  const cuentasOk = t === 'ingreso' ? cs.filter(c => !esTarjeta(c)) : cs;
  const cats = vivos('cat').filter(c => t === 'ingreso' ? c.tipo === 'ingreso' : c.tipo === 'gasto');
  const seg = [['gasto', 'Gasto'], ['ingreso', 'Ingreso'], ['pago', 'Pago deuda'], ['transf', 'Transferir']].map(([k, n]) => `<button type="button" class="${t === k ? 'on' : ''}" data-act="mtipo" data-t="${k}">${n}</button>`).join('');
  const chips = t === 'transf' || t === 'pago' ? '' : `<div style="font-size:13px;font-weight:700;color:var(--mut)">Categoría</div><div class="chips">${cats.map(c => `<button type="button" class="${f.categoria === c.id ? 'on' : ''}" data-act="mcat" data-id="${esc(c.id)}">${esc(c.emoji)} ${esc(c.nombre)}</button>`).join('')}</div>`;
  const pend = f.estado === 'pendiente';
  const estado = t === 'transf' ? '' : `<div class="seg"><button type="button" class="${!pend ? 'on' : ''}" data-act="mestado" data-e="pagado">${t === 'ingreso' ? 'Ya lo recibí' : 'Ya lo pagué'}</button><button type="button" class="${pend ? 'on' : ''}" data-act="mestado" data-e="pendiente">${t === 'ingreso' ? 'Por recibir' : 'Pendiente'}</button></div>`;
  const selDeuda = t === 'pago' ? `<label class="f">Deuda<select id="m-deuda" data-act="mdeuda">${opciones(vivos('deu').map(d => [d.id, `${d.nombre} (${fmt(saldoDeuda(d))})`]), f.deuda, 'Elige una deuda')}</select></label>` : '';
  const cuentaLbl = t === 'ingreso' ? 'Llega a' : t === 'transf' ? 'Sale de' : 'Pago con';
  const selCuenta = `<label class="f">${cuentaLbl}<select id="m-cuenta">${opciones(cuentasOk.map(c => [c.id, c.nombre + (esTarjeta(c) ? ' (tarjeta)' : '')]), f.cuenta, pend && t !== 'transf' ? 'Aún no sé / se define al pagar' : cuentasOk.length ? '' : 'Crea una cuenta primero')}</select></label>`;
  const selDest = t === 'transf' ? `<label class="f">Entra a (si es una tarjeta, es el pago de la tarjeta)<select id="m-destino">${opciones(cs.filter(c => c.id !== f.cuenta).map(c => [c.id, c.nombre + (esTarjeta(c) ? ' (tarjeta)' : '')]), f.destino, 'Elige destino')}</select></label>` : '';
  const enlace = pend && t !== 'ingreso' && t !== 'transf' ? `<label class="f">Enlace de pago (opcional)<select id="m-pre" data-act="mpre">${opciones(ENLACES.map(([n, u]) => [u, n]), '', 'Elegir PSE / banco…')}</select>
    <input id="m-enlace" value="${esc(f.enlace || '')}" inputmode="url" placeholder="https://… (portal de la empresa)" style="margin-top:6px"></label>` : '';
  const rec = t === 'transf' ? '' : `<label class="switch">Se repite cada mes<input type="checkbox" id="m-rec" ${f.rec ? 'checked' : ''}></label>`;
  abrirHoja(`<h2>${nuevo ? 'Nuevo movimiento' : 'Editar movimiento'}</h2><form id="f-mov" autocomplete="off">
    <div class="seg">${seg}</div>
    <label class="f">Monto (COP)<input class="monto" id="m-monto" inputmode="numeric" value="${f.monto ? miles(f.monto) : ''}" placeholder="0" required></label>
    ${selDeuda}${chips}${estado}
    <div class="two"><label class="f">${pend ? 'Vence' : 'Fecha'}<input type="date" id="m-fecha" value="${esc(f.fecha)}" required></label>${selCuenta}</div>
    ${selDest}
    <label class="f">Nota<input id="m-nota" value="${esc(f.nota || '')}" maxlength="80" placeholder="Ej: Mercado D1, arriendo…"></label>
    ${enlace}${rec}
    <div class="btns"><button class="btn" type="submit">Guardar</button>${nuevo ? '' : '<button class="btn danger" type="button" data-act="mborrar">Eliminar</button>'}<button class="btn sec" type="button" data-act="cerrar">Cancelar</button></div></form>`);
}
function guardarMov() {
  leerMov(); const f = ui.fm;
  if (!f.monto) return aviso('Escribe un monto');
  if (!f.fecha) return aviso('Elige una fecha');
  if (f.tipo === 'transf') { if (!f.cuenta || !f.destino) return aviso('Elige origen y destino'); if (f.cuenta === f.destino) return aviso('Origen y destino deben ser distintos'); f.estado = 'pagado'; }
  if (f.tipo === 'pago') { if (!f.deuda) return aviso('Elige la deuda'); f.categoria = 'cat_deuda'; }
  if (f.estado === 'pagado' && f.tipo !== 'transf' && !f.cuenta) return aviso('Elige la cuenta');
  const enl = f.enlace ? https(f.enlace) : ''; if (f.enlace && !enl) return aviso('El enlace debe empezar por https://');
  const o = { id: f.id || uid(), tipo: f.tipo, monto: f.monto, estado: f.estado, fecha: f.fecha, categoria: f.categoria || '', cuenta: f.cuenta || '', destino: f.tipo === 'transf' ? f.destino : '',
    deuda: f.tipo === 'pago' ? f.deuda : '', nota: f.nota || '', enlace: enl, rec: f.tipo === 'transf' ? '' : f.rec || '', usuario: f.usuario || CFG.usuario, serie: f.serie || '' };
  if (f.estado === 'pendiente') o.vence = f.fecha; else if (f.vence) o.vence = f.vence;
  if (o.rec && !o.serie) o.serie = o.id;
  guardar('mov', o); cerrarHoja(); ui.mes = mesDe(o.fecha); render(); aviso('Guardado ✓');
}

/* Pagar / marcar recibido, con enlace de pago opcional */
function abrirPagar(id) {
  const m = buscar('mov', id); if (!m) return; const ing = m.tipo === 'ingreso';
  const cs = vivos('cue').filter(c => !ing || !esTarjeta(c)); const enl = https(m.enlace);
  abrirHoja(`<h2>${ing ? 'Confirmar cobro' : 'Confirmar pago'}</h2><div class="sum"><small style="color:var(--mut)">${esc(m.nota || (cat(m.categoria) || {}).nombre || 'Movimiento')}</small><b class="num">${fmt(m.monto)}</b>
    <small style="color:var(--mut)">${esc(cuando(diasEntre(hoy(), m.fecha)))}</small></div>
    ${enl ? `<button class="btn link" data-act="abrirlink" data-id="${esc(m.id)}">Abrir enlace de pago ↗</button><div class="help" style="margin-top:8px">Paga en el sitio del banco o PSE. Luego vuelve aquí y confirma: la app no procesa pagos ni guarda claves.</div>` : ''}
    <form id="f-pagar" data-id="${esc(m.id)}"><div class="two"><label class="f">${ing ? 'Llegó a' : 'Pagué con'}<select id="p-cuenta">${opciones(cs.map(c => [c.id, c.nombre]), m.cuenta || (cs[0] || {}).id)}</select></label>
    <label class="f">Fecha<input type="date" id="p-fecha" value="${hoy()}"></label></div>
    <div class="btns"><button class="btn" type="submit">${ing ? 'Sí, ya lo recibí' : 'Sí, ya lo pagué'} ✓</button><button class="btn sec" type="button" data-act="cerrar">Todavía no</button></div></form>`);
}
function confirmarPago(id) {
  const m = buscar('mov', id), cuenta = $('#p-cuenta').value, fecha = $('#p-fecha').value || hoy();
  if (!cuenta) return aviso('Elige una cuenta');
  guardar('mov', { ...m, estado: 'pagado', cuenta, fecha, vence: m.vence || m.fecha });
  cerrarHoja(); render(); aviso(m.tipo === 'ingreso' ? 'Cobro registrado ✓' : 'Pago registrado ✓');
}
function abrirPagarTarjeta(id) {
  const c = cue(id), uso = Math.max(0, saldoCuenta(c));
  ui.fm = { tipo: 'transf', estado: 'pagado', fecha: hoy(), destino: c.id, monto: uso, cuenta: (vivos('cue').find(x => !esTarjeta(x)) || {}).id || '', nota: 'Pago ' + c.nombre, rec: '' }; pintarMov();
}

/* Cuentas, tarjetas, deudas, categorías */
function abrirCuenta(c, tarjeta) {
  const o = c || { tipo: tarjeta ? 'tarjeta' : 'ahorros' }, t = esTarjeta(o);
  abrirHoja(`<h2>${c ? 'Editar' : 'Nueva'} ${t ? 'tarjeta' : 'cuenta'}</h2><form id="f-cuenta" data-id="${esc(o.id || '')}" data-t="${t ? 1 : 0}" autocomplete="off">
    <label class="f">Nombre<input id="c-nombre" value="${esc(o.nombre || '')}" maxlength="40" placeholder="${t ? 'Ej: Visa Bancolombia' : 'Ej: Nequi, Bancolombia ahorros'}" required></label>
    ${t ? '' : `<label class="f">Tipo<select id="c-tipo">${opciones(Object.entries(TIPOS_CUENTA).filter(([k]) => k !== 'tarjeta'), o.tipo)}</select></label>`}
    <label class="f">${t ? 'Cuánto debes hoy en la tarjeta' : 'Saldo actual'}<input id="c-saldo" inputmode="numeric" value="${miles(o.saldoIni)}" placeholder="0"></label>
    ${t ? `<label class="f">Cupo total<input id="c-cupo" inputmode="numeric" value="${miles(o.cupo)}" placeholder="0"></label>
    <div class="two"><label class="f">Día de corte<input id="c-corte" inputmode="numeric" maxlength="2" value="${esc(o.corte || '')}"></label><label class="f">Día límite de pago<input id="c-dpago" inputmode="numeric" maxlength="2" value="${esc(o.diaPago || '')}"></label></div>` : ''}
    <label class="f">Últimos 4 dígitos (opcional)<input id="c-ult4" inputmode="numeric" maxlength="4" value="${esc(o.ult4 || '')}"></label>
    <div class="help">Por seguridad no guardes el número completo, el CVV ni claves.</div>
    <div class="btns"><button class="btn" type="submit">Guardar</button>${c ? '<button class="btn danger" type="button" data-act="cborrar" data-id="' + esc(c.id) + '">Eliminar</button>' : ''}<button class="btn sec" type="button" data-act="cerrar">Cancelar</button></div></form>`);
}
function guardarCuenta(form) {
  const t = form.dataset.t === '1', id = form.dataset.id || uid(), prev = buscar('cue', id) || {};
  const nombre = $('#c-nombre').value.trim(); if (!nombre) return aviso('Escribe un nombre');
  guardar('cue', { ...prev, id, nombre, tipo: t ? 'tarjeta' : $('#c-tipo').value, saldoIni: num($('#c-saldo').value), cupo: t ? num($('#c-cupo').value) : 0,
    corte: t ? num($('#c-corte').value) || '' : '', diaPago: t ? Math.min(31, num($('#c-dpago').value)) || '' : '', ult4: $('#c-ult4').value.replace(/\D/g, '').slice(0, 4) });
  cerrarHoja(); render(); aviso('Guardado ✓');
}
function abrirDeuda(d) {
  const o = d || {};
  abrirHoja(`<h2>${d ? 'Editar deuda' : 'Nueva deuda'}</h2><form id="f-deuda" data-id="${esc(o.id || '')}" autocomplete="off">
    <label class="f">Nombre<input id="d-nombre" value="${esc(o.nombre || '')}" maxlength="40" placeholder="Ej: Crédito de libranza" required></label>
    <label class="f">¿A quién le debes?<input id="d-acre" value="${esc(o.acreedor || '')}" maxlength="40" placeholder="Banco, cooperativa, persona…"></label>
    <label class="f">Cuánto debes hoy${d ? ' (saldo al registrarla)' : ''}<input id="d-total" inputmode="numeric" value="${miles(o.total)}" required></label>
    <div class="two"><label class="f">Cuota mensual<input id="d-cuota" inputmode="numeric" value="${miles(o.cuota)}"></label><label class="f">Día de pago<input id="d-dia" inputmode="numeric" maxlength="2" value="${esc(o.dia || '')}"></label></div>
    <label class="f">Enlace de pago (opcional)<select id="d-pre" data-act="dpre">${opciones(ENLACES.map(([n, u]) => [u, n]), '', 'Elegir PSE / banco…')}</select>
    <input id="d-enlace" value="${esc(o.enlace || '')}" inputmode="url" placeholder="https://…" style="margin-top:6px"></label>
    <div class="help">Si indicas cuota y día, la app programa la cuota cada mes como “pendiente” y te la recuerda. Al pagarla baja el saldo de la deuda.</div>
    <div class="btns"><button class="btn" type="submit">Guardar</button>${d ? '<button class="btn danger" type="button" data-act="dborrar" data-id="' + esc(d.id) + '">Eliminar</button>' : ''}<button class="btn sec" type="button" data-act="cerrar">Cancelar</button></div></form>`);
}
function guardarDeuda(form) {
  const id = form.dataset.id || uid(), prev = buscar('deu', id) || {}; const nombre = $('#d-nombre').value.trim();
  if (!nombre || !num($('#d-total').value)) return aviso('Completa nombre y monto');
  const enl = $('#d-enlace').value.trim(); if (enl && !https(enl)) return aviso('El enlace debe empezar por https://');
  guardar('deu', { ...prev, id, nombre, acreedor: $('#d-acre').value.trim(), total: num($('#d-total').value), cuota: num($('#d-cuota').value), dia: Math.min(31, num($('#d-dia').value)) || '',
    enlace: enl ? https(enl) : '', creada: prev.creada || hoy() });
  generarAutomaticos(); cerrarHoja(); render(); aviso('Guardado ✓');
}
function abrirCat(c) {
  const o = c || { tipo: 'gasto', emoji: '🏷️', color: '#14b8a6' };
  abrirHoja(`<h2>${c ? 'Editar' : 'Nueva'} categoría</h2><form id="f-cat" data-id="${esc(o.id || '')}" autocomplete="off">
    <div class="two"><label class="f">Emoji<input id="k-emoji" value="${esc(o.emoji)}" maxlength="4"></label><label class="f">Tipo<select id="k-tipo">${opciones([['gasto', 'Gasto'], ['ingreso', 'Ingreso']], o.tipo)}</select></label></div>
    <label class="f">Nombre<input id="k-nombre" value="${esc(o.nombre || '')}" maxlength="24" required></label>
    <label class="f">Color<input type="color" id="k-color" value="${esc(o.color)}" style="height:48px;padding:4px"></label>
    <div class="btns"><button class="btn" type="submit">Guardar</button>${c ? '<button class="btn danger" type="button" data-act="kborrar" data-id="' + esc(c.id) + '">Eliminar</button>' : ''}<button class="btn sec" type="button" data-act="cerrar">Cancelar</button></div></form>`);
}
function guardarCat(form) {
  const id = form.dataset.id || uid(), nombre = $('#k-nombre').value.trim(); if (!nombre) return aviso('Escribe un nombre');
  const color = /^#[0-9a-f]{6}$/i.test($('#k-color').value) ? $('#k-color').value : '#14b8a6';
  guardar('cat', { id, nombre, emoji: $('#k-emoji').value.trim() || '🏷️', tipo: $('#k-tipo').value, color }); cerrarHoja(); render();
}

/* ───────── PIN ───────── */
const b64 = u8 => btoa(String.fromCharCode(...u8)), unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function hashPin(pin, salt) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  return b64(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unb64(salt), iterations: 150000, hash: 'SHA-256' }, k, 256)));
}
let pinBuf = '', pinModo = 'abrir', pinTmp = '', fallos = 0, bloqHasta = 0, pinCb = null;
function pantallaPin(modo, titulo, cb) {
  pinModo = modo; pinBuf = ''; pinTmp = ''; pinCb = cb || null;
  const l = $('#lock'); l.hidden = false;
  l.innerHTML = `<div style="font-size:44px">🔐</div><h2 id="pin-t">${esc(titulo)}</h2><p id="pin-m"></p><div class="dots" id="pin-d">${'<i></i>'.repeat(4)}</div>
    <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-act="pinkey" data-k="${n}">${n}</button>`).join('')}
    <button data-act="${modo === 'abrir' ? 'noop' : 'pincancel'}" style="font-size:15px">${modo === 'abrir' ? '' : 'Cancelar'}</button><button data-act="pinkey" data-k="0">0</button><button data-act="pinkey" data-k="x" aria-label="Borrar">⌫</button></div>`;
}
const pintarPin = () => document.querySelectorAll('#pin-d i').forEach((e, i) => e.classList.toggle('on', i < pinBuf.length));
async function teclaPin(k) {
  if (Date.now() < bloqHasta) { $('#pin-m').textContent = 'Espera ' + Math.ceil((bloqHasta - Date.now()) / 1000) + ' s'; return; }
  if (k === 'x') pinBuf = pinBuf.slice(0, -1); else if (pinBuf.length < 4) pinBuf += k;
  pintarPin(); if (pinBuf.length < 4) return;
  const ingresado = pinBuf; pinBuf = '';
  if (pinModo === 'abrir' || pinModo === 'verificar') {
    const ok = CFG.pin && await hashPin(ingresado, CFG.pin.salt) === CFG.pin.hash;
    if (ok) { fallos = 0; $('#lock').hidden = true; if (pinCb) pinCb(); pinCb = null; }
    else { fallos++; if (fallos >= 5) { bloqHasta = Date.now() + 30000; fallos = 0; } $('#pin-m').textContent = 'PIN incorrecto'; navigator.vibrate && navigator.vibrate(120); }
  } else if (pinModo === 'nuevo') { pinTmp = ingresado; pinModo = 'confirmar'; $('#pin-t').textContent = 'Repite el PIN'; }
  else if (pinModo === 'confirmar') {
    if (ingresado !== pinTmp) { pinModo = 'nuevo'; $('#pin-t').textContent = 'Crea tu PIN'; $('#pin-m').textContent = 'No coinciden, intenta de nuevo'; }
    else { const salt = b64(crypto.getRandomValues(new Uint8Array(16))); CFG.pin = { salt, hash: await hashPin(ingresado, salt) }; persistir(); $('#lock').hidden = true; render(); aviso('PIN activado ✓'); }
  }
  pintarPin();
}
function bloquear() { if (CFG.pin && $('#lock').hidden) pantallaPin('abrir', 'Mi Dinero bloqueado'); }
let ocultoDesde = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) ocultoDesde = Date.now();
  else { if (CFG.pin && ocultoDesde && Date.now() - ocultoDesde > 60000) bloquear(); if (CFG.url) programarSync(); avisarVencimientos(); }
});

/* ───────── Notificaciones al abrir ───────── */
async function avisarVencimientos() {
  if (!CFG.notif || !('Notification' in window) || Notification.permission !== 'granted' || CFG.notifDia === hoy()) return;
  const r = recordatorios().filter(x => x.d <= 2 && x.kind !== 'cobro'); if (!r.length) return;
  CFG.notifDia = hoy(); persistir();
  const total = r.reduce((a, x) => a + (x.m ? x.m.monto : 0), 0);
  const cuerpo = `${r.length} pago${r.length > 1 ? 's' : ''} próximo${r.length > 1 ? 's' : ''}${total ? ' por ' + fmt(total) : ''}`;
  try { const reg = await navigator.serviceWorker.getRegistration(); if (reg) reg.showNotification('Mi Dinero', { body: cuerpo, icon: 'icon-192.png', tag: 'vencimientos' }); else new Notification('Mi Dinero', { body: cuerpo }); } catch {}
}

/* ───────── Exportar ───────── */
function descargar(nombre, tipo, contenido) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([contenido], { type: tipo })); a.download = nombre; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function exportarCSV() {
  const celda = v => { v = String(v ?? ''); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const cab = ['Fecha', 'Vence', 'Tipo', 'Monto', 'Estado', 'Categoría', 'Cuenta', 'Destino', 'Deuda', 'Nota', 'Usuario'];
  const filas = movs().sort((a, b) => a.fecha.localeCompare(b.fecha)).map(m => { const v = vista('mov', m); return [v.fecha, v.vence, v.tipo, v.monto, v.estado, v.categoria, v.cuenta, v.destino, v.deuda, v.nota, v.usuario].map(celda).join(','); });
  descargar('mi-dinero-movimientos.csv', 'text/csv;charset=utf-8', '﻿' + [cab.join(','), ...filas].join('\n'));
}

/* ───────── Eventos ───────── */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); const sheet = $('#sheet');
  if (!el) { if (e.target === sheet) cerrarHoja(); return; }
  const a = el.dataset.act, id = el.dataset.id;
  switch (a) {
    case 'tab': ui.tab = el.dataset.tab; render(); window.scrollTo(0, 0); break;
    case 'mes': ui.mes = addMes(ui.mes, Number(el.dataset.d)); render(); break;
    case 'filtro': ui.filtro = el.dataset.f; render(); break;
    case 'nuevo': if (!vivos('cue').length) { aviso('Primero crea una cuenta'); abrirCuenta(null, false); } else abrirMov(null); break;
    case 'editar': { const m = buscar('mov', id); if (m) abrirMov(m); break; }
    case 'cerrar': cerrarHoja(); break;
    case 'mtipo': leerMov(); ui.fm.tipo = el.dataset.t; ui.fm.categoria = el.dataset.t === 'ingreso' ? 'cat_sueldo' : 'cat_mercado'; if (el.dataset.t === 'transf') ui.fm.estado = 'pagado'; if (el.dataset.t === 'pago') ui.fm.estado = 'pagado'; pintarMov(); break;
    case 'mcat': leerMov(); ui.fm.categoria = id; pintarMov(); break;
    case 'mestado': leerMov(); ui.fm.estado = el.dataset.e; pintarMov(); break;
    case 'mdeuda': break;
    case 'mborrar': if (confirm('¿Eliminar este movimiento?')) { borrar('mov', ui.fm.id); cerrarHoja(); render(); aviso('Eliminado'); } break;
    case 'pagar': abrirPagar(id); break;
    case 'abrirlink': { const m = buscar('mov', id), u = https(m && m.enlace); if (u) window.open(u, '_blank', 'noopener,noreferrer'); break; }
    case 'pagartarjeta': abrirPagarTarjeta(id); break;
    case 'nuevacuenta': abrirCuenta(null, false); break;
    case 'nuevatarjeta': abrirCuenta(null, true); break;
    case 'editcuenta': abrirCuenta(cue(id), esTarjeta(cue(id))); break;
    case 'cborrar': if (confirm('¿Eliminar esta cuenta? Sus movimientos se conservan pero quedarán sin cuenta.')) { borrar('cue', id); cerrarHoja(); render(); } break;
    case 'nuevadeuda': abrirDeuda(null); break;
    case 'editdeuda': abrirDeuda(deu(id)); break;
    case 'dborrar': if (confirm('¿Eliminar esta deuda y sus cuotas pendientes?')) { movs().filter(m => m.deuda === id && m.estado === 'pendiente').forEach(m => borrar('mov', m.id)); borrar('deu', id); cerrarHoja(); render(); } break;
    case 'nuevacat': abrirCat(null); break;
    case 'editcat': abrirCat(cat(id)); break;
    case 'kborrar': if (confirm('¿Eliminar categoría?')) { borrar('cat', id); cerrarHoja(); render(); } break;
    case 'gusuario': CFG.usuario = $('#a-usuario').value.trim().slice(0, 30); persistir(); render(); aviso('Nombre guardado'); break;
    case 'gsheets': {
      const url = $('#a-url').value.trim(), clave = $('#a-clave').value.trim();
      if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) return aviso('La URL debe ser https://script.google.com/macros/s/…/exec');
      if (clave.length < 8) return aviso('La clave debe tener al menos 8 caracteres');
      CFG.url = url; CFG.clave = clave; CFG.desde = 0; COLS.forEach(k => DB[k].forEach(x => { x.dirty = 1; })); persistir(); sync(true); break;
    }
    case 'pin': if (CFG.pin) abrirHoja(`<h2>PIN de bloqueo</h2><div class="btns"><button class="btn" data-act="pinnuevo">Cambiar PIN</button><button class="btn danger" data-act="pinquitar">Quitar PIN</button><button class="btn sec" data-act="cerrar">Cancelar</button></div>`); else { pantallaPin('nuevo', 'Crea tu PIN'); } break;
    case 'pinnuevo': cerrarHoja(); pantallaPin('verificar', 'Escribe tu PIN actual', () => pantallaPin('nuevo', 'Crea tu PIN nuevo')); break;
    case 'pinquitar': cerrarHoja(); pantallaPin('verificar', 'Escribe tu PIN para quitarlo', () => { CFG.pin = null; persistir(); render(); aviso('PIN desactivado'); }); break;
    case 'pinkey': teclaPin(el.dataset.k); break;
    case 'pincancel': $('#lock').hidden = true; break;
    case 'csv': exportarCSV(); break;
    case 'respaldo': descargar('mi-dinero-respaldo.json', 'application/json', JSON.stringify({ version: 1, fecha: new Date().toISOString(), datos: DB }, null, 1)); break;
  }
});
document.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.row[data-act]')) { e.preventDefault(); e.target.click(); } if (e.key === 'Escape' && !$('#sheet').hidden) cerrarHoja(); });
document.addEventListener('submit', e => {
  e.preventDefault(); const f = e.target;
  if (f.id === 'f-mov') guardarMov(); else if (f.id === 'f-pagar') confirmarPago(f.dataset.id);
  else if (f.id === 'f-cuenta') guardarCuenta(f); else if (f.id === 'f-deuda') guardarDeuda(f); else if (f.id === 'f-cat') guardarCat(f);
});
document.addEventListener('input', e => { if (e.target.id && /^(m-monto|c-saldo|c-cupo|d-total|d-cuota)$/.test(e.target.id)) e.target.value = miles(e.target.value); });
document.addEventListener('change', async e => {
  const t = e.target;
  if (t.id === 'm-pre' && t.value) $('#m-enlace').value = t.value;
  if (t.id === 'd-pre' && t.value) $('#d-enlace').value = t.value;
  if (t.id === 'm-deuda') { const d = deu(t.value); if (d) { if (!num($('#m-monto').value)) $('#m-monto').value = miles(Math.min(d.cuota || saldoDeuda(d), saldoDeuda(d))); if (!$('#m-nota').value) $('#m-nota').value = 'Cuota ' + d.nombre; } }
  if (t.id === 'm-cuenta' && ui.fm && ui.fm.tipo === 'transf') { leerMov(); pintarMov(); }
  if (t.id === 'a-notif') {
    if (t.checked && 'Notification' in window) { const p = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission(); CFG.notif = p === 'granted'; if (p !== 'granted') { t.checked = false; aviso('El permiso de notificaciones fue denegado'); } }
    else CFG.notif = false;
    persistir();
  }
});
window.addEventListener('online', () => { if (CFG.url) sync(false); });

/* Enlace de configuración: abrir  …/App-Mis-Cuentas-/#u=<URL /exec>&k=<CLAVE>  deja la app lista en ese aparato.
   Va en el fragmento (#), que nunca se envía a ningún servidor, y se borra de la barra al leerlo. */
function configDesdeEnlace() {
  if (!location.hash || location.hash.length < 5) return;
  try {
    const p = new URLSearchParams(location.hash.slice(1)), u = p.get('u') || '', k = p.get('k') || '';
    if (!u && !k) return;
    if (/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(u) && k.length >= 8) {
      CFG.url = u; CFG.clave = k; CFG.desde = 0; persistir();
      setTimeout(() => aviso('Google Sheets configurado ✓'), 400);
    }
    history.replaceState(null, '', location.pathname + location.search);
  } catch {}
}

/* ───────── Arranque ───────── */
function iniciar() {
  cargar(); configDesdeEnlace(); generarAutomaticos(); persistir(); render();
  if (CFG.pin) pantallaPin('abrir', 'Mi Dinero bloqueado');
  if (CFG.url && CFG.clave) sync(false);
  avisarVencimientos();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
iniciar();
if (/[?&]debug\b/.test(location.search)) window.__MD = { get DB() { return DB; }, get CFG() { return CFG; }, resumen, saldoCuenta, saldoDeuda, sync, recordatorios, hoy };
})();
