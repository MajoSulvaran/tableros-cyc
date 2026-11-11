/* =====================================================================
   CIMBRA · módulo común
   Sesión única, permisos por app y acceso a los repositorios privados
   de datos en GitHub. Lo usan la casa (index.html) y el puente de las
   apps que viven aquí (puente.js).
   ===================================================================== */
(function () {
  'use strict';
  const CFG = {
    OWNER: 'MajoSulvaran',
    REPO_DATOS: 'tableros-cyc-datos',          // privado: directorio, Reporte, Evaluación, archivos
    BRANCH: 'main',
    SESION: 'tableros_cyc_sesion_v1',          // { nombre, token }
    PERMISOS: 'tableros_cyc_permisos_v1',      // { persona, apps:{id:rol}, admin }
    // Sesiones de las apps que viven en sus propios repositorios (inicio de sesión único)
    SESION_PIPELINE: 'pipeline_construccion_acceso',      // { iniciales, token }
    SESION_PRESUPUESTO: 'presupuesto2027_sesion_v1'       // { user, token }
  };

  // Catálogo de apps. Lo editable (estado, ruta a Datacreto, descripción) vive en directorio.json
  const APPS = [
    { id: 'pipeline', nombre: 'Pipeline', area: 'Infraestructura · CN · Soluciones', icono: 'pipeline',
      desc: 'Obras, licitaciones, mensualizado y presupuesto 2027', url: '/pipeline-construccion/', repo: 'pipeline-datos', ruta: 'data.json',
      estado: 'En uso', datacreto: 'Por enviar' },
    { id: 'reporte', nombre: 'Reporte Infraestructura', area: 'Infraestructura Pesada', icono: 'reporte',
      desc: 'Resultados del mes, Best Estimate, capital de trabajo y Ppto. 2027', url: 'reporte-construccion/', repo: CFG.REPO_DATOS, ruta: 'reporte-construccion', privado: 'reporte-construccion/reporte.html',
      estado: 'En uso', datacreto: 'Entregado a Alan' },
    { id: 'soluciones', nombre: 'Reporte Soluciones', area: 'Soluciones Integrales', icono: 'soluciones',
      desc: 'Colocación, Best Estimate, precios, capital de trabajo y Ppto. 2027', url: 'reporte-soluciones/', repo: CFG.REPO_DATOS, ruta: 'reporte-soluciones', privado: 'reporte-soluciones/reporte.html',
      estado: 'En construcción', datacreto: 'Por enviar' },
    { id: 'presupuesto', nombre: 'Ppto. 2027 · Soluciones', area: 'Soluciones Integrales', icono: 'presupuesto',
      desc: 'Ppto 2027 por región, proyectos ancla y objetivos por plaza', url: '/presupuesto-2027/', repo: 'presupuesto-2027-datos', ruta: 'presupuesto.json',
      estado: 'En uso', datacreto: 'Por enviar' },
    { id: 'flota', nombre: 'Mapeo de flota', area: 'Construcción', icono: 'flota',
      desc: 'Equipos por tipo, demanda del pipeline y propuesta de desincorporación', url: 'mapeo-flota/', repo: CFG.REPO_DATOS, ruta: 'mapeo-flota', privado: 'mapeo-flota/reporte.html',
      estado: 'En uso', datacreto: 'Por enviar' }
  ];
  const PROXIMAS = [
    { id: 'pec', nombre: 'PEC 2027', area: 'Construcción', desc: 'Plan de Estrategia de Construcción', estado: 'En construcción', datacreto: 'Con Alan' },
    { id: 'bitacora', nombre: 'Bitácora de obra', area: 'Construcción', desc: 'Control de proyecto y avances por obra', estado: 'En construcción', datacreto: '' },
    { id: 'iniciativas', nombre: 'Iniciativas Tecnológicas e IA', area: 'Estrategia 2027', desc: 'Log de iniciativas por dirección', estado: 'En construcción', datacreto: '' },
    { id: 'acuerdos', nombre: 'Seguimiento de acuerdos', area: 'Planeación', desc: 'Acuerdos accionables y precios de apoyo', estado: 'En construcción', datacreto: '' }
  ];

  // ---------- almacenamiento ----------
  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || sessionStorage.getItem(k) || 'null'); } catch (e) { return null; } },
    set(k, v, recordar) {
      try { localStorage.removeItem(k); sessionStorage.removeItem(k); (recordar === false ? sessionStorage : localStorage).setItem(k, JSON.stringify(v)); } catch (e) { /* sin acción */ }
    },
    del(k) { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch (e) { /* sin acción */ } }
  };

  // ---------- GitHub ----------
  function b64encodeBytes(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  const b64encode = txt => b64encodeBytes(new TextEncoder().encode(txt));
  function b64decodeBytes(b64) {
    const bin = atob(String(b64 || '').replace(/\s/g, ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const realFetch = window.fetch.bind(window);

  function gh(token) {
    const H = extra => Object.assign({ Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, extra || {});
    const base = repo => `https://api.github.com/repos/${CFG.OWNER}/${repo}`;
    const cpath = p => p.split('/').map(encodeURIComponent).join('/');
    const err = (r, what) => { const e = new Error(`GitHub ${r.status} · ${what}`); e.status = r.status; return e; };
    return {
      async meta(repo, path) {        // { sha } o null si no existe
        const r = await realFetch(`${base(repo)}/contents/${cpath(path)}?ref=${CFG.BRANCH}`, { headers: H(), cache: 'no-store' });
        if (r.status === 404) return null;
        if (!r.ok) throw err(r, path);
        return r.json();
      },
      async texto(repo, path) {       // contenido en texto (sin límite de 1 MB) o null
        const r = await realFetch(`${base(repo)}/contents/${cpath(path)}?ref=${CFG.BRANCH}`, { headers: H({ Accept: 'application/vnd.github.raw+json' }), cache: 'no-store' });
        if (r.status === 404) return null;
        if (!r.ok) throw err(r, path);
        return r.text();
      },
      async json(repo, path) { const t = await this.texto(repo, path); return t === null ? null : JSON.parse(t); },
      async bytes(repo, path) {
        const r = await realFetch(`${base(repo)}/contents/${cpath(path)}?ref=${CFG.BRANCH}`, { headers: H({ Accept: 'application/vnd.github.raw+json' }), cache: 'no-store' });
        if (!r.ok) throw err(r, path);
        return new Uint8Array(await r.arrayBuffer());
      },
      async lista(repo, path) {       // contenido de una carpeta ([] si no existe)
        const r = await realFetch(`${base(repo)}/contents/${cpath(path)}?ref=${CFG.BRANCH}`, { headers: H(), cache: 'no-store' });
        if (r.status === 404) return [];
        if (!r.ok) throw err(r, path);
        const j = await r.json();
        return Array.isArray(j) ? j : [];
      },
      // Guarda (crea o reemplaza). contenido: texto o Uint8Array. Reintenta si alguien guardó antes.
      async guardar(repo, path, contenido, mensaje) {
        const b64 = typeof contenido === 'string' ? b64encode(contenido) : b64encodeBytes(contenido);
        for (let i = 0; i < 4; i++) {
          const m = await this.meta(repo, path);
          const body = { message: mensaje, content: b64, branch: CFG.BRANCH };
          if (m && m.sha) body.sha = m.sha;
          const r = await realFetch(`${base(repo)}/contents/${cpath(path)}`, { method: 'PUT', headers: H({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
          if (r.status === 409 || r.status === 422) { await new Promise(res => setTimeout(res, 600 * (i + 1))); continue; }
          if (!r.ok) throw err(r, path);
          return r.json();
        }
        throw new Error('GitHub no aceptó el guardado después de varios intentos');
      },
      // Lee-modifica-guarda un JSON con reintento (para registros que escriben varios a la vez)
      async actualizarJSON(repo, path, fn, mensaje) {
        for (let i = 0; i < 5; i++) {
          const m = await this.meta(repo, path);
          const actual = m ? JSON.parse(await this.texto(repo, path)) : null;
          const nuevo = fn(actual);
          const body = { message: mensaje, content: b64encode(JSON.stringify(nuevo, null, 1)), branch: CFG.BRANCH };
          if (m && m.sha) body.sha = m.sha;
          const r = await realFetch(`${base(repo)}/contents/${cpath(path)}`, { method: 'PUT', headers: H({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
          if (r.status === 409 || r.status === 422) { await new Promise(res => setTimeout(res, 500 * (i + 1))); continue; }
          if (!r.ok) throw err(r, path);
          return nuevo;
        }
        throw new Error('GitHub no aceptó el guardado después de varios intentos');
      },
      async commits(repo, path, n) {
        const q = new URLSearchParams({ sha: CFG.BRANCH, per_page: String(n || 20) });
        if (path) q.set('path', path);
        const r = await realFetch(`${base(repo)}/commits?${q}`, { headers: H(), cache: 'no-store' });
        if (!r.ok) throw err(r, 'commits');
        return r.json();
      },
      async arbol(repo) {
        const r = await realFetch(`${base(repo)}/git/trees/${CFG.BRANCH}?recursive=1`, { headers: H(), cache: 'no-store' });
        if (!r.ok) throw err(r, 'árbol');
        return r.json();
      },
      async blob(repo, sha) {
        const r = await realFetch(`${base(repo)}/git/blobs/${sha}`, { headers: H(), cache: 'no-store' });
        if (!r.ok) throw err(r, 'blob');
        const j = await r.json();
        return b64decodeBytes(j.content);
      },
      async dispara(repo, workflow, inputs) {
        return realFetch(`${base(repo)}/actions/workflows/${workflow}/dispatches`, { method: 'POST', headers: H({ 'Content-Type': 'application/json' }), body: JSON.stringify({ ref: CFG.BRANCH, inputs: inputs || {} }) });
      }
    };
  }

  // ---------- sesión y permisos ----------
  const sesion = () => ls.get(CFG.SESION);
  const permisos = () => ls.get(CFG.PERMISOS);
  function rolEn(app) {
    const p = permisos();
    if (!p) return null;
    // Quien administra ve todo; editar, solo donde se le dio permiso de editar
    return (p.apps || {})[app] || (p.admin ? 'ver' : null);
  }
  function cerrarSesion() {
    [CFG.SESION, CFG.PERMISOS, CFG.SESION_PIPELINE, CFG.SESION_PRESUPUESTO].forEach(ls.del);
  }
  // Escribe las sesiones de las apps a las que la persona tiene acceso (mismo dominio github.io)
  function sesionesApps(persona, token) {
    const ok = a => persona.admin || (persona.apps || {})[a];
    if (ok('pipeline') && persona.ini) ls.set(CFG.SESION_PIPELINE, { iniciales: persona.ini, token });
    else ls.del(CFG.SESION_PIPELINE);
    if (ok('presupuesto') && persona.presupuesto) ls.set(CFG.SESION_PRESUPUESTO, { user: persona.presupuesto, token });
    else ls.del(CFG.SESION_PRESUPUESTO);
  }

  window.TABLEROS = { CFG, APPS, PROXIMAS, ls, gh, sesion, permisos, rolEn, cerrarSesion, sesionesApps, b64encodeBytes, b64decodeBytes, realFetch };
})();
