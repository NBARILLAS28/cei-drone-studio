/* CEI Drone Studio — análisis de fotos tomadas: resumen, huecos y cobertura estimada del terreno */
(function (root) {
  'use strict';
  const G = (typeof require !== 'undefined' && typeof module !== 'undefined') ? require('./geo.js') : root.CEI.geo;

  /**
   * photos: [{lat,lon,rel,alt,f35,w,h,date,name}]
   * ringLL: terreno; plan: misión (opcional) para comparar
   */
  function analyze(photos, ringLL, plan, opts) {
    const o = Object.assign({ f35: 24, aspecto: [4, 3], altRef: 80, solapeFrontal: 0.8 }, opts || {});
    const geo = photos.filter((p) => p.lat != null && p.lon != null);
    const res = {
      total: photos.length, conGps: geo.length, sinGps: photos.length - geo.length,
      avisos: [],
    };
    if (!geo.length) { res.avisos.push('Ninguna foto trae posición GPS.'); return res; }

    const lat0 = geo.reduce((s, p) => s + p.lat, 0) / geo.length;
    const lon0 = geo.reduce((s, p) => s + p.lon, 0) / geo.length;
    const loc = G.makeLocal(lat0, lon0);
    const xy = geo.map((p) => Object.assign({}, loc.toXY(p.lat, p.lon), { p }));

    const rels = geo.map((p) => (p.rel != null ? p.rel : null)).filter((v) => v != null);
    const altMedia = rels.length ? rels.reduce((s, v) => s + v, 0) / rels.length : o.altRef;
    res.altRelMedia = altMedia;
    if (rels.length) {
      const mx = Math.max(...rels); const mn = Math.min(...rels);
      res.altRelRango = [mn, mx];
      if (mx - mn > 10) res.avisos.push(`La altura relativa varía ${(mx - mn).toFixed(0)} m entre fotos (${mn.toFixed(0)}–${mx.toFixed(0)} m). Incluye despegue y aterrizaje, o el vuelo no fue a altura constante.`);
    }

    // Distancia al vecino más cercano (O(n²) suficiente para cientos de fotos)
    const nn = xy.map((a, i) => {
      let best = Infinity;
      xy.forEach((b, j) => { if (i !== j) { const d = Math.hypot(a.x - b.x, a.y - b.y); if (d < best) best = d; } });
      return best;
    }).filter((d) => isFinite(d));
    nn.sort((a, b) => a - b);
    if (nn.length) {
      res.vecino = { min: nn[0], mediana: nn[Math.floor(nn.length / 2)], max: nn[nn.length - 1] };
      const med = res.vecino.mediana;
      res.huecos = xy.filter((a, i) => {
        // foto aislada: su vecino más cercano está a más de 2.2 veces la mediana
        let best = Infinity;
        xy.forEach((b, j) => { if (i !== j) { const d = Math.hypot(a.x - b.x, a.y - b.y); if (d < best) best = d; } });
        return best > med * 2.2;
      }).map((a) => a.p.name);
      if (res.huecos.length) res.avisos.push(`${res.huecos.length} foto(s) quedan aisladas: posible hueco en el vuelo.`);
    }

    // Huella aproximada (círculo conservador) y cobertura del terreno
    const [aw, ah] = o.aspecto;
    const diag = Math.hypot(aw, ah);
    const w35 = 43.27 * (aw / diag);
    const h35 = 43.27 * (ah / diag);
    const f35 = geo.find((p) => p.f35)?.f35 || o.f35;
    res.f35 = f35;
    const fpA = (altMedia * w35) / f35;
    const fpB = (altMedia * h35) / f35;
    const radio = Math.min(fpA, fpB) / 2;
    res.huella = { across: fpA, along: fpB, radio };

    if (ringLL && ringLL.length >= 3) {
      const ring = ringLL.map((p) => loc.toXY(p[0], p[1]));
      const area = Math.abs(G.signedArea(ring));
      const paso = Math.max(2, Math.sqrt(area / 6000));
      let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
      ring.forEach((p) => { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); });
      let dentro = 0; let cubiertas = 0; let cubiertas3 = 0;
      for (let x = minX + paso / 2; x < maxX; x += paso) {
        for (let y = minY + paso / 2; y < maxY; y += paso) {
          if (!G.pointInRing({ x, y }, ring)) continue;
          dentro++;
          let n = 0;
          for (let k = 0; k < xy.length && n < 3; k++) {
            if (Math.hypot(xy[k].x - x, xy[k].y - y) <= radio) n++;
          }
          if (n >= 1) cubiertas++;
          if (n >= 3) cubiertas3++;
        }
      }
      res.cobertura = dentro ? cubiertas / dentro : null; // aparece en al menos 1 foto
      res.cobertura3 = dentro ? cubiertas3 / dentro : null; // aparece en 3 o más fotos (lo que pide la fotogrametría)
      if (res.cobertura != null && res.cobertura < 0.98) {
        res.avisos.push(`Solo ${(res.cobertura * 100).toFixed(0)} % del terreno aparece en alguna foto. Faltan líneas de vuelo.`);
      } else if (res.cobertura3 != null && res.cobertura3 < 0.9) {
        res.avisos.push(`Solo ${(res.cobertura3 * 100).toFixed(0)} % del terreno aparece en 3 o más fotos; el modelo puede salir con huecos o deformado.`);
      }
    }
    if (plan && plan.stats) {
      res.fotosPlan = plan.stats.fotos;
      if (geo.length < plan.stats.fotos * 0.9) res.avisos.push(`Se esperaban unas ${plan.stats.fotos} fotos y hay ${geo.length}.`);
    }
    return res;
  }

  const api = { analyze };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CEI = Object.assign(root.CEI || {}, { fotos: api });
})(typeof self !== 'undefined' ? self : this);
