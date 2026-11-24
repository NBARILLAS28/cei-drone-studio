/* CEI Drone Studio — interfaz */
(function () {
  'use strict';
  const C = window.CEI;
  const { geo: G, mission: M, exp: X, exif: E, imp: I, fotos: FT, adapters: AD, zip: Z } = C;

  /* ================= utilidades ================= */
  const $ = (s, el) => (el || document).querySelector(s);
  function h(tag, attrs, ...kids) {
    const el = tag === 'svg' ? document.createElementNS('http://www.w3.org/2000/svg', 'svg') : document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    });
    kids.flat(Infinity).forEach((c) => { if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c)); });
    return el;
  }
  const add = (el, ...kids) => { kids.flat(Infinity).forEach((c) => { if (c != null && c !== false) el.append(c); }); return el; };
  const fmt = (n, d) => (n == null || !isFinite(n) ? '—' : Number(n).toLocaleString('es-GT', { maximumFractionDigits: d == null ? 0 : d, minimumFractionDigits: 0 }));
  const uid = () => Math.random().toString(36).slice(2, 9);
  const MZ = 6987.37; // m² por manzana
  const VARA2 = 0.698737; // m² por vara²

  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('on'), ms || 3200);
  }
  function descargar(name, mime, data) {
    const blob = new Blob([data], { type: mime });
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  /* ================= datos ================= */
  const KEY = 'cei-drone-studio:v1';
  const BASES = {
    esri: { nombre: 'Satélite (Esri)', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attr: 'Imágenes © Esri, Maxar, Earthstar Geographics' },
    osm: { nombre: 'Calles (OpenStreetMap)', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attr: '© OpenStreetMap' },
    none: { nombre: 'Sin mapa base (cuadrícula)', url: null, attr: '' },
  };
  let db = cargar();
  function cargar() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY));
      if (d && d.proyectos) return d;
    } catch (e) { /* vacío */ }
    return { proyectos: [], activo: null, ajustes: { base: 'esri', drone: 'mini4pro', res: '12' }, vuelos: [] };
  }
  function guardar() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { toast('No se pudo guardar en este navegador (almacenamiento lleno).'); }
  }
  function nuevoProyecto(nombre) {
    const p = {
      id: uid(), nombre: nombre || 'Terreno ' + (db.proyectos.length + 1), creado: Date.now(),
      ring: [], despegue: null, fotos: [], mision: Object.assign({}, M.DEFAULTS, { drone: db.ajustes.drone, res: db.ajustes.res }),
    };
    db.proyectos.push(p);
    db.activo = p.id;
    guardar();
    return p;
  }
  if (!db.proyectos.length) nuevoProyecto('Mi primer terreno');
  const proj = () => db.proyectos.find((p) => p.id === db.activo) || db.proyectos[0];

  let modo = 'ver'; // ver | dibujar | despegue
  let tab = 'terreno';
  let miUbicacion = null;
  let mostrarHuellas = false;
  let analisisFotos = null;

  /* ================= plan ================= */
  let planCache = { key: '', plan: null };
  function plan() {
    const p = proj();
    if (p.ring.length < 3) return null;
    const key = JSON.stringify([p.ring, p.mision, p.despegue]);
    if (planCache.key !== key) planCache = { key, plan: M.planMission(p.ring, p.mision, p.despegue) };
    return planCache.plan;
  }

  /* ================= mapa ================= */
  const map = new C.SlippyMap($('#map'), {
    lat: 14.6349, lon: -90.8197, z: 14,
    tileUrl: (BASES[db.ajustes.base] || BASES.esri).url, attribution: (BASES[db.ajustes.base] || BASES.esri).attr,
    onDraw: dibujarCapas,
    onTap: (lat, lon) => {
      const p = proj();
      if (modo === 'dibujar') { p.ring.push([lat, lon]); guardar(); refrescar(); }
      else if (modo === 'despegue') { p.despegue = [lat, lon]; modo = 'ver'; guardar(); toast('Punto de despegue marcado.'); refrescar(); }
    },
    handleProvider: () => proj().ring.map((q, i) => ({ id: i, lat: q[0], lon: q[1] })).concat(
      proj().despegue ? [{ id: 'despegue', lat: proj().despegue[0], lon: proj().despegue[1] }] : []),
    onHandleDrag: (hd, lat, lon, fin) => {
      const p = proj();
      if (hd.id === 'despegue') p.despegue = [lat, lon]; else p.ring[hd.id] = [lat, lon];
      if (fin) { guardar(); refrescar(); }
    },
  });

  function enfocar() {
    const p = proj();
    if (p.ring.length) {
      const la = p.ring.map((q) => q[0]); const lo = p.ring.map((q) => q[1]);
      map.fitBounds({ minLat: Math.min(...la), maxLat: Math.max(...la), minLon: Math.min(...lo), maxLon: Math.max(...lo) }, 56);
    } else if (p.fotos.length) {
      const la = p.fotos.map((q) => q.lat); const lo = p.fotos.map((q) => q.lon);
      map.fitBounds({ minLat: Math.min(...la), maxLat: Math.max(...la), minLon: Math.min(...lo), maxLon: Math.max(...lo) }, 56);
    }
  }

  function dibujarCapas(ctx, m) {
    const p = proj();
    const pl = plan();
    const z = m.z;
    // huellas de las primeras fotos
    if (pl && pl.ok && mostrarHuellas && tab === 'mision') {
      const first = pl.segInfo[0];
      ctx.fillStyle = 'rgba(255,255,255,.10)';
      ctx.strokeStyle = 'rgba(255,255,255,.75)';
      ctx.lineWidth = 1;
      const segs = pl.segInfo.slice(0, 2);
      segs.forEach((sg) => {
        for (let i = sg.first; i <= sg.last; i++) {
          const a = pl.points[i];
          const b = pl.points[Math.min(sg.last, i + 1)] === a ? pl.points[i - 1] : pl.points[Math.min(sg.last, i + 1)];
          let ux = b.x - a.x; let uy = b.y - a.y;
          if (i === sg.last) { ux = -ux; uy = -uy; }
          const L = Math.hypot(ux, uy) || 1; ux /= L; uy /= L;
          const vx = uy; const vy = -ux;
          const hl = pl.cam.fpAlong / 2; const hw = pl.cam.fpAcross / 2;
          const corners = [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]].map(([al, ac]) => {
            const x = a.x + ux * al + vx * ac; const y = a.y + uy * al + vy * ac;
            const ll = pl.loc.toLL(x, y); return m.project(ll.lat, ll.lon);
          });
          ctx.beginPath();
          corners.forEach((c, k) => (k ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)));
          ctx.closePath(); ctx.fill(); ctx.stroke();
        }
      });
    }
    // terreno
    if (p.ring.length) {
      ctx.beginPath();
      p.ring.forEach((q, i) => { const s = m.project(q[0], q[1]); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
      if (p.ring.length >= 3) ctx.closePath();
      ctx.fillStyle = 'rgba(15,127,122,.20)';
      if (p.ring.length >= 3) ctx.fill();
      ctx.lineWidth = 2.5; ctx.strokeStyle = '#0f7f7a'; ctx.lineJoin = 'round'; ctx.stroke();
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.setLineDash([2, 6]); ctx.stroke(); ctx.setLineDash([]);
    }
    // ruta
    if (pl && pl.ok && (tab === 'mision' || tab === 'terreno')) {
      ctx.lineWidth = 2; ctx.strokeStyle = '#ff5a1f'; ctx.lineJoin = 'round';
      ctx.beginPath();
      pl.points.forEach((q, i) => { const s = m.project(q.lat, q.lon); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
      ctx.stroke();
      // flechas de sentido
      ctx.fillStyle = '#ff5a1f';
      pl.segInfo.forEach((sg) => {
        const a = m.project(pl.points[sg.first].lat, pl.points[sg.first].lon);
        const b = m.project(pl.points[sg.last].lat, pl.points[sg.last].lon);
        const mx = (a.x + b.x) / 2; const my = (a.y + b.y) / 2;
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        if (Math.hypot(b.x - a.x, b.y - a.y) < 40) return;
        ctx.save(); ctx.translate(mx, my); ctx.rotate(ang);
        ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-5, -5); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill();
        ctx.restore();
      });
      if (z >= 17) {
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#ff5a1f'; ctx.lineWidth = 1.5;
        pl.points.forEach((q) => { const s = m.project(q.lat, q.lon); ctx.beginPath(); ctx.arc(s.x, s.y, 2.6, 0, 6.3); ctx.fill(); ctx.stroke(); });
      }
      // inicio de vuelo
      const s0 = m.project(pl.points[0].lat, pl.points[0].lon);
      ctx.fillStyle = '#ff5a1f'; ctx.beginPath(); ctx.arc(s0.x, s0.y, 6, 0, 6.3); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '700 9px system-ui'; ctx.textAlign = 'center'; ctx.fillText('1', s0.x, s0.y + 3); ctx.textAlign = 'left';
    }
    // fotos tomadas
    if (p.fotos.length && (tab === 'fotos' || tab === 'terreno')) {
      const aislado = new Set((analisisFotos && analisisFotos.huecos) || []);
      p.fotos.forEach((f) => {
        if (f.lat == null) return;
        const s = m.project(f.lat, f.lon);
        ctx.beginPath(); ctx.arc(s.x, s.y, tab === 'fotos' ? 3.6 : 2.4, 0, 6.3);
        ctx.fillStyle = aislado.has(f.name) ? '#d92d20' : '#14283a'; ctx.fill();
        ctx.lineWidth = 1; ctx.strokeStyle = '#fff'; ctx.stroke();
      });
    }
    // despegue
    if (p.despegue) {
      const s = m.project(p.despegue[0], p.despegue[1]);
      ctx.fillStyle = '#14283a'; ctx.fillRect(s.x - 9, s.y - 9, 18, 18);
      ctx.fillStyle = '#fff'; ctx.font = '700 11px system-ui'; ctx.textAlign = 'center'; ctx.fillText('D', s.x, s.y + 4); ctx.textAlign = 'left';
    }
    // vértices
    p.ring.forEach((q, i) => {
      const s = m.project(q[0], q[1]);
      ctx.beginPath(); ctx.arc(s.x, s.y, modo === 'dibujar' ? 8 : 6, 0, 6.3);
      ctx.fillStyle = '#fff'; ctx.fill();
      ctx.lineWidth = 2.5; ctx.strokeStyle = '#0f7f7a'; ctx.stroke();
      if (modo === 'dibujar' || p.ring.length < 12) {
        ctx.font = '600 11px system-ui'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.95)';
        ctx.strokeText('P' + (i + 1), s.x + 10, s.y - 8); ctx.fillStyle = '#0b3f3c'; ctx.fillText('P' + (i + 1), s.x + 10, s.y - 8);
      }
    });
    // mi ubicación
    if (miUbicacion) {
      const s = m.project(miUbicacion.lat, miUbicacion.lon);
      const r = Math.max(8, (miUbicacion.acc || 10) / m.metersPerPixel());
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, 6.3); ctx.fillStyle = 'rgba(30,110,255,.12)'; ctx.fill();
      ctx.beginPath(); ctx.arc(s.x, s.y, 7, 0, 6.3); ctx.fillStyle = '#1e6eff'; ctx.fill();
      ctx.lineWidth = 2.5; ctx.strokeStyle = '#fff'; ctx.stroke();
    }
    $('#map').classList.toggle('dibujando', modo !== 'ver');
  }

  /* ================= refresco general ================= */
  function refrescar() {
    $('#proyNombre').textContent = proj().nombre;
    map.redraw();
    if (tab === 'terreno') renderTerrenoResumen();
    if (tab === 'mision') renderMisionResultados();
    if (tab === 'terreno' || tab === 'mision') renderBarraModo();
    renderBarraModo();
  }

  function renderBarraModo() {
    const b = $('#modebar');
    b.innerHTML = '';
    const p = proj();
    if (modo === 'dibujar') {
      b.append(
        h('span', { class: 'mb-msg' }, p.ring.length ? `Toca el mapa para añadir P${p.ring.length + 1}` : 'Toca el mapa para marcar el primer punto'),
        h('button', { class: 'btn sm', onclick: () => { p.ring.pop(); guardar(); refrescar(); }, disabled: !p.ring.length }, 'Deshacer'),
        h('button', { class: 'btn sm primary', onclick: () => { modo = 'ver'; refrescar(); renderPanel(); } }, 'Terminar'),
      );
      b.hidden = false;
    } else if (modo === 'despegue') {
      b.append(h('span', { class: 'mb-msg' }, 'Toca el mapa donde vas a despegar'), h('button', { class: 'btn sm', onclick: () => { modo = 'ver'; refrescar(); } }, 'Cancelar'));
      b.hidden = false;
    } else b.hidden = true;
  }

  /* ================= panel ================= */
  const TABS = [
    ['terreno', 'Terreno', '<path d="M3 17 9 5l5 8 3-4 4 8z"/>'],
    ['mision', 'Misión', '<path d="M4 6h10a3 3 0 0 1 0 6H8a3 3 0 0 0 0 6h12"/><path d="m17 15 3 3-3 3"/>'],
    ['fotos', 'Fotos', '<rect x="3" y="6" width="18" height="14" rx="2"/><circle cx="12" cy="13" r="3.5"/><path d="M8 6l1.5-2h5L16 6"/>'],
    ['vuelos', 'Vuelos', '<path d="M9 4h6M12 4v3"/><rect x="5" y="7" width="14" height="14" rx="2"/><path d="m9 14 2 2 4-4"/>'],
    ['ajustes', 'Ajustes', '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>'],
  ];
  function renderTabs() {
    const nav = $('#tabs');
    nav.innerHTML = '';
    TABS.forEach(([id, nombre, icon]) => {
      nav.append(h('button', {
        role: 'tab', 'aria-selected': String(tab === id), class: 'tab' + (tab === id ? ' on' : ''), onclick: () => { tab = id; renderTabs(); renderPanel(); map.redraw(); },
      }, h('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', html: icon }), h('span', {}, nombre)));
    });
  }
  function renderPanel() {
    const body = $('#panelBody');
    body.innerHTML = '';
    body.scrollTop = 0;
    ({ terreno: renderTerreno, mision: renderMision, fotos: renderFotos, vuelos: renderVuelos, ajustes: renderAjustes })[tab](body);
    renderBarraModo();
  }

  const row = (k, v, strong) => h('div', { class: 'kv' }, h('span', { class: 'k' }, k), h('span', { class: 'v' + (strong ? ' strong' : '') }, v));
  const section = (title, ...kids) => h('section', { class: 'sec' }, title ? h('h3', {}, title) : null, ...kids);

  /* ---------- Terreno ---------- */
  let resumenEl;
  function renderTerreno(body) {
    const p = proj();
    const sel = h('select', { id: 'selProy', 'aria-label': 'Terreno activo', onchange: (e) => { db.activo = e.target.value; guardar(); analisisFotos = null; renderPanel(); refrescar(); enfocar(); } },
      db.proyectos.map((q) => h('option', { value: q.id, selected: q.id === p.id }, q.nombre)));
    body.append(section(null,
      h('div', { class: 'row-actions' }, sel,
        h('button', { class: 'btn sm', onclick: () => { const n = prompt('Nombre del terreno nuevo', 'Terreno ' + (db.proyectos.length + 1)); if (n) { nuevoProyecto(n.trim()); renderPanel(); refrescar(); } } }, 'Nuevo'),
        h('button', { class: 'btn sm', onclick: () => { const n = prompt('Nuevo nombre', p.nombre); if (n) { p.nombre = n.trim(); guardar(); renderPanel(); refrescar(); } } }, 'Renombrar'),
        h('button', { class: 'btn sm danger', onclick: () => { if (confirm(`¿Eliminar «${p.nombre}» con su misión y fotos?`)) { db.proyectos = db.proyectos.filter((q) => q.id !== p.id); if (!db.proyectos.length) nuevoProyecto('Mi primer terreno'); db.activo = db.proyectos[0].id; guardar(); renderPanel(); refrescar(); enfocar(); } } }, 'Eliminar'),
      )));
    resumenEl = h('div', { id: 'resumen' });
    body.append(section('Contorno del terreno', resumenEl));
    renderTerrenoResumen();

    body.append(section('Agregar o corregir el contorno',
      h('div', { class: 'stack' },
        h('button', { class: 'btn primary', onclick: () => { modo = 'dibujar'; refrescar(); } }, p.ring.length ? 'Seguir dibujando en el mapa' : 'Dibujar en el mapa'),
        h('label', { class: 'btn file' }, 'Importar archivo (KML, KMZ, .json del Modeler, GeoJSON, CSV)',
          h('input', { type: 'file', accept: '.kml,.kmz,.json,.geojson,.csv,.txt', onchange: importarArchivo })),
        h('div', { class: 'row-actions' },
          h('button', { class: 'btn', onclick: usarUbicacion }, 'Ir a mi ubicación'),
          h('button', { class: 'btn', onclick: () => { modo = 'despegue'; refrescar(); } }, p.despegue ? 'Mover despegue' : 'Marcar despegue'),
        ),
        p.ring.length ? h('button', { class: 'btn quiet danger', onclick: () => { if (confirm('¿Borrar el contorno dibujado?')) { p.ring = []; guardar(); refrescar(); } } }, 'Borrar contorno') : null,
      ),
      h('p', { class: 'hint' }, 'Los puntos de My ArQ (KML) y los lotes del Modeler My ArQ se importan tal cual. Arrastra cualquier vértice en el mapa para ajustarlo.'),
    ));
    if (p.ring.length >= 3) {
      body.append(section('Llevar a otros programas',
        h('div', { class: 'row-actions' },
          h('button', { class: 'btn', onclick: () => descargar(AD.slug(p.nombre) + '-terreno.kml', 'application/vnd.google-earth.kml+xml', X.buildKml(p.nombre, { ring: p.ring, vertices: true, takeoff: p.despegue, nombreTerreno: p.nombre })) }, 'Descargar KML'),
          h('button', { class: 'btn', onclick: () => descargar(AD.slug(p.nombre) + '-vertices.csv', 'text/csv', X.buildPointsCsv(p.ring.map((q, i) => ({ name: 'P' + (i + 1), lat: q[0], lon: q[1] })))) }, 'Descargar CSV'),
        ),
        h('p', { class: 'hint' }, 'El KML abre directo en el Modeler My ArQ y en Google Earth.')));
    }
  }
  function renderTerrenoResumen() {
    if (!resumenEl) return;
    const p = proj();
    resumenEl.innerHTML = '';
    if (p.ring.length < 3) {
      resumenEl.append(h('p', { class: 'empty' }, p.ring.length ? `Tienes ${p.ring.length} punto(s). Marca al menos 3 para formar el terreno.` : 'Aún no hay terreno. Dibuja el contorno sobre el mapa o importa el KML de My ArQ.'));
      return;
    }
    const info = G.ringInfo(p.ring);
    add(resumenEl,
      row('Área', `${fmt(info.area, 1)} m²`, true),
      row('Equivale a', `${fmt(info.area / MZ, 3)} manzanas · ${fmt(info.area / VARA2)} varas²`),
      row('Hectáreas', fmt(info.area / 10000, 4)),
      row('Perímetro', `${fmt(info.perimeter, 1)} m`),
      row('Vértices', String(p.ring.length)),
      p.despegue ? row('Despegue', `${p.despegue[0].toFixed(6)}, ${p.despegue[1].toFixed(6)}`) : null,
    );
  }

  async function importarArchivo(ev) {
    const f = ev.target.files[0];
    ev.target.value = '';
    if (!f) return;
    try {
      const ext = f.name.split('.').pop().toLowerCase();
      let text;
      let eff = ext;
      if (ext === 'kmz') {
        const files = await Z.unzip(await f.arrayBuffer());
        const k = files.find((x) => /\.kml$/i.test(x.name));
        if (!k) throw new Error('El KMZ no trae ningún KML adentro.');
        text = new TextDecoder().decode(k.data); eff = 'kml';
      } else text = await f.text();
      const r = I.importText(text, eff);
      elegirImportado(r, f.name);
    } catch (e) {
      toast('No se pudo leer «' + f.name + '»: ' + e.message, 5000);
    }
  }
  function aplicarAnillo(ring, nombre) {
    const p = proj();
    p.ring = ring;
    if (nombre && /^(Terreno \d+|Mi primer terreno)$/.test(p.nombre)) p.nombre = nombre;
    guardar(); renderPanel(); refrescar(); enfocar();
    toast(`Contorno cargado: ${ring.length} vértices.`);
  }
  function elegirImportado(r, archivo) {
    const opciones = [];
    r.polygons.filter((q) => q.ring.length >= 3).forEach((q) => opciones.push({ titulo: q.name, nombre: q.name, detalle: `Polígono · ${q.ring.length} vértices · ${fmt(G.ringInfo(q.ring).area)} m²`, ring: q.ring }));
    if (r.points.length >= 3) opciones.push({ titulo: 'Unir los ' + r.points.length + ' puntos en orden', nombre: null, detalle: 'Se conectan en el orden del archivo (P1, P2, P3…)', ring: I.ringFromPoints(r.points) });
    r.lines.filter((q) => q.path.length >= 3).forEach((q) => opciones.push({ titulo: 'Línea: ' + q.name, nombre: null, detalle: `${q.path.length} puntos, se cierra sola`, ring: q.path }));
    if (!opciones.length) { toast('El archivo no trae un polígono ni al menos 3 puntos.', 5000); return; }
    const nombreBase = archivo.replace(/\.[^.]+$/, '');
    if (opciones.length === 1) { aplicarAnillo(opciones[0].ring, opciones[0].nombre || nombreBase); if (r.avisos.length) toast(r.avisos[0], 5000); return; }
    const dlg = $('#dlg');
    dlg.innerHTML = '';
    dlg.append(h('form', { method: 'dialog' },
      h('h3', {}, 'Elige qué importar'),
      h('p', { class: 'hint' }, `«${archivo}» trae varias opciones.`),
      h('div', { class: 'stack' }, opciones.map((o) => h('button', { class: 'opt', value: 'ok', onclick: (e) => { e.preventDefault(); dlg.close(); aplicarAnillo(o.ring, o.nombre || nombreBase); } }, h('strong', {}, o.titulo), h('span', {}, o.detalle)))),
      h('button', { class: 'btn quiet', value: 'cancel' }, 'Cancelar')));
    dlg.showModal();
  }

  function usarUbicacion(cb) {
    if (!navigator.geolocation) { toast('Este navegador no da la ubicación.'); return; }
    navigator.geolocation.getCurrentPosition((pos) => {
      miUbicacion = { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy };
      map.setView(miUbicacion.lat, miUbicacion.lon, Math.max(map.z, 17));
      toast('Precisión del GPS: ' + fmt(pos.coords.accuracy) + ' m');
      if (typeof cb === 'function') cb(miUbicacion);
    }, (err) => toast('No se pudo obtener la ubicación: ' + err.message, 4500), { enableHighAccuracy: true, timeout: 15000 });
  }

  /* ---------- Misión ---------- */
  let resEl; let adapEl;
  function campo(label, input, nota) {
    return h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), input, nota ? h('span', { class: 'note' }, nota) : null);
  }
  function numInput(key, o) {
    const p = proj();
    const scale = o.scale || 1;
    return h('input', {
      type: 'number', inputmode: 'decimal', min: o.min, max: o.max, step: o.step || 1, value: String(+(p.mision[key] * scale).toFixed(2)),
      oninput: (e) => { const v = parseFloat(e.target.value); if (isFinite(v)) { p.mision[key] = v / scale; guardar(); renderMisionResultados(); map.redraw(); } },
    });
  }
  function renderMision(body) {
    const p = proj();
    const m = p.mision;
    if (p.ring.length < 3) {
      body.append(section(null, h('p', { class: 'empty' }, 'Primero define el terreno: dibuja el contorno o importa un archivo en la pestaña Terreno.'), h('button', { class: 'btn primary', onclick: () => { tab = 'terreno'; renderTabs(); renderPanel(); } }, 'Ir a Terreno')));
      return;
    }
    const drone = M.DRONES[m.drone] || M.DRONES.generico;
    const selDrone = h('select', { onchange: (e) => { m.drone = e.target.value; const d = M.DRONES[m.drone]; if (!d.imagenes[m.res]) m.res = Object.keys(d.imagenes)[0]; db.ajustes.drone = m.drone; guardar(); renderPanel(); map.redraw(); } },
      Object.values(M.DRONES).map((d) => h('option', { value: d.id, selected: d.id === m.drone }, d.nombre)));
    const selRes = h('select', { onchange: (e) => { m.res = e.target.value; guardar(); renderMisionResultados(); } },
      Object.entries(drone.imagenes).map(([k, [w, hh]]) => h('option', { value: k, selected: k === m.res }, `${k} MP (${w}×${hh})`)));
    const selAng = h('select', { onchange: (e) => { m.angulo = e.target.value === 'auto' ? 'auto' : 0; guardar(); renderPanel(); map.redraw(); } },
      h('option', { value: 'auto', selected: m.angulo === 'auto' }, 'Automático (menos líneas)'), h('option', { value: 'man', selected: m.angulo !== 'auto' }, 'Manual'));
    body.append(
      section('Dron y cámara',
        campo('Dron', selDrone, drone.nota), campo('Resolución de foto', selRes),
        h('details', {}, h('summary', {}, 'Ajustar datos de la cámara'),
          campo('Distancia focal equivalente a 35 mm', h('input', { type: 'number', step: '0.1', value: String(m.f35 || drone.f35), oninput: (e) => { const v = parseFloat(e.target.value); m.f35 = isFinite(v) && v > 5 ? v : null; guardar(); renderMisionResultados(); } }), 'Se toma de la ficha del fabricante o del dato FocalLengthIn35mmFilm de una foto real.'),
        )),
      section('Vuelo',
        h('div', { class: 'grid2' },
          campo('Altura sobre el despegue (m)', numInput('alt', { min: 10, max: 300 })),
          campo('Velocidad (m/s)', numInput('velocidad', { min: 1, max: 15, step: 0.5 })),
          campo('Solape frontal (%)', numInput('solapeFrontal', { min: 50, max: 95, scale: 100 })),
          campo('Solape lateral (%)', numInput('solapeLateral', { min: 40, max: 90, scale: 100 })),
          campo('Tiempo útil por batería (min)', numInput('utilMin', { min: 5, max: 45 }), 'Deja margen para el regreso.'),
          campo('Dirección de las líneas', selAng),
        ),
        m.angulo !== 'auto' ? campo('Rumbo de las líneas (° desde el norte)', h('input', { type: 'number', min: 0, max: 179, step: 5, value: String(m.angulo), oninput: (e) => { const v = parseFloat(e.target.value); if (isFinite(v)) { m.angulo = v; guardar(); renderMisionResultados(); map.redraw(); } } })) : null,
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: mostrarHuellas, onchange: (e) => { mostrarHuellas = e.target.checked; map.redraw(); } }), 'Mostrar el área que cubre cada foto'),
      ));
    resEl = h('div', { id: 'resMision' });
    adapEl = h('div', { id: 'adaptadores' });
    body.append(section('Resultado de la misión', resEl), section('Descargar misión', adapEl));
    renderMisionResultados();
  }
  function renderMisionResultados() {
    if (!resEl) return;
    const p = proj();
    const pl = plan();
    resEl.innerHTML = '';
    adapEl.innerHTML = '';
    if (!pl) return;
    if (!pl.ok) { resEl.append(h('div', { class: 'warn' }, pl.warnings.join(' '))); return; }
    const s = pl.stats;
    pl.warnings.forEach((w) => resEl.append(h('div', { class: 'warn' }, w)));
    resEl.append(
      row('Detalle en el suelo', `${fmt(s.gsdCm, 1)} cm por píxel`, true),
      row('Cada foto cubre', `${fmt(pl.cam.fpAcross)} × ${fmt(pl.cam.fpAlong)} m`),
      row('Líneas de vuelo', `${s.lineas} · separadas ${fmt(pl.cam.lineSpacing, 1)} m · rumbo ${fmt(pl.theta)}°`),
      row('Fotos', `${fmt(s.fotos)} · una cada ${fmt(pl.cam.photoSpacing, 1)} m`),
      row('Intervalo entre fotos', `${fmt(s.intervaloS, 1)} s a ${p.mision.velocidad} m/s`),
      row('Recorrido', `${fmt(s.distanciaM / 1000, 2)} km`),
      row('Tiempo de vuelo', `${fmt(s.minutos, 1)} min`),
      row('Baterías', `${s.baterias}`, true),
    );
    if (pl.sorties.length > 1) {
      resEl.append(h('div', { class: 'sorties' }, pl.sorties.map((so, i) => h('div', { class: 'sortie' }, h('strong', {}, 'Batería ' + (i + 1)), h('span', {}, `${so.photos} fotos · ${fmt(so.minutes, 1)} min`)))));
    }
    // adaptadores
    const drone = M.DRONES[p.mision.drone] || M.DRONES.generico;
    const ads = AD.forDrone(drone.id);
    const orden = ads.slice().sort((a, b) => (a.id === drone.recomendado ? -1 : b.id === drone.recomendado ? 1 : 0));
    orden.forEach((a) => {
      const partes = pl.sorties.length;
      const card = h('div', { class: 'adap' + (a.id === drone.recomendado ? ' rec' : '') },
        h('div', { class: 'adap-h' }, h('strong', {}, a.nombre), a.id === drone.recomendado ? h('span', { class: 'tag' }, 'Recomendado') : null),
        h('p', { class: 'hint' }, a.plataformas));
      const acciones = h('div', { class: 'row-actions' });
      const ctx = () => ({ nombre: p.nombre, alt: p.mision.alt, velocidad: p.mision.velocidad, droneEnum: drone.droneEnum, ring: p.ring, takeoff: p.despegue });
      const bajar = (from, to, suf) => {
        try {
          const sub = from == null ? pl : M.slicePlan(pl, from, to);
          AD.ADAPTERS[a.id].build(sub, Object.assign(ctx(), { sufijo: suf || '' })).forEach((f) => descargar(f.name, f.mime, f.data));
        } catch (e) { toast(e.message, 4500); }
      };
      if (partes > 1) pl.sorties.forEach((so, i) => acciones.append(h('button', { class: 'btn sm', onclick: () => bajar(so.from, so.to, `-bateria${i + 1}`) }, 'Batería ' + (i + 1))));
      acciones.append(h('button', { class: 'btn sm' + (partes > 1 ? '' : ' primary'), onclick: () => bajar() }, partes > 1 ? 'Todo junto' : 'Descargar ' + a.archivo));
      card.append(acciones);
      if (a.pasos.length) card.append(h('details', {}, h('summary', {}, 'Cómo cargarla en el dron'), h('ol', {}, a.pasos.map((t) => h('li', {}, t))), a.advertencia ? h('p', { class: 'warn small' }, a.advertencia) : null));
      adapEl.append(card);
    });
    adapEl.append(h('p', { class: 'hint' }, 'Primera vez con un formato nuevo: vuela una versión corta (2 o 3 líneas) en un lugar abierto y revisa que el dron respete altura, líneas y fotos.'));
  }

  /* ---------- Fotos ---------- */
  function renderFotos(body) {
    const p = proj();
    body.append(section('Fotos del vuelo',
      h('label', { class: 'btn primary file' }, 'Elegir fotos del dron (JPG)', h('input', { type: 'file', accept: 'image/jpeg,.jpg,.jpeg', multiple: true, onchange: leerFotos })),
      h('p', { class: 'hint' }, 'Solo se lee la posición y la altura de cada foto; las imágenes no salen de tu equipo.')));
    const out = h('div', { id: 'fotosRes' });
    body.append(section('Resumen', out));
    renderFotosResumen(out);
    body.append(section('Hacer el mapa y las curvas de nivel', odmBloque()));
  }
  async function leerFotos(ev) {
    const files = [...ev.target.files];
    ev.target.value = '';
    if (!files.length) return;
    const p = proj();
    const out = $('#fotosRes');
    out.innerHTML = '';
    const prog = h('div', { class: 'prog' }, h('div', { class: 'bar' }), h('span', {}, `Leyendo 0 de ${files.length}…`));
    out.append(prog);
    const lista = [];
    for (let i = 0; i < files.length; i++) {
      try { const r = await E.readPhoto(files[i]); lista.push({ name: r.name, lat: r.lat ?? null, lon: r.lon ?? null, alt: r.alt ?? null, rel: r.rel ?? null, f35: r.f35 ?? null, date: r.date || null, yaw: r.yaw ?? null, pitch: r.pitch ?? null, w: r.w ?? null }); }
      catch (e) { lista.push({ name: files[i].name, lat: null, lon: null, error: true }); }
      if (i % 10 === 0 || i === files.length - 1) { $('.bar', prog).style.width = ((i + 1) / files.length * 100) + '%'; $('span', prog).textContent = `Leyendo ${i + 1} de ${files.length}…`; await new Promise((r) => setTimeout(r)); }
    }
    p.fotos = lista;
    guardar();
    renderFotosResumen(out);
    const g = lista.filter((f) => f.lat != null);
    if (g.length) enfocarFotos(g);
    map.redraw();
  }
  function enfocarFotos(g) {
    const la = g.map((q) => q.lat); const lo = g.map((q) => q.lon);
    map.fitBounds({ minLat: Math.min(...la), maxLat: Math.max(...la), minLon: Math.min(...lo), maxLon: Math.max(...lo) }, 56);
  }
  function renderFotosResumen(out) {
    const p = proj();
    out.innerHTML = '';
    if (!p.fotos.length) { out.append(h('p', { class: 'empty' }, 'Todavía no cargas fotos de este terreno.')); analisisFotos = null; return; }
    const drone = M.DRONES[p.mision.drone] || M.DRONES.generico;
    const pl = plan();
    const r = FT.analyze(p.fotos, p.ring, pl && pl.ok ? pl : null, { f35: p.mision.f35 || drone.f35, aspecto: drone.aspecto, altRef: p.mision.alt });
    analisisFotos = r;
    r.avisos.forEach((a) => out.append(h('div', { class: 'warn' }, a)));
    add(out,
      row('Fotos leídas', `${r.total} (${r.conGps} con GPS)`, true),
      r.altRelMedia != null ? row('Altura media', `${fmt(r.altRelMedia, 1)} m`) : null,
      r.vecino ? row('Separación entre fotos', `mediana ${fmt(r.vecino.mediana, 1)} m`) : null,
      r.cobertura != null ? row('Terreno cubierto', `${fmt(r.cobertura * 100)} %`, true) : null,
      r.cobertura3 != null ? row('En 3 o más fotos', `${fmt(r.cobertura3 * 100)} %`) : null,
    );
    if (r.conGps) {
      const pts = p.fotos.filter((f) => f.lat != null).map((f) => ({ name: f.name, lat: f.lat, lon: f.lon, alt: f.rel ?? f.alt ?? 0 }));
      out.append(h('div', { class: 'row-actions' },
        h('button', { class: 'btn sm', onclick: () => descargar(AD.slug(p.nombre) + '-fotos.kml', 'application/vnd.google-earth.kml+xml', X.buildKml(p.nombre + ' — fotos', { points: pts })) }, 'Puntos a KML'),
        h('button', { class: 'btn sm', onclick: () => descargar(AD.slug(p.nombre) + '-fotos.csv', 'text/csv', X.buildPointsCsv(pts)) }, 'Puntos a CSV'),
        h('button', { class: 'btn sm quiet danger', onclick: () => { p.fotos = []; guardar(); renderFotosResumen(out); map.redraw(); } }, 'Quitar fotos'),
      ));
    }
  }
  function odmBloque() {
    const p = proj();
    const pl = plan();
    const gsd = pl && pl.ok ? pl.stats.gsdCm : null;
    const opts = [
      'dsm: true', 'dtm: true',
      gsd ? `orthophoto-resolution: ${(Math.round(gsd * 2) / 2).toFixed(1)}` : 'orthophoto-resolution: 3',
      gsd ? `dem-resolution: ${(Math.round(gsd * 4) / 2).toFixed(1)}` : 'dem-resolution: 6',
      'pc-quality: medium', 'feature-quality: high', 'auto-boundary: true', 'cog: true',
    ].join('\n');
    return h('div', {},
      h('ol', { class: 'steps' },
        h('li', {}, 'Abre WebODM (gratis, se instala con Docker en tu computadora o en un servidor).'),
        h('li', {}, 'Crea un proyecto y sube todas las fotos del vuelo.'),
        h('li', {}, 'En las opciones de procesamiento pon estos valores:'),
      ),
      h('pre', { class: 'code' }, opts),
      h('button', { class: 'btn sm', onclick: () => { navigator.clipboard && navigator.clipboard.writeText(opts).then(() => toast('Opciones copiadas.')); } }, 'Copiar opciones'),
      h('ol', { class: 'steps', start: '4' },
        h('li', {}, 'Cuando termine, abre el mapa 2D y usa la herramienta de curvas de nivel; descarga el resultado en GeoJSON o DXF.'),
        h('li', {}, 'Lleva las curvas y la ortofoto al Modeler My ArQ como fondo del plano.'),
      ),
      h('p', { class: 'hint' }, 'Sin puntos de control medidos en tierra, la posición absoluta del mapa puede variar varios metros: sirve para ver y medir en relativo, no reemplaza el levantamiento topográfico para trámites.'),
    );
  }

  /* ---------- Vuelos ---------- */
  const CHECK = [
    ['Antes de salir', ['Baterías del dron, del control y del teléfono cargadas', 'Tarjeta de memoria con espacio y formateada', 'Hélices y cuerpo sin daños', 'App y firmware del dron al día', 'Misión revisada y guardada (y una copia sin conexión)', 'Revisé la normativa y los permisos que aplican al terreno']],
    ['En el sitio', ['Despegue en un lugar plano y despejado', 'Sin lluvia y con viento tolerable para el dron', 'Brújula e IMU sin avisos; GPS con satélites suficientes', 'Punto de regreso (casa) registrado', 'Altura de regreso a casa mayor que cualquier obstáculo', 'Intervalo o disparo de cámara configurado en el dron', 'Dron a la vista y zona libre de personas']],
    ['Al terminar', ['Fotos copiadas y contadas', 'Vuelo anotado en la bitácora', 'Baterías guardadas con carga de almacenamiento']],
  ];
  let checkState = {};
  function renderVuelos(body) {
    const total = CHECK.reduce((s, g) => s + g[1].length, 0);
    const hechos = () => Object.values(checkState).filter(Boolean).length;
    const cont = h('span', { class: 'count' }, `${hechos()} de ${total}`);
    const lista = h('div', {});
    CHECK.forEach(([titulo, items]) => {
      lista.append(h('h4', {}, titulo), ...items.map((t) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!checkState[t], onchange: (e) => { checkState[t] = e.target.checked; cont.textContent = `${hechos()} de ${total}`; } }), t)));
    });
    body.append(section('Lista de revisión', h('div', { class: 'row-actions between' }, cont, h('button', { class: 'btn sm quiet', onclick: () => { checkState = {}; renderPanel(); } }, 'Reiniciar')), lista,
      h('p', { class: 'hint' }, 'Es una lista general. Ajústala a tus procedimientos y a la normativa vigente en tu zona.')));
    const f = {};
    const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    body.append(section('Anotar un vuelo',
      h('form', { class: 'stack', onsubmit: (e) => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(e.target).entries());
        db.vuelos.unshift({ id: uid(), fecha: d.fecha, terreno: proj().nombre, dron: d.dron, baterias: +d.baterias || 0, minutos: +d.minutos || 0, fotos: +d.fotos || 0, viento: d.viento, notas: d.notas, revision: `${hechos()}/${total}` });
        guardar(); checkState = {}; renderPanel(); toast('Vuelo guardado.');
      } },
        h('div', { class: 'grid2' },
          campo('Fecha y hora', h('input', { type: 'datetime-local', name: 'fecha', value: now.toISOString().slice(0, 16), required: true })),
          campo('Dron', h('select', { name: 'dron' }, Object.values(M.DRONES).map((d) => h('option', { value: d.nombre, selected: d.id === proj().mision.drone }, d.nombre)))),
          campo('Baterías usadas', h('input', { type: 'number', name: 'baterias', min: 0, value: plan() && plan().ok ? plan().stats.baterias : 1 })),
          campo('Minutos de vuelo', h('input', { type: 'number', name: 'minutos', min: 0, step: 0.5 })),
          campo('Fotos tomadas', h('input', { type: 'number', name: 'fotos', min: 0, value: proj().fotos.length || '' })),
          campo('Viento', h('input', { type: 'text', name: 'viento', placeholder: 'Ej. leve, del norte' })),
        ),
        campo('Notas', h('textarea', { name: 'notas', rows: 2, placeholder: 'Qué pasó, qué corregir la próxima vez' })),
        h('button', { class: 'btn primary', type: 'submit' }, 'Guardar vuelo'))));
    const hist = h('div', {});
    if (!db.vuelos.length) hist.append(h('p', { class: 'empty' }, 'Aún no hay vuelos anotados.'));
    db.vuelos.forEach((v) => hist.append(h('div', { class: 'vuelo' },
      h('div', {}, h('strong', {}, v.terreno), h('span', { class: 'hint' }, ' ' + new Date(v.fecha).toLocaleString('es-GT', { dateStyle: 'medium', timeStyle: 'short' }))),
      h('div', { class: 'hint' }, `${v.dron} · ${v.baterias} batería(s) · ${v.minutos} min · ${v.fotos} fotos · revisión ${v.revision}${v.viento ? ' · viento ' + v.viento : ''}`),
      v.notas ? h('div', {}, v.notas) : null,
      h('button', { class: 'btn sm quiet danger', onclick: () => { if (confirm('¿Borrar este vuelo?')) { db.vuelos = db.vuelos.filter((x) => x.id !== v.id); guardar(); renderPanel(); } } }, 'Borrar'))));
    body.append(section('Bitácora', hist, db.vuelos.length ? h('button', { class: 'btn sm', onclick: () => descargar('bitacora-vuelos.csv', 'text/csv', ['fecha,terreno,dron,baterias,minutos,fotos,viento,revision,notas'].concat(db.vuelos.map((v) => [v.fecha, v.terreno, v.dron, v.baterias, v.minutos, v.fotos, v.viento || '', v.revision, v.notas || ''].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))).join('\n')) }, 'Descargar bitácora (CSV)') : null));
  }

  /* ---------- Ajustes ---------- */
  function renderAjustes(body) {
    const selBase = h('select', { onchange: (e) => { db.ajustes.base = e.target.value; guardar(); const b = BASES[db.ajustes.base]; map.setTiles(b.url, b.attr); } },
      Object.entries(BASES).map(([k, b]) => h('option', { value: k, selected: db.ajustes.base === k }, b.nombre)));
    body.append(section('Mapa', campo('Mapa de fondo', selBase, 'Si no hay internet en el campo, usa la cuadrícula: el terreno y la misión se siguen viendo.')));
    const tabla = h('div', { class: 'caps' });
    Object.values(AD.ADAPTERS).forEach((a) => tabla.append(h('div', { class: 'cap' },
      h('div', {}, h('strong', {}, a.nombre), h('span', { class: 'tag ' + (a.estado === 'listo' ? 'ok' : 'wip') }, a.estado === 'listo' ? 'Disponible' : 'En camino')),
      h('div', { class: 'hint' }, a.plataformas + (a.caps.controlEnVivo ? ' · control en vivo' : '')),
      a.estado !== 'listo' && a.advertencia ? h('div', { class: 'hint' }, a.advertencia) : null)));
    body.append(section('Marcas y formatos', h('p', { class: 'hint' }, 'Cada marca entra por un adaptador. Así se agregan otros drones sin tocar el resto de la app.'), tabla));
    body.append(section('Copia de seguridad',
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn', onclick: () => descargar('cei-drone-studio-respaldo.json', 'application/json', JSON.stringify(db)) }, 'Descargar copia'),
        h('label', { class: 'btn file' }, 'Restaurar copia', h('input', { type: 'file', accept: '.json', onchange: async (e) => { const f = e.target.files[0]; if (!f) return; try { const d = JSON.parse(await f.text()); if (!d.proyectos) throw new Error('No es una copia de Drone Studio.'); if (!confirm('Esto reemplaza todo lo que hay ahora. ¿Continuar?')) return; db = d; guardar(); location.reload(); } catch (err) { toast(err.message, 4500); } } }))),
      h('p', { class: 'hint' }, 'Todo se guarda solo en este navegador. Descarga una copia antes de cambiar de equipo o limpiar el navegador.')));
    body.append(section('Acerca de', h('p', { class: 'hint' }, 'CEI Drone Studio 0.1. Planifica misiones de mapeo desde los terrenos de My ArQ y del Modeler My ArQ, y revisa las fotos del vuelo.')));
  }

  /* ================= arranque ================= */
  $('#btnZoomIn').onclick = () => map.zoomBy(1);
  $('#btnZoomOut').onclick = () => map.zoomBy(-1);
  $('#btnFit').onclick = () => { enfocar(); };
  $('#btnLoc').onclick = () => usarUbicacion();
  $('#btnSheet').onclick = () => { const on = document.body.classList.toggle('sheet-open'); $('#btnSheet').setAttribute('aria-expanded', String(on)); };
  $('#proyNombre').onclick = () => { tab = 'terreno'; renderTabs(); renderPanel(); document.body.classList.add('sheet-open'); };

  function estadoRed() { $('#net').hidden = navigator.onLine; }
  addEventListener('online', estadoRed); addEventListener('offline', estadoRed); estadoRed();

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  renderTabs(); renderPanel(); refrescar();
  if (proj().ring.length || proj().fotos.length) enfocar();
  else if (navigator.geolocation) navigator.geolocation.getCurrentPosition((pos) => { if (!proj().ring.length) map.setView(pos.coords.latitude, pos.coords.longitude, 16); }, () => {}, { timeout: 4000 });

  window.__cei = { get db() { return db; }, map, plan, proj, setTab: (t) => { tab = t; renderTabs(); renderPanel(); map.redraw(); } }; // para pruebas
})();
