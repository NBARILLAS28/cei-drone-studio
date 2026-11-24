/* CEI Drone Studio — importadores de terrenos
 * KML (My ArQ), .json de Modeler My ArQ (GTM), GeoJSON y CSV lat,lon.
 * Resultado común: { polygons:[{name, ring:[[lat,lon]]}], lines:[{name, path}], points:[{name,lat,lon}], avisos:[] }
 */
(function (root) {
  'use strict';
  const G = (typeof require !== 'undefined' && typeof module !== 'undefined') ? require('./geo.js') : root.CEI.geo;

  function clean(s) {
    return String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim();
  }
  function parseCoords(txt) {
    return txt.trim().split(/\s+/).map((t) => {
      const a = t.split(',').map(Number);
      return a.length >= 2 && isFinite(a[0]) && isFinite(a[1]) ? [a[1], a[0]] : null;
    }).filter(Boolean);
  }
  function openRing(r) {
    if (r.length > 3 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) return r.slice(0, -1);
    return r;
  }

  function parseKml(text) {
    const out = { polygons: [], lines: [], points: [], avisos: [] };
    const pms = text.match(/<Placemark[\s\S]*?<\/Placemark>/gi) || [];
    pms.forEach((pm, idx) => {
      const nm = pm.match(/<name>([\s\S]*?)<\/name>/i);
      const name = nm ? clean(nm[1]) : 'Elemento ' + (idx + 1);
      let m;
      const polyRe = /<Polygon[\s\S]*?<\/Polygon>/gi;
      while ((m = polyRe.exec(pm))) {
        const c = m[0].match(/<outerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/i);
        if (c) out.polygons.push({ name, ring: openRing(parseCoords(c[1])) });
      }
      const lineRe = /<LineString[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>[\s\S]*?<\/LineString>/gi;
      while ((m = lineRe.exec(pm))) out.lines.push({ name, path: parseCoords(m[1]) });
      if (!/<Polygon/i.test(pm)) {
        const ptRe = /<Point[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>[\s\S]*?<\/Point>/gi;
        while ((m = ptRe.exec(pm))) {
          const c = parseCoords(m[1])[0];
          if (c) out.points.push({ name, lat: c[0], lon: c[1] });
        }
      }
    });
    return out;
  }

  function parseModeler(json) {
    const out = { polygons: [], lines: [], points: [], avisos: [] };
    const pts = new Map();
    (json.puntos || []).forEach((p) => {
      if (!G.looksLikeGtm(p.e, p.n)) { out.avisos.push(`El punto ${p.nombre || p.id} no parece coordenada GTM de Guatemala; revísalo.`); }
      const ll = G.gtmToLl(p.e, p.n);
      pts.set(p.id, { name: p.nombre || String(p.id), lat: ll.lat, lon: ll.lon });
    });
    pts.forEach((p) => out.points.push(p));
    (json.lotes || []).forEach((l) => {
      const ring = (l.pts || []).map((id) => pts.get(id)).filter(Boolean).map((p) => [p.lat, p.lon]);
      if (ring.length >= 3) out.polygons.push({ name: l.nombre || 'Lote ' + l.id, ring });
    });
    return out;
  }

  function parseGeoJson(json) {
    const out = { polygons: [], lines: [], points: [], avisos: [] };
    const feats = json.type === 'FeatureCollection' ? json.features : json.type === 'Feature' ? [json] : [{ type: 'Feature', properties: {}, geometry: json }];
    feats.forEach((f, i) => {
      const g = f.geometry;
      const name = (f.properties && (f.properties.name || f.properties.nombre)) || 'Elemento ' + (i + 1);
      if (!g) return;
      const ll = (c) => [c[1], c[0]];
      if (g.type === 'Polygon') out.polygons.push({ name, ring: openRing(g.coordinates[0].map(ll)) });
      else if (g.type === 'MultiPolygon') g.coordinates.forEach((pg, k) => out.polygons.push({ name: name + ' ' + (k + 1), ring: openRing(pg[0].map(ll)) }));
      else if (g.type === 'LineString') out.lines.push({ name, path: g.coordinates.map(ll) });
      else if (g.type === 'Point') out.points.push({ name, lat: g.coordinates[1], lon: g.coordinates[0] });
    });
    return out;
  }

  function parseCsv(text) {
    const out = { polygons: [], lines: [], points: [], avisos: [] };
    const rows = text.split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
    rows.forEach((r, i) => {
      const c = r.split(/[,;\t]/).map((x) => x.trim());
      let la; let lo; let name;
      if (isFinite(c[0]) && isFinite(c[1])) { la = +c[0]; lo = +c[1]; name = 'P' + (out.points.length + 1); }
      else if (isFinite(c[1]) && isFinite(c[2])) { name = c[0]; la = +c[1]; lo = +c[2]; }
      else return; // encabezado u otra fila
      if (Math.abs(la) > 90 && Math.abs(lo) <= 90) { const t = la; la = lo; lo = t; }
      out.points.push({ name, lat: la, lon: lo });
    });
    return out;
  }

  /** Une los puntos (en el orden dado) en un polígono. */
  function ringFromPoints(points) {
    return points.map((p) => [p.lat, p.lon]);
  }

  /** text: contenido ya leído; ext: 'kml'|'json'|'geojson'|'csv' */
  function importText(text, ext) {
    ext = String(ext || '').toLowerCase();
    if (ext === 'kml') return parseKml(text);
    if (ext === 'csv' || ext === 'txt') return parseCsv(text);
    const json = JSON.parse(text);
    if (json.puntos || json.lotes) return parseModeler(json);
    return parseGeoJson(json);
  }

  const api = { parseKml, parseModeler, parseGeoJson, parseCsv, ringFromPoints, importText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CEI = Object.assign(root.CEI || {}, { imp: api });
})(typeof self !== 'undefined' ? self : this);
