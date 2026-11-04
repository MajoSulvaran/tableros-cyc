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
  const casa = '../?app=' + encodeURIComponent(APP || '');

  // Sin sesión o sin permiso: de regreso a la casa
  if (!ses || !ses.token || !rol) {
    try { (window.top || window).location.href = new URL(casa, location.href).href; } catch (e) { location.href = casa; }
    document.documentElement.innerHTML = '<body style="font-family:sans-serif;padding:40px;color:#565b85">Entrando a Tableros CyC…</body>';
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
    window.TABLERO_CONFIG = { urlDatos: 'gh:reporte/datos', urlGuardar: 'gh:reporte/guardar', puedeEditar: rol === 'editar' };
  }
  // ---------- Evaluación de esquemas ----------
  const RUTA_EVAL = 'evaluacion-esquemas/datos.json';
  if (APP === 'evaluacion') {
    window.EVAL_CONFIG = { urlDatos: 'gh:evaluacion/datos', urlGuardar: 'gh:evaluacion/guardar' };
  }

  const fetchOriginal = window.fetch.bind(window);
  window.fetch = async function (url, opts) {
    const u = typeof url === 'string' ? url : (url && url.url) || '';
    if (!u.startsWith('gh:')) return fetchOriginal(url, opts);
    opts = opts || {};
    try {
      if (u === 'gh:reporte/datos') {
        const t = await G.texto(REPO, RUTA_REPORTE);
        return t === null ? resp(404) : new Response(t, { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (u === 'gh:reporte/guardar') {
        if (rol !== 'editar') return resp(403, { error: 'Sin permiso para actualizar' });
        const D = JSON.parse(opts.body);
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
      caja.innerHTML = `<b>Archivos guardados en Tableros CyC</b> · cierre <input type="month" value="${mesElegido}" style="font:inherit;font-size:12px"> <span style="color:#565b85">cargando…</span>`;
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

  // ---------- botón de regreso a la casa ----------
  function botonCasa() {
    if (window.top !== window) return;   // dentro de la casa ya hay barra
    const a = document.createElement('a');
    a.href = '../'; a.textContent = '← Tableros CyC';
    a.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:9999;background:#0003aa;color:#fff;font:600 12px Outfit,Segoe UI,sans-serif;padding:7px 12px;border-radius:20px;text-decoration:none;box-shadow:0 4px 14px rgba(0,3,170,.3)';
    document.body.appendChild(a);
  }
  document.addEventListener('DOMContentLoaded', () => {
    botonCasa();
    if (APP === 'reporte' && rol === 'editar') {
      const b = document.getElementById('btnActualizar');
      if (b) b.addEventListener('click', () => setTimeout(panelArchivos, 50));
    }
  });
  window.PUENTE = { APP, rol, persona };
})();
