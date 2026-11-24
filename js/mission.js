/* CEI Drone Studio — planificador de misión de mapeo (líneas paralelas tipo "serpiente")
 * Independiente de la marca: trabaja con distancia focal equivalente a 35 mm y tamaño de imagen.
 * Las cifras de cámara son valores iniciales editables: verifica con la ficha del fabricante
 * o con una foto real (FocalLengthIn35mmFilm del EXIF).
 */
(function (root) {
  'use strict';
  const G = (typeof require !== 'undefined' && typeof module !== 'undefined') ? require('./geo.js') : root.CEI.geo;

  const DIAG_35 = 43.27; // diagonal del fotograma de 35 mm, mm

  /** Perfiles de dron. Los datos de cámara son aproximados y editables en la interfaz. */
  const DRONES = {
    mini4pro: {
      id: 'mini4pro', nombre: 'DJI Mini 4 Pro', marca: 'DJI',
      f35: 24, aspecto: [4, 3], imagenes: { '12': [4000, 3000], '48': [8064, 6048] },
      intervaloMin: { '12': 2, '48': 5 }, bateriaMin: 34, droneEnum: 68,
      adaptadores: ['dji-fly-kmz', 'litchi-csv', 'kml'], recomendado: 'dji-fly-kmz',
      nota: 'Acepta misiones de waypoints en DJI Fly (KMZ) y también en apps con SDK (Android).',
    },
    mini3pro: {
      id: 'mini3pro', nombre: 'DJI Mini 3 Pro', marca: 'DJI',
      f35: 24, aspecto: [4, 3], imagenes: { '12': [4000, 3000], '48': [8064, 6048] },
      intervaloMin: { '12': 2, '48': 5 }, bateriaMin: 34, droneEnum: null,
      adaptadores: ['litchi-csv', 'kml'], recomendado: 'litchi-csv',
      nota: 'No tiene misiones de waypoints propias en DJI Fly: se vuela con una app con SDK en Android (por ejemplo Litchi Pilot).',
    },
    mini3: {
      id: 'mini3', nombre: 'DJI Mini 3', marca: 'DJI',
      f35: 24, aspecto: [4, 3], imagenes: { '12': [4000, 3000], '48': [8064, 6048] },
      intervaloMin: { '12': 2, '48': 5 }, bateriaMin: 38, droneEnum: null,
      adaptadores: ['litchi-csv', 'kml'], recomendado: 'litchi-csv',
      nota: 'No tiene misiones de waypoints propias en DJI Fly: se vuela con una app con SDK en Android.',
    },
    generico: {
      id: 'generico', nombre: 'Otro dron (genérico)', marca: 'Otra',
      f35: 24, aspecto: [4, 3], imagenes: { '12': [4000, 3000], '20': [5472, 3648] },
      intervaloMin: { '12': 2, '20': 2 }, bateriaMin: 25, droneEnum: null,
      adaptadores: ['kml'], recomendado: 'kml',
      nota: 'Define cámara y batería a mano. Exporta KML/CSV para usar en otro programa de vuelo.',
    },
  };

  const DEFAULTS = {
    drone: 'mini4pro', res: '12', alt: 80, solapeFrontal: 0.8, solapeLateral: 0.7,
    velocidad: 5, angulo: 'auto', extension: null, utilMin: 18, giroS: 3,
    f35: null, // null = usar el del perfil
  };

  function cameraAt(drone, res, alt, f35override) {
    const f35 = f35override || drone.f35;
    const [aw, ah] = drone.aspecto;
    const diag = Math.hypot(aw, ah);
    const w35 = DIAG_35 * (aw / diag);
    const h35 = DIAG_35 * (ah / diag);
    const [iw, ih] = drone.imagenes[res] || Object.values(drone.imagenes)[0];
    const gsd = (alt * w35) / (f35 * iw); // m/px
    return {
      iw, ih, f35, gsd,
      fpAcross: (alt * w35) / f35, // ancho de huella perpendicular a la línea de vuelo (lado largo)
      fpAlong: (alt * h35) / f35, // largo de huella a lo largo de la línea
    };
  }

  function rotFns(thetaDeg) {
    const t = thetaDeg * G.RAD;
    const s = Math.sin(t);
    const c = Math.cos(t);
    return {
      toUV: (p) => ({ u: p.x * s + p.y * c, v: p.x * c - p.y * s }),
      toXY: (u, v) => ({ x: u * s + v * c, y: u * c - v * s }),
    };
  }

  function extentV(xy, theta) {
    const { toUV } = rotFns(theta);
    let minV = Infinity; let maxV = -Infinity; let minU = Infinity; let maxU = -Infinity;
    xy.forEach((p) => {
      const q = toUV(p);
      if (q.v < minV) minV = q.v; if (q.v > maxV) maxV = q.v;
      if (q.u < minU) minU = q.u; if (q.u > maxU) maxU = q.u;
    });
    return { minV, maxV, minU, maxU, w: maxV - minV, l: maxU - minU };
  }

  function bestAngle(xy) {
    let best = null;
    for (let a = 0; a < 180; a += 5) {
      const e = extentV(xy, a);
      if (!best || e.w < best.w - 0.5 || (Math.abs(e.w - best.w) <= 0.5 && e.l > best.l)) best = { a, w: e.w, l: e.l };
    }
    return best.a;
  }

  /** Intersecta la línea v=const con el polígono (UV). Devuelve pares [u0,u1] ordenados. */
  function scanSegments(uv, v) {
    const us = [];
    for (let i = 0; i < uv.length; i++) {
      const a = uv[i];
      const b = uv[(i + 1) % uv.length];
      if ((a.v <= v && v < b.v) || (b.v <= v && v < a.v)) {
        us.push(a.u + ((v - a.v) / (b.v - a.v)) * (b.u - a.u));
      }
    }
    us.sort((p, q) => p - q);
    const segs = [];
    for (let i = 0; i + 1 < us.length; i += 2) if (us[i + 1] - us[i] > 0.5) segs.push([us[i], us[i + 1]]);
    return segs;
  }

  /**
   * ringLL: [[lat,lon],...]; opts: ver DEFAULTS; takeoff: [lat,lon] | null
   */
  function planMission(ringLL, optsIn, takeoffLL) {
    const o = Object.assign({}, DEFAULTS, optsIn || {});
    const drone = DRONES[o.drone] || DRONES.generico;
    const warnings = [];
    const info = G.ringInfo(ringLL);
    if (!info) return { ok: false, warnings: ['Dibuja o importa un terreno con al menos 3 puntos.'] };

    const cam = cameraAt(drone, o.res, o.alt, o.f35);
    const lineSpacing = cam.fpAcross * (1 - o.solapeLateral);
    const photoSpacingNominal = cam.fpAlong * (1 - o.solapeFrontal);
    if (lineSpacing < 1 || photoSpacingNominal < 0.5) {
      return { ok: false, warnings: ['Los solapes y la altura dan una separación demasiado pequeña. Sube la altura o baja el solape.'] };
    }
    const ext = o.extension == null ? photoSpacingNominal : Number(o.extension);

    const xy = info.xy;
    const theta = o.angulo === 'auto' || o.angulo == null ? bestAngle(xy) : Number(o.angulo);
    const { toUV, toXY } = rotFns(theta);
    const uv = xy.map(toUV);
    const e = extentV(xy, theta);
    const ancho = e.maxV - e.minV;
    const nLines = Math.max(1, Math.ceil(ancho / lineSpacing - 0.05));
    const lineReal = ancho / nLines; // reparte las líneas parejo; nunca queda más separado que el máximo permitido

    const segments = [];
    for (let k = 0; k < nLines; k++) {
      const v = e.minV + lineReal / 2 + k * lineReal;
      let segs = scanSegments(uv, v);
      const forward = k % 2 === 0;
      segs = forward ? segs : segs.slice().reverse();
      segs.forEach((s) => {
        const u0 = s[0] - ext;
        const u1 = s[1] + ext;
        segments.push({ line: k, v, forward, u0, u1 });
      });
    }
    if (!segments.length) return { ok: false, warnings: ['No se pudo generar ninguna línea de vuelo dentro del terreno.'] };

    // Puntos de foto por segmento, en sentido de vuelo.
    const points = [];
    const segInfo = [];
    segments.forEach((sg, si) => {
      const L = sg.u1 - sg.u0;
      const n = Math.max(1, Math.ceil(L / photoSpacingNominal)) + 1;
      const step = L / (n - 1);
      const first = points.length;
      for (let i = 0; i < n; i++) {
        const idx = sg.forward ? i : n - 1 - i;
        const u = sg.u0 + idx * step;
        const p = toXY(u, sg.v);
        const ll = info.loc.toLL(p.x, p.y);
        points.push({
          x: p.x, y: p.y, lat: ll.lat, lon: ll.lon, line: sg.line, seg: si,
          fin: i === 0 ? 'inicio' : i === n - 1 ? 'fin' : null,
        });
      }
      segInfo.push({ seg: si, line: sg.line, first, last: points.length - 1, length: L, spacing: step });
    });

    const spacingReal = segInfo.reduce((m, s) => Math.max(m, s.spacing), 0);
    const intervalo = spacingReal / o.velocidad;
    const minInt = (drone.intervaloMin && drone.intervaloMin[o.res]) || 2;
    const velMax = spacingReal / minInt;
    if (intervalo < minInt) {
      warnings.push(`A ${o.velocidad} m/s tomaría una foto cada ${intervalo.toFixed(1)} s y el dron necesita al menos ${minInt} s. Baja la velocidad a ${velMax.toFixed(1)} m/s o menos.`);
    }
    if (o.alt > 120) warnings.push('La altura supera 120 m: revisa la normativa local vigente antes de volar.');
    if (points.length > 400) warnings.push(`La misión tiene ${points.length} puntos. Considera dividirla por batería.`);

    // Distancia y tiempo
    const take = takeoffLL ? info.loc.toXY(takeoffLL[0], takeoffLL[1]) : null;
    const legTime = (a, b) => G.dist(a, b) / o.velocidad;
    function sortieTime(i0, i1) {
      let d = 0;
      let turns = 0;
      for (let i = i0 + 1; i <= i1; i++) {
        d += G.dist(points[i - 1], points[i]);
        if (points[i].seg !== points[i - 1].seg) turns++;
      }
      const legs = take ? G.dist(take, points[i0]) + G.dist(points[i1], take) : 0;
      return { dist: d + legs, seconds: (d + legs) / o.velocidad + turns * o.giroS, turns };
    }

    // Salidas (una por batería), cortando entre segmentos.
    const utilS = o.utilMin * 60;
    const sorties = [];
    let start = 0;
    let si = 0;
    while (si < segInfo.length) {
      let endSeg = si;
      let t = sortieTime(segInfo[si].first, segInfo[si].last);
      while (endSeg + 1 < segInfo.length) {
        const t2 = sortieTime(segInfo[si].first, segInfo[endSeg + 1].last);
        if (t2.seconds > utilS) break;
        t = t2;
        endSeg++;
      }
      const i0 = segInfo[si].first;
      const i1 = segInfo[endSeg].last;
      sorties.push({ from: i0, to: i1, photos: i1 - i0 + 1, minutes: t.seconds / 60, dist: t.dist });
      si = endSeg + 1;
      start = i1 + 1;
    }
    if (sorties.some((s) => s.minutes > o.utilMin + 0.01)) {
      warnings.push('Una sola línea de vuelo excede el tiempo útil de batería. Sube la altura o la velocidad.');
    }
    const whole = sortieTime(0, points.length - 1);

    return {
      ok: true, warnings, theta, opciones: o, drone: drone.id,
      cam: Object.assign({}, cam, { lineSpacing: lineReal, lineSpacingMax: lineSpacing, photoSpacing: spacingReal, photoSpacingNominal }),
      points, segInfo, sorties, loc: info.loc, ringXY: xy,
      stats: {
        areaM2: info.area, areaHa: info.area / 10000, perimetro: info.perimeter,
        lineas: nLines, segmentos: segInfo.length, fotos: points.length,
        distanciaM: whole.dist, minutos: whole.seconds / 60, baterias: sorties.length,
        gsdCm: cam.gsd * 100, intervaloS: intervalo, velMax, tomaFinal: take,
      },
    };
  }

  /** Subplan con los puntos from..to (para exportar una batería) */
  function slicePlan(plan, from, to) {
    const pts = plan.points.slice(from, to + 1).map((p, i, arr) => {
      const prev = arr[i - 1];
      const next = arr[i + 1];
      const startSeg = !prev || prev.seg !== p.seg;
      const endSeg = !next || next.seg !== p.seg;
      return Object.assign({}, p, { fin: startSeg ? 'inicio' : endSeg ? 'fin' : null });
    });
    return Object.assign({}, plan, { points: pts });
  }

  const api = { DRONES, DEFAULTS, cameraAt, planMission, slicePlan, bestAngle };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CEI = Object.assign(root.CEI || {}, { mission: api });
})(typeof self !== 'undefined' ? self : this);
