/* =====================================================================
   PUENTE · Tableros CyC
   El Reporte Construcción y la Evaluación de esquemas ya esperan que
   Datacreto les dé una dirección para leer y otra para guardar. Aquí esas
   direcciones apuntan al repositorio privado de GitHub. Cuando se suban a
   Datacreto basta con quitar las dos líneas <script> de este puente.
   Uso:  <script src="../comun/tableros.js"></script>
         <script src="../comun/puente.js" data-app="reporte"></script>
   ===================================================================== */
(function () {
  'use strict';
  const T = window.TABLEROS;
  const yo = document.currentScript;
  const APP = yo && yo.dataset.app;
  const ses = T.sesion(), per = T.permisos();
  const rol = T.rolEn(APP);
  // Negocios: la primera pestaña es su Pipeline; con solo el permiso del pipeline se entra a esa pestaña
  // Por ahora solo Infraestructura y Cuentas Nacionales llevan su Pipeline (Soluciones todavía no)
  const NEGOCIO = { reporte: 'Infraestructura Pesada', cn: 'Cuentas Nacionales' };
  const rolPipe = T.rolEn('pipeline');
  const soloPipe = !!(NEGOCIO[APP] && !rol && rolPipe);
  const casa = '../?app=' + encodeURIComponent(APP || '');

  // Sin sesión o sin permiso: de regreso a la casa
  if (!ses || !ses.token || (!rol && !soloPipe)) {
    try { (window.top || window).location.href = new URL(casa, location.href).href; } catch (e) { location.href = casa; }
    document.documentElement.innerHTML = '<body style="font-family:sans-serif;padding:40px;color:#565b85">Entrando a NUBE…</body>';
    throw new Error('Sin acceso a ' + APP);
  }
  const G = T.gh(ses.token);
  const REPO = T.CFG.REPO_DATOS;
  const persona = (per && per.persona) || ses.nombre || 'Alguien';
  const corto = persona.split(' ').slice(0, 2).join(' ');

  // ---------- respuestas tipo fetch ----------
  const resp = (status, obj) => new Response(obj === undefined ? '' : JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

  // ---------- Reporte Construcción ----------
  const RUTA_REPORTE = 'reporte-construccion/datos_tablero.json';
  if (APP === 'reporte') {
    // El Reporte vive completo (código y datos) en reporte-construccion/reporte.html; el botón Actualizar
    // reescribe sus datos y lo guarda con guardarReporteHTML
    window.TABLERO_CONFIG = { puedeEditar: rol === 'editar' };
  }
  async function guardarReporteHTML(html, D) {
    if (rol !== 'editar') throw new Error('Sin permiso para actualizar');
    const ruta = 'reporte-construccion/reporte.html';
    const m = await G.meta(REPO, ruta);
    if (m && window.__SHA_REPORTE && m.sha !== window.__SHA_REPORTE) {
      alert('Otra persona actualizó el Reporte mientras lo revisabas. Recarga la página y vuelve a cargar tus archivos para no borrar su actualización.');
      throw new Error('Versión desactualizada');
    }
    const ver = ((D && D.VERS) || []).slice(-1)[0];
    await G.guardar(REPO, ruta, html, `${corto}: actualizó el Reporte Construcción${ver && ver.l ? ' · ' + ver.l : ''}`);
    await guardarArchivosPendientes();
  }
  // ---------- Evaluación de esquemas ----------
  const RUTA_EVAL = 'evaluacion-esquemas/datos.json';
  if (APP === 'evaluacion') {
    window.EVAL_CONFIG = { urlDatos: 'gh:evaluacion/datos', urlGuardar: 'gh:evaluacion/guardar' };
  }

  let shaLeido = null;
  const fetchOriginal = window.fetch.bind(window);
  window.fetch = async function (url, opts) {
    const u = typeof url === 'string' ? url : (url && url.url) || '';
    if (!u.startsWith('gh:')) return fetchOriginal(url, opts);
    opts = opts || {};
    try {
      if (u === 'gh:reporte/datos') {
        const m = await G.meta(REPO, RUTA_REPORTE); shaLeido = m && m.sha;
        const t = await G.texto(REPO, RUTA_REPORTE);
        return t === null ? resp(404) : new Response(t, { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (u === 'gh:reporte/guardar') {
        if (rol !== 'editar') return resp(403, { error: 'Sin permiso para actualizar' });
        const D = JSON.parse(opts.body);
        // Si alguien más actualizó el reporte mientras tanto, no se pisa su versión
        const m = await G.meta(REPO, RUTA_REPORTE);
        if (m && shaLeido && m.sha !== shaLeido) { alert('Otra persona actualizó el Reporte mientras lo revisabas. Recarga la página y vuelve a cargar tus archivos para no borrar su actualización.'); return resp(409, { error: 'Versión desactualizada' }); }
        const ver = (D.VERS || []).slice(-1)[0];
        await G.guardar(REPO, RUTA_REPORTE, JSON.stringify(D), `${corto}: actualizó el Reporte Construcción${ver && ver.l ? ' · ' + ver.l : ''}`);
        await guardarArchivosPendientes();
        return resp(200, { ok: true });
      }
      if (u === 'gh:evaluacion/datos') {
        const d = await G.json(REPO, RUTA_EVAL);
        return resp(200, d || { config: null, evaluaciones: {} });
      }
      if (u === 'gh:evaluacion/guardar') {
        const { tipo, clave, datos } = JSON.parse(opts.body);
        await G.actualizarJSON(REPO, RUTA_EVAL, actual => {
          const d = actual || { config: null, evaluaciones: {} };
          d.evaluaciones = d.evaluaciones || {};
          if (tipo === 'config') d.config = datos; else d.evaluaciones[clave] = datos;
          return d;
        }, tipo === 'config' ? `${corto}: cambió la matriz o los pesos de la Evaluación` : `${clave}: guardó su evaluación`);
        return resp(200, { ok: true });
      }
      return resp(404);
    } catch (e) {
      console.warn('Puente:', e);
      return resp(e.status || 503, { error: e.message });
    }
  };

  // ---------- Archivos del mes (Reporte) ----------
  const CARPETA = 'archivos/reporte-construccion';
  const TIPOS = [{ k: 'consolidado', input: 'actCons', et: 'Consolidado EBITDA' }, { k: 'capital', input: 'actWc', et: 'Base de capital de trabajo' }];
  const mesAnterior = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); };
  const usados = {};          // input → archivo que vino del repositorio (no se vuelve a subir)
  let mesElegido = mesAnterior();

  async function guardarArchivosPendientes() {
    for (const t of TIPOS) {
      const inp = document.getElementById(t.input);
      const f = inp && inp.files && inp.files[0];
      if (!f || usados[t.input] === f) continue;
      const bytes = new Uint8Array(await f.arrayBuffer());
      await G.guardar(REPO, `${CARPETA}/${mesElegido}/${t.k}__${f.name}`, bytes, `${corto}: subió ${t.et} del cierre ${mesElegido}`);
    }
  }

  function panelArchivos() {
    const fondo = document.getElementById('actFondo');
    const cons = document.getElementById('actCons');
    if (!fondo || !cons || document.getElementById('puenteArchivos')) return;
    const caja = document.createElement('div');
    caja.id = 'puenteArchivos';
    caja.style.cssText = 'margin:0 0 12px;padding:10px 12px;border:1px solid #d9dcf7;border-radius:8px;background:#f6f7ff;font-size:12.5px;color:#14173d';
    const ref = cons.closest('.act-archivo') || cons.parentElement;
    ref.parentElement.insertBefore(caja, ref);
    const pinta = async () => {
      caja.innerHTML = `<b>Archivos guardados en NUBE</b> · cierre <input type="month" value="${mesElegido}" style="font:inherit;font-size:12px"> <span style="color:#565b85">cargando…</span>`;
      caja.querySelector('input').onchange = e => { mesElegido = e.target.value || mesAnterior(); pinta(); };
      try {
        const lista = await G.lista(REPO, `${CARPETA}/${mesElegido}`);
        const html = TIPOS.map(t => {
          const f = lista.filter(x => x.name.startsWith(t.k + '__')).sort((a, b) => b.name.localeCompare(a.name))[0];
          return f ? `<div style="margin-top:6px">${t.et}: <b>${f.name.replace(t.k + '__', '')}</b> <button type="button" data-usa="${t.input}" data-ruta="${f.path}" data-nombre="${f.name.replace(t.k + '__', '')}" style="font:inherit;font-size:12px;margin-left:6px;cursor:pointer">Usar este</button></div>`
            : `<div style="margin-top:6px;color:#8a4b07">${t.et}: no se ha subido para ${mesElegido}. Si lo eliges abajo, se guarda aquí al actualizar.</div>`;
        }).join('');
        caja.querySelector('span').outerHTML = html;
        caja.querySelectorAll('[data-usa]').forEach(b => b.onclick = async () => {
          b.disabled = true; b.textContent = 'Descargando…';
          const bytes = await G.bytes(REPO, b.dataset.ruta);
          const file = new File([bytes], b.dataset.nombre, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
          const inp = document.getElementById(b.dataset.usa);
          const dt = new DataTransfer(); dt.items.add(file); inp.files = dt.files;
          usados[b.dataset.usa] = file;
          inp.dispatchEvent(new Event('change', { bubbles: true }));
          b.textContent = 'Listo ✓';
        });
      } catch (e) { caja.querySelector('span').textContent = 'No se pudo consultar: ' + e.message; }
    };
    pinta();
  }

  // ---------- Pestaña Ppto. 2027 (Reporte Construcción y Reporte de Soluciones) ----------
  const MES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const nf = (v, d) => (v === null || v === undefined || !isFinite(v)) ? '—' : v.toLocaleString('es-MX', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
  const escH = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const CSS_PPTO = `#view-ppto27{font-family:inherit}#view-ppto27 .pp-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:6px 0 14px}
    #view-ppto27 .pp-k{background:#fff;border:1px solid #e2e4f2;border-radius:10px;padding:10px 12px}#view-ppto27 .pp-k span{display:block;font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;color:#8a8fb0;font-weight:600}
    #view-ppto27 .pp-k b{font-size:20px;color:#0003aa}#view-ppto27 .pp-k small{display:block;font-size:11px;color:#565b85}
    #view-ppto27 .pp-card{background:#fff;border:1px solid #e2e4f2;border-radius:10px;padding:10px 12px;margin-bottom:12px;overflow:auto}
    #view-ppto27 h3{font-size:14px;margin:0 0 8px;color:#14173d}#view-ppto27 table{border-collapse:collapse;width:100%;font-size:12px;font-variant-numeric:tabular-nums}
    #view-ppto27 th{background:#0003aa;color:#fff;font-size:10.5px;padding:6px 8px;text-align:right;white-space:nowrap}#view-ppto27 th:first-child{text-align:left}
    #view-ppto27 td{padding:5px 8px;border-bottom:1px solid #f0f1f8;text-align:right;white-space:nowrap}#view-ppto27 td:first-child{text-align:left;max-width:260px;overflow:hidden;text-overflow:ellipsis}
    #view-ppto27 tr.tot td{font-weight:700;background:#f4f5fd}#view-ppto27 .pp-seg{display:inline-flex;gap:4px;margin-bottom:8px}
    #view-ppto27 .pp-seg button{font:inherit;font-size:12px;border:1px solid #cdd0ea;background:#fff;border-radius:7px;padding:4px 10px;cursor:pointer}#view-ppto27 .pp-seg button.on{background:#0003aa;color:#fff;border-color:#0003aa}
    #view-ppto27 .pp-nota{font-size:11.5px;color:#8a8fb0;margin:4px 0 10px}`;
  function barrasSVG(vals, linea, etqs) {
    const W = 760, H = 210, P = { l: 46, r: 10, t: 16, b: 24 }, mx = Math.max(1, ...vals.map(v => Math.abs(v || 0)), ...(linea || []).map(v => Math.abs(v || 0)));
    const x = i => P.l + (W - P.l - P.r) * (i + .5) / 12, y = v => P.t + (1 - (v || 0) / mx) * (H - P.t - P.b), bw = (W - P.l - P.r) / 12 * .6;
    let s = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">`;
    vals.forEach((v, i) => { s += `<rect x="${x(i) - bw / 2}" y="${Math.min(y(v), y(0))}" width="${bw}" height="${Math.abs(y(0) - y(v))}" rx="3" fill="#0003aa"><title>${MES[i]}: ${nf(v, 1)}</title></rect><text x="${x(i)}" y="${y(v) - 4}" font-size="10" text-anchor="middle" fill="#14173d">${nf(v, 0)}</text><text x="${x(i)}" y="${H - 6}" font-size="10" text-anchor="middle" fill="#565b85">${MES[i]}</text>`; });
    if (linea) s += `<polyline fill="none" stroke="#f22230" stroke-width="2.5" points="${linea.map((v, i) => `${x(i)},${y(v)}`).join(' ')}"/>` + linea.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="#f22230"><title>${MES[i]}: ${nf(v, 1)}</title></circle>`).join('');
    return s + `</svg><div class="pp-nota">${etqs || ''}</div>`;
  }
  async function datosPptoConstruccion() {
    const d = await G.json('pipeline-datos', 'data.json');
    const p = d && d.presupuestos && d.presupuestos['2027'];
    if (!p) throw new Error('Todavía no se carga el presupuesto 2027 en el pipeline (botón "Presupuesto 27").');
    return p;
  }
  function pintaPptoConstruccion(box, p) {
    const T = p.totales || {}, filas = p.filas || [];
    const mes = k => Array.from({ length: 12 }, (_, i) => filas.reduce((a, f) => a + (((f.meses || {})[k] || [])[i] || 0), 0));
    let met = 'venta';
    const pinta = () => {
      const lista = filas.slice().sort((a, b) => (b[met] || 0) - (a[met] || 0));
      const u = met === 'volumen' ? 'K m³' : 'M MXN', dec = 1;
      box.querySelector('[data-pp-tabla]').innerHTML = `<table><thead><tr><th>Proyecto (${u})</th>${MES.map(m => `<th>${m}</th>`).join('')}<th>Total</th></tr></thead><tbody>
        ${lista.map(f => `<tr><td title="${escH(f.nombre)}">${escH(f.nombre)}</td>${((f.meses || {})[met] || Array(12).fill(0)).map(v => `<td>${nf(v, dec)}</td>`).join('')}<td><b>${nf(f[met], dec)}</b></td></tr>`).join('')}
        <tr class="tot"><td>Total proyectos</td>${mes(met).map(v => `<td>${nf(v, dec)}</td>`).join('')}<td>${nf(filas.reduce((a, f) => a + (f[met] || 0), 0), dec)}</td></tr></tbody></table>`;
      box.querySelectorAll('[data-pp-met]').forEach(b => b.classList.toggle('on', b.dataset.ppMet === met));
    };
    const mg = T.venta ? (T.ebitda_proyectos / T.venta * 100) : null;
    box.innerHTML = `<style>${CSS_PPTO}</style>
      <div class="pp-kpis"><div class="pp-k"><span>Venta 2027</span><b>$${nf(T.venta, 1)} M</b><small>${filas.length} proyectos</small></div>
        <div class="pp-k"><span>EBITDA de proyectos</span><b>$${nf(T.ebitda_proyectos, 1)} M</b><small>Margen ${nf(mg, 1)}%</small></div>
        ${T.ebitda_total !== undefined ? `<div class="pp-k"><span>EBITDA tras OPEX y Taller</span><b>$${nf(T.ebitda_total, 1)} M</b><small>Después de gastos centrales</small></div>` : ''}
        <div class="pp-k"><span>Volumen</span><b>${nf(T.volumen, 1)} K m³</b><small>Concreto presupuestado</small></div></div>
      <div class="pp-card"><h3>Venta y EBITDA mensual · M MXN</h3>${barrasSVG(mes('venta'), mes('ebitda'), 'Barras: venta · línea roja: EBITDA')}</div>
      <div class="pp-card"><div class="pp-seg">${[['venta', 'Venta'], ['ebitda', 'EBITDA'], ['volumen', 'Volumen']].map(([k, t]) => `<button type="button" data-pp-met="${k}">${t}</button>`).join('')}</div><div data-pp-tabla></div></div>
      <div class="pp-nota">Fuente: presupuesto 2027 cargado en el pipeline (${escH(p.archivo || '')}${p.cargado ? ', ' + new Date(p.cargado).toLocaleDateString('es-MX') : ''}). Cifras en M MXN.</div>`;
    box.querySelectorAll('[data-pp-met]').forEach(b => b.onclick = () => { met = b.dataset.ppMet; pinta(); });
    pinta();
  }
  async function datosPptoSoluciones() {
    const [st, ref] = await Promise.all([G.json('presupuesto-2027-datos', 'presupuesto.json'), G.json('presupuesto-2027-datos', 'referencia.json')]);
    if (!st) throw new Error('No se encontró la captura del Presupuesto 2027.');
    return { st, ref: ref || {} };
  }
  function pintaPptoSoluciones(box, { st, ref }) {
    const REG = [['cs', 'Centro Sur'], ['nb', 'Norte - Bajío'], ['pa', 'Pacífico']];
    const TREND = [0.066717, 0.069738, 0.072759, 0.075780, 0.078802, 0.081823, 0.084844, 0.087865, 0.090886, 0.093908, 0.096929, 0.099949];
    const meses26 = (ref.histMonths && +ref.histMonths[2026]) || 9;
    const precioRef = r => {
      const h = ((st.hist || {})[2026] || {})[r] || {}; const ov = ((ref.estOverride || {})[2026] || {})[r] || {};
      const vol = typeof ov.vol === 'number' ? ov.vol : (h.vol || 0) * 12 / meses26, ing = typeof ov.ing === 'number' ? ov.ing : (h.ing || 0) * 12 / meses26;
      return vol ? ing / vol : null;
    };
    const reg = REG.map(([id, n]) => { const b = (st.budget || {})[id] || {}; const pr = b.price ?? precioRef(id); const ing = (b.vol != null && pr != null) ? b.vol * pr : null;
      return { id, n, vol: b.vol, ing, ebitda: b.ebitda, mg: ing ? b.ebitda / ing * 100 : null }; });
    const nat = reg.reduce((a, r) => ({ vol: a.vol + (r.vol || 0), ing: a.ing + (r.ing || 0), ebitda: a.ebitda + (r.ebitda || 0) }), { vol: 0, ing: 0, ebitda: 0 });
    const pipe = REG.map(([id, n]) => { const l = ((st.pipeline || {})[id] || []).filter(x => x.estatus !== 'perdido'); return { n, k: l.length, vol: l.reduce((a, x) => a + (x.volCx || 0), 0), venta: l.reduce((a, x) => a + (x.venta || 0), 0) }; });
    const M = v => v == null ? '—' : '$' + nf(v / 1e6, 1) + ' M';
    box.innerHTML = `<style>${CSS_PPTO}</style>
      <div class="pp-kpis"><div class="pp-k"><span>Volumen 2027</span><b>${nf(nat.vol)} m³</b></div><div class="pp-k"><span>Ingreso 2027</span><b>${M(nat.ing)}</b></div>
        <div class="pp-k"><span>EBITDA 2027</span><b>${M(nat.ebitda)}</b><small>Margen ${nf(nat.ing ? nat.ebitda / nat.ing * 100 : null, 1)}%</small></div></div>
      <div class="pp-card"><h3>Por región</h3><table><thead><tr><th>Región</th><th>Volumen m³</th><th>Ingreso</th><th>EBITDA</th><th>Margen</th></tr></thead><tbody>
        ${reg.map(r => `<tr><td>${r.n}</td><td>${nf(r.vol)}</td><td>${M(r.ing)}</td><td>${M(r.ebitda)}</td><td>${nf(r.mg, 1)}%</td></tr>`).join('')}
        <tr class="tot"><td>Nacional</td><td>${nf(nat.vol)}</td><td>${M(nat.ing)}</td><td>${M(nat.ebitda)}</td><td>${nf(nat.ing ? nat.ebitda / nat.ing * 100 : null, 1)}%</td></tr></tbody></table></div>
      <div class="pp-card"><h3>Mensualizado nacional · M MXN (perfil de tendencia del Presupuesto 2027)</h3>${barrasSVG(TREND.map(p => nat.ing * p / 1e6), TREND.map(p => nat.ebitda * p / 1e6), 'Barras: ingreso · línea roja: EBITDA')}
        <table><thead><tr><th>Concepto</th>${MES.map(m => `<th>${m}</th>`).join('')}<th>Total</th></tr></thead><tbody>
        <tr><td>Volumen m³</td>${TREND.map(p => `<td>${nf(nat.vol * p)}</td>`).join('')}<td><b>${nf(nat.vol)}</b></td></tr>
        <tr><td>Ingreso M MXN</td>${TREND.map(p => `<td>${nf(nat.ing * p / 1e6, 1)}</td>`).join('')}<td><b>${nf(nat.ing / 1e6, 1)}</b></td></tr>
        <tr><td>EBITDA M MXN</td>${TREND.map(p => `<td>${nf(nat.ebitda * p / 1e6, 1)}</td>`).join('')}<td><b>${nf(nat.ebitda / 1e6, 1)}</b></td></tr></tbody></table></div>
      <div class="pp-card"><h3>Proyectos ancla del presupuesto</h3><table><thead><tr><th>Región</th><th>Proyectos</th><th>Vol. CEMEX K m³</th><th>Venta M MXN</th></tr></thead><tbody>
        ${pipe.map(r => `<tr><td>${r.n}</td><td>${r.k}</td><td>${nf(r.vol, 1)}</td><td>${nf(r.venta, 1)}</td></tr>`).join('')}</tbody></table></div>
      <div class="pp-nota">Fuente: Presupuesto 2027 de Soluciones Integrales${st.savedAt ? ', guardado el ' + new Date(st.savedAt).toLocaleDateString('es-MX') + (st.savedBy ? ' por ' + escH(st.savedBy) : '') : ''}. El ingreso se calcula como volumen × precio, igual que en la herramienta.</div>`;
  }
  function pestanaPpto() {
    const nav = document.querySelector('.switcher');
    if (!nav || document.getElementById('view-ppto27')) return !!nav;
    const otros = [...nav.querySelectorAll('button')];
    const attr = otros[0] && otros[0].hasAttribute('data-tab') ? 'data-tab' : 'data-view';
    const btn = document.createElement('button'); btn.type = 'button'; btn.setAttribute(attr, 'ppto27'); btn.textContent = 'Ppto. 2027';
    nav.appendChild(btn);
    const vistas = [...document.querySelectorAll('[id^="view-"]')].filter(v => v.id !== 'view-ppto27' && v.parentElement === document.querySelector('[id^="view-"]').parentElement);
    const ultimo = vistas[vistas.length - 1];
    const box = document.createElement('div'); box.id = 'view-ppto27'; box.style.display = 'none';
    box.innerHTML = '<p style="padding:20px;color:#565b85">Cargando presupuesto 2027…</p>';
    ultimo.parentElement.insertBefore(box, ultimo.nextSibling);
    let cargado = false;
    btn.addEventListener('click', async () => {
      otros.forEach(b => b.classList.remove('active')); btn.classList.add('active');
      vistas.forEach(v => { v.style.display = 'none'; }); box.style.display = '';
      if (cargado) return; cargado = true;
      try {
        if (APP === 'reporte') pintaPptoConstruccion(box, await datosPptoConstruccion());
        else {
          box.innerHTML = `<iframe title="Ppto. 2027 · Soluciones" src="${location.origin}/presupuesto-2027/?embebido=1" style="width:100%;border:0;display:block;background:#fff"></iframe>`;
          const f = box.querySelector('iframe'), alto = () => { f.style.height = Math.max(480, window.innerHeight - box.getBoundingClientRect().top - 4) + 'px'; };
          alto(); window.addEventListener('resize', alto);
        }
      } catch (e) { cargado = false; box.innerHTML = `<p style="padding:20px;color:#8a4b07">${escH(e.message)}</p>`; }
    });
    otros.forEach(b => b.addEventListener('click', () => { box.style.display = 'none'; btn.classList.remove('active'); }));
    return true;
  }


  // ---------- Encabezado único (estilo Ppto 2027) y limpieza visual por tablero ----------
  const ENC = {
    reporte: { t: 'Infraestructura', s: 'Infraestructura Pesada', antes: '.topbar',
      css: '.topbar .crumb,#pageTitle{display:none!important}.topbar{padding-top:0!important}.switcher button[data-view="venta"]{display:none!important}'
        + '.tabrow{flex-wrap:nowrap!important;gap:8px!important;align-items:center!important}.tabrow .switcher{flex:1 1 auto;min-width:0}'
        + '.tabrow .switcher button{padding:9px 11px 8px!important}.tabrow #btnPrint{margin:0!important;padding:3px 8px!important;flex:none}.tabrow #btnActualizar{flex:none;margin-left:4px}'
        + '#pageSub:empty{display:none!important}.topbar p{padding:3px 0 5px!important;min-height:0!important}.extra-on #pageSub{display:none!important}' },
    soluciones: { t: 'Soluciones Integrales', s: 'Reporte de resultados', antes: '.switcher',
      css: `header.hero{display:none!important}
        .switcher{background:#fff!important;box-shadow:0 1px 0 #e2e4f2!important;padding:0 16px!important;gap:2px!important}
        .switcher button{flex:none!important;font-size:.85rem!important;font-weight:600!important;padding:10px 14px 8px!important;border-radius:0!important;
          background:none!important;border:0!important;border-bottom:3px solid transparent!important;color:#565b85!important}
        .switcher button:hover{color:#1414B8!important}
        .switcher button.active{color:#1414B8!important;border-bottom-color:#f22230!important;background:none!important}` },
    cn: { t: 'Cuentas Nacionales', s: 'Reporte de resultados', antes: '.switcher', css: '.fantasma{display:none!important}.vistas{padding-top:6px!important}' },
    flota: { t: 'Mapeo de flota', s: 'Construcción · Planeación', antes: 'header.top', css: 'header.top .hid{display:none!important}header.top{padding-top:4px!important;padding-bottom:0!important}.find .fd{display:none!important}nav.tabs{scrollbar-width:none}nav.tabs::-webkit-scrollbar{display:none}' }
  };
  function encabezado() {
    const e = ENC[APP]; if (!e || document.getElementById('cycHdr')) return;
    const st = document.createElement('style');
    // Encabezado delgado: título y subtítulo en un renglón, para dejar el espacio al contenido
    st.textContent = `#cycHdr{background:#1414B8;border-bottom:3px solid #f22230;color:#fff;display:flex;align-items:center;gap:10px;padding:5px 18px;font-family:Outfit,'Segoe UI',sans-serif}
      #cycHdr .m{display:inline-flex;flex-direction:column;gap:3px}#cycHdr .m i{display:block;height:3px;border-radius:2px;background:#fff;width:22px}
      #cycHdr .m i:nth-child(1){width:19px;background:#f22230}#cycHdr .m i:nth-child(3){width:15px;background:#a9acf2}
      #cycHdr div{display:flex;align-items:baseline;gap:10px}#cycHdr b{font-size:16px;font-weight:600;line-height:1.2}#cycHdr small{font-size:11px;color:#d2d2f7}
      .switcher button{padding-top:6px!important;padding-bottom:5px!important;font-size:.82rem!important}` + e.css;
    document.head.appendChild(st);
    const h = document.createElement('div'); h.id = 'cycHdr';
    h.innerHTML = `<span class="m" aria-hidden="true"><i></i><i></i><i></i></span><div><b>${e.t}</b><small>${e.s}</small></div>`;
    const ref = document.querySelector(e.antes);
    if (ref && ref.parentElement) ref.parentElement.insertBefore(h, ref); else document.body.insertBefore(h, document.body.firstChild);
  }


  // ---------- Mapeo de flota: pestaña "Presentación" (la lámina ejecutiva, primero) ----------
  async function presentacionFlota() {
    const nav = document.querySelector('nav.tabs'); if (!nav || document.getElementById('tPres')) return !!nav;
    const tabs = [...nav.querySelectorAll('[role="tab"]')], panels = [...document.querySelectorAll('[role="tabpanel"]')];
    if (!tabs.length || !panels.length) return false;
    // Renumera: la presentación va primero
    tabs.forEach(t => { const ix = t.querySelector('.ix'); if (ix && /^\d+$/.test(ix.textContent.trim())) ix.textContent = String(+ix.textContent + 1); });
    const tab = document.createElement('button');
    tab.className = 'tab'; tab.id = 'tPres'; tab.type = 'button'; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', 'pPres');
    tab.innerHTML = '<span class="ix">1</span>Presentación';
    nav.insertBefore(tab, tabs[0]);
    const panel = document.createElement('section');
    panel.className = 'panel'; panel.id = 'pPres'; panel.setAttribute('role', 'tabpanel'); panel.hidden = true;
    panel.innerHTML = '<p style="padding:30px;color:#565b85">Cargando la presentación…</p>';
    panels[0].parentElement.insertBefore(panel, panels[0]);
    const st = document.createElement('style');
    st.textContent = `#pPres .pres{display:flex;flex-direction:column;align-items:center;gap:10px;padding:10px 0 16px}
      #pPres .pres-main{position:relative;background:#fff;border:1px solid #e2e4f2;border-radius:10px;overflow:hidden;box-shadow:0 8px 28px rgba(20,23,61,.12)}
      #pPres .pres-main img{display:block;width:100%;height:100%;object-fit:contain}
      #pPres .pres-flecha{position:absolute;top:50%;transform:translateY(-50%);width:40px;height:40px;border-radius:50%;border:0;background:rgba(20,20,184,.75);color:#fff;font-size:20px;cursor:pointer;opacity:.0;transition:opacity .2s}
      #pPres .pres-main:hover .pres-flecha{opacity:1}#pPres .pres-ant{left:10px}#pPres .pres-sig{right:10px}
      #pPres .pres-bar{display:flex;align-items:center;gap:10px;max-width:100%}
      #pPres .pres-thumbs{display:flex;gap:6px;overflow-x:auto;padding:2px}
      #pPres .pres-thumbs img{height:46px;aspect-ratio:16/9;object-fit:cover;border-radius:5px;border:2px solid transparent;cursor:pointer;opacity:.65;background:#fff}
      #pPres .pres-thumbs img.on{border-color:#f22230;opacity:1}
      #pPres .pres-n{font:600 12px Outfit,sans-serif;color:#565b85;white-space:nowrap}
      #pPres .pres-full{font:600 12px Outfit,sans-serif;border:1px solid #cdd0ea;background:#fff;color:#1414B8;border-radius:7px;padding:5px 10px;cursor:pointer}`;
    document.head.appendChild(st);
    const muestra = () => {
      tabs.concat(tab).forEach(t => t.setAttribute('aria-selected', t === tab ? 'true' : 'false'));
      panels.forEach(p => { p.hidden = true; }); panel.hidden = false; ajusta();
    };
    tab.addEventListener('click', muestra);
    tabs.forEach(t => t.addEventListener('click', () => { panel.hidden = true; tab.setAttribute('aria-selected', 'false'); }));
    let imgs = [], i = 0;
    const ajusta = () => {
      const main = panel.querySelector('.pres-main'); if (!main || panel.hidden) return;
      const disp = window.innerHeight - main.getBoundingClientRect().top - 78, ancho = Math.min(panel.clientWidth - 8, disp * 16 / 9);
      main.style.width = Math.max(320, ancho) + 'px'; main.style.height = Math.max(180, ancho * 9 / 16) + 'px';
    };
    const ir = k => {
      if (!imgs.length) return; i = (k + imgs.length) % imgs.length;
      panel.querySelector('.pres-main img').src = imgs[i];
      panel.querySelectorAll('.pres-thumbs img').forEach((t, j) => t.classList.toggle('on', j === i));
      panel.querySelector('.pres-n').textContent = `${i + 1} / ${imgs.length}`;
    };
    try {
      const html = await G.texto(REPO, 'mapeo-flota/presentacion.html');
      if (!html) { panel.innerHTML = '<p style="padding:30px;color:#565b85">Todavía no se sube la presentación. Súbela desde NUBE con "Nueva presentación".</p>'; }
      else {
        const d = new DOMParser().parseFromString(html, 'text/html');
        imgs = [...d.querySelectorAll('img')].map(x => x.getAttribute('src')).filter(Boolean);
        panel.innerHTML = `<div class="pres"><div class="pres-main"><img alt="Lámina"><button class="pres-flecha pres-ant" title="Anterior">‹</button><button class="pres-flecha pres-sig" title="Siguiente">›</button></div>
          <div class="pres-bar"><span class="pres-n"></span><div class="pres-thumbs">${imgs.map((src, j) => `<img src="${src}" data-j="${j}" alt="Lámina ${j + 1}">`).join('')}</div><button class="pres-full" type="button">Pantalla completa</button></div></div>`;
        panel.querySelector('.pres-ant').onclick = () => ir(i - 1);
        panel.querySelector('.pres-sig').onclick = () => ir(i + 1);
        panel.querySelectorAll('.pres-thumbs img').forEach(t => t.onclick = () => ir(+t.dataset.j));
        panel.querySelector('.pres-full').onclick = () => { const m = panel.querySelector('.pres-main'); (m.requestFullscreen || m.webkitRequestFullscreen || (() => {})).call(m); };
        document.addEventListener('keydown', e => { if (panel.hidden) return; if (e.key === 'ArrowRight') ir(i + 1); if (e.key === 'ArrowLeft') ir(i - 1); });
        window.addEventListener('resize', ajusta);
        ir(0);
      }
    } catch (e) { panel.innerHTML = '<p style="padding:30px;color:#8a4b07">No se pudo cargar la presentación: ' + e.message + '</p>'; }
    muestra();
    return true;
  }


  // ---------- Pestañas que NUBE agrega a un reporte (Pipeline, Chequeo semanal) ----------
  // Un solo control para todas: la activa se muestra y las vistas del reporte se esconden con una clase,
  // sin tocar cómo las maneja el propio reporte.
  const urlPipeline = () => `${location.origin}/pipeline-construccion/?direccion=${encodeURIComponent(NEGOCIO[APP])}&embebido=1`;
  const EXTRAS = [];
  function controlExtras(nav) {
    if (nav.__extras) return; nav.__extras = true;
    if (!document.getElementById('ppOcultoCss')) { const st = document.createElement('style'); st.id = 'ppOcultoCss'; st.textContent = '.pp-oculto{display:none!important}'; document.head.appendChild(st); }
    nav.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const x = EXTRAS.find(z => z.btn === b);
      const vistas = [...document.querySelectorAll('[id^="view-"]')].filter(v => !EXTRAS.some(z => z.box === v));
      EXTRAS.forEach(z => { z.box.style.display = z === x ? 'block' : 'none'; z.btn.classList.toggle('active', z === x); });
      document.body.classList.toggle('extra-on', !!x);
      if (x) { nav.querySelectorAll('button').forEach(o => { if (o !== b) o.classList.remove('active'); }); vistas.forEach(v => v.classList.add('pp-oculto')); x.abrir(); }
      else vistas.forEach(v => v.classList.remove('pp-oculto'));
    });
  }
  function pestanaExtra(id, etiqueta, despuesDe, abrir) {
    const nav = document.querySelector('.switcher');
    if (!nav || document.getElementById('view-' + id)) return !!nav;
    const otros = [...nav.querySelectorAll('button')]; if (!otros.length) return false;
    const attr = otros[0].hasAttribute('data-tab') ? 'data-tab' : 'data-view';
    const btn = document.createElement('button'); btn.type = 'button'; btn.setAttribute(attr, id); btn.textContent = etiqueta;
    const ref = despuesDe && nav.querySelector(`[${attr}="${despuesDe}"]`);
    nav.insertBefore(btn, ref ? ref.nextSibling : otros[0]);
    const primera = [...document.querySelectorAll('[id^="view-"]')].find(v => !EXTRAS.some(z => z.box === v));
    const box = document.createElement('div'); box.id = 'view-' + id; box.style.display = 'none';
    primera.parentElement.insertBefore(box, primera);
    const x = { id, btn, box, abrir: () => abrir(box) };
    EXTRAS.push(x); controlExtras(nav);
    return x;
  }
  const altoMarco = box => { const f = box.querySelector('iframe'); if (f) f.style.height = Math.max(480, window.innerHeight - box.getBoundingClientRect().top - 2) + 'px'; };
  window.addEventListener('resize', () => EXTRAS.forEach(z => { if (z.box.style.display !== 'none') altoMarco(z.box); }));
  function pestanaPipeline() {
    const x = pestanaExtra('pipeline', 'Pipeline', null, box => {
      if (!box.querySelector('iframe')) box.innerHTML = `<iframe title="Pipeline" src="${urlPipeline()}" style="width:100%;border:0;display:block;background:#fff"></iframe>`;
      altoMarco(box);
    });
    if (x && x.btn) x.btn.click();   // el negocio abre en su Pipeline
    return !!x;
  }
  // Chequeo semanal (Infraestructura): el tablero vive en reporte-construccion/chequeo.html y sus datos
  // actualizados en chequeo_datos.json, para que todo el equipo vea la misma versión.
  function pestanaChequeo() {
    const x = pestanaExtra('chequeo', 'Chequeo semanal', 'pipeline', async box => {
      if (box.dataset.listo) { altoMarco(box); return; }
      box.dataset.listo = '1';
      box.innerHTML = '<p style="padding:24px;color:#565b85">Cargando el Chequeo semanal…</p>';
      try {
        const [html, datos] = await Promise.all([G.texto(REPO, 'reporte-construccion/chequeo.html'), G.json(REPO, 'reporte-construccion/chequeo_datos.json').catch(() => null)]);
        if (!html) { box.innerHTML = '<p style="padding:24px;color:#565b85">Todavía no se sube el Chequeo semanal. Súbelo desde NUBE con "Nuevo chequeo semanal".</p>'; return; }
        const url = datos ? URL.createObjectURL(new Blob([JSON.stringify(datos)], { type: 'application/json' })) : null;
        window.__guardarChequeo = txt => {
          if (rol !== 'editar') return;
          G.guardar(REPO, 'reporte-construccion/chequeo_datos.json', txt, `${corto}: actualizó el Chequeo semanal`).catch(e => alert('No se pudo guardar el Chequeo semanal en NUBE: ' + e.message));
        };
        const pre = `<script>window.TABLERO_CONFIG=${JSON.stringify({ urlDatos: url, puedeEditar: rol === 'editar' })};
          (function(){var si=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){si.call(this,k,v);if(this===window.sessionStorage&&k==='chequeo-sesion'&&parent.__guardarChequeo)parent.__guardarChequeo(v);};})();<\/script>
          <style>.cab .marca{display:none!important}.cab{padding-top:6px!important;padding-bottom:6px!important}</style>`;
        const i = html.indexOf('<head>');
        const doc = i >= 0 ? html.slice(0, i + 6) + pre + html.slice(i + 6) : pre + html;
        box.innerHTML = '<iframe title="Chequeo semanal" style="width:100%;border:0;display:block;background:#fff"></iframe>';
        box.querySelector('iframe').srcdoc = doc;
        altoMarco(box);
      } catch (e) { box.dataset.listo = ''; box.innerHTML = '<p style="padding:24px;color:#8a4b07">No se pudo cargar el Chequeo semanal: ' + e.message + '</p>'; }
    });
    return !!x;
  }
  // Sin permiso del reporte: solo el Pipeline del negocio, con su encabezado
  function soloPipeline() {
    document.body.innerHTML = '<nav class="switcher"><button type="button" class="active" data-view="pipeline">Pipeline</button></nav><div id="view-pipeline"></div>';
    document.body.style.cssText = 'margin:0;font-family:Outfit,Segoe UI,sans-serif';
    const st = document.createElement('style');
    st.textContent = '.switcher{display:flex;background:#fff;border-bottom:1px solid #e2e4f2;padding:0 16px}.switcher button{font:600 13.5px Outfit,sans-serif;padding:10px 14px 8px;border:0;background:none;color:#1414B8;border-bottom:3px solid #f22230}';
    document.head.appendChild(st);
    encabezado();
    const box = document.getElementById('view-pipeline');
    box.innerHTML = `<iframe title="Pipeline" src="${urlPipeline()}" style="width:100%;border:0;display:block"></iframe>`;
    const f = box.querySelector('iframe'), alto = () => { f.style.height = (window.innerHeight - box.getBoundingClientRect().top - 2) + 'px'; };
    alto(); window.addEventListener('resize', alto);
  }

  // ---------- botón de regreso a la casa ----------
  function botonCasa() {
    if (window.top !== window) return;   // dentro de la casa ya hay barra
    const a = document.createElement('a');
    a.href = '../'; a.textContent = '← NUBE';
    a.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:9999;background:#0003aa;color:#fff;font:600 12px Outfit,Segoe UI,sans-serif;padding:7px 12px;border-radius:20px;text-decoration:none;box-shadow:0 4px 14px rgba(0,3,170,.3)';
    document.body.appendChild(a);
  }
  // Reporte Infraestructura: en los selectores de versión solo mes y año ("septiembre 2026")
  function versionesLimpias() {
    const limpia = () => document.querySelectorAll('select option').forEach(op => {
      const t = op.textContent, n = t.replace(/^\s*Versi[oó]n\s+/i, '').replace(/\s*[·\-–]\s*preliminar\s*$/i, '');
      if (n !== t) op.textContent = n;
    });
    limpia();
    new MutationObserver(limpia).observe(document.body, { childList: true, subtree: true });
  }
  const TIT_SEG = { 'seg-congruencia': ['Ejerciendo liderazgo', 'Rutinas de seguridad'], 'seg-agenda': ['Agenda de líderes', 'Seguridad · Construcción'] };
  function tituloSeguridad() {
    if (!TIT_SEG[APP]) return;
    const st = document.createElement('style'); st.textContent = '#gPer{overflow-y:auto;overflow-x:hidden}#lPer{flex:none;position:relative;background:#fff;padding-top:6px}.ud{min-height:46px}'; document.head.appendChild(st);
    const st2 = document.createElement('style');
    st2.textContent = '.hdr{padding-top:4px!important;padding-bottom:4px!important;border-bottom-width:3px!important;gap:10px!important}.hdr .ttl{font-size:16px!important}.hdr .sub{font-size:10.5px!important}.hdr .mark{transform:scale(.75)}'
      + '.hdr{flex-wrap:nowrap!important}.hdr .brand{flex:none}.hdr .ttl{white-space:nowrap}.hdr .acts{flex-wrap:nowrap!important;overflow-x:auto;scrollbar-width:none;min-width:0}.hdr .acts .sel{max-width:170px}.hdr .btn{white-space:nowrap}#chips,.chips{flex-wrap:nowrap!important;overflow-x:auto;scrollbar-width:none}.chip{white-space:nowrap}'
      + '.hdr .btn,.hdr .sel,.hdr input{padding-top:3px!important;padding-bottom:3px!important;font-size:12px!important}.tabs .tab,.barra .tab,.vtabs button{padding-top:6px!important;padding-bottom:5px!important;font-size:12.5px!important}';
    document.head.appendChild(st2);
    const t = document.querySelector('.hdr .ttl'), sb = document.querySelector('.hdr .sub');
    if (t) t.textContent = TIT_SEG[APP][0]; if (sb) sb.textContent = TIT_SEG[APP][1];
  }
  function despues() {
    botonCasa();
    try { tituloSeguridad(); } catch (e) { console.warn(e); }
    try { encabezado(); } catch (e) { console.warn(e); }
    if (APP === 'reporte') try { versionesLimpias(); } catch (e) { console.warn(e); }
    if (APP === 'flota') { let n = 0; const t = setInterval(async () => { if (await presentacionFlota() || ++n > 40) clearInterval(t); }, 250); }
    if (APP === 'reporte' && rol === 'editar') {
      const b = document.getElementById('btnActualizar');
      if (b) b.addEventListener('click', () => setTimeout(panelArchivos, 50));
    }
    if (APP === 'reporte' || APP === 'soluciones') { let n = 0; const t = setInterval(() => { if (pestanaPpto() || ++n > 60) clearInterval(t); }, 250); }
    if (APP === 'reporte' && rol) { let n = 0; const t = setInterval(() => { if (pestanaChequeo() || ++n > 60) clearInterval(t); }, 250); }
    if (NEGOCIO[APP] && rolPipe) { let n = 0; const t = setInterval(() => { if (pestanaPipeline() || ++n > 60) clearInterval(t); }, 250); }
  }
  document.addEventListener('DOMContentLoaded', () => {
    despues();
    if (APP === 'reporte' && rol === 'editar') {
      const b = document.getElementById('btnActualizar');
      if (b) b.addEventListener('click', () => setTimeout(panelArchivos, 50));
    }
  });
  window.PUENTE = { APP, rol, persona, despues, G, guardarReporteHTML, soloPipeline: soloPipe ? soloPipeline : null };
})();
