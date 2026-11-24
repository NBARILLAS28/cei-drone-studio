/* CEI Drone Studio — geodesia básica (sin dependencias)
 * - GTM (Guatemala Transversal Mercator) <-> WGS84, serie de Krüger
 * - Plano local en metros (x = este, y = norte) para áreas pequeñas
 * - Utilidades de polígonos
 */
(function (root) {
  'use strict';

  const RAD = Math.PI / 180;
  const DEG = 180 / Math.PI;

  // WGS84
  const A = 6378137;
  const F = 1 / 298.257223563;
  const N = F / (2 - F);
  const E1 = Math.sqrt(F * (2 - F));
  const AA = (A / (1 + N)) * (1 + (N * N) / 4 + Math.pow(N, 4) / 64);

  // GTM: tmerc lat0=0, lon0=-90.5, k0=0.9998, FE=500000, FN=0
  const GTM = { lon0: -90.5, k0: 0.9998, fe: 500000, fn: 0 };

  const ALPHA = [
    N / 2 - (2 * N * N) / 3 + (5 * Math.pow(N, 3)) / 16 + (41 * Math.pow(N, 4)) / 180,
    (13 * N * N) / 48 - (3 * Math.pow(N, 3)) / 5 + (557 * Math.pow(N, 4)) / 1440,
    (61 * Math.pow(N, 3)) / 240 - (103 * Math.pow(N, 4)) / 140,
    (49561 * Math.pow(N, 4)) / 161280,
  ];
  const BETA = [
    N / 2 - (2 * N * N) / 3 + (37 * Math.pow(N, 3)) / 96 - Math.pow(N, 4) / 360,
    (N * N) / 48 + Math.pow(N, 3) / 15 - (437 * Math.pow(N, 4)) / 1440,
    (17 * Math.pow(N, 3)) / 480 - (37 * Math.pow(N, 4)) / 840,
    (4397 * Math.pow(N, 4)) / 161280,
  ];
  const DELTA = [
    2 * N - (2 * N * N) / 3 - 2 * Math.pow(N, 3) + (116 * Math.pow(N, 4)) / 45,
    (7 * N * N) / 3 - (8 * Math.pow(N, 3)) / 5 - (227 * Math.pow(N, 4)) / 45,
    (56 * Math.pow(N, 3)) / 15 - (136 * Math.pow(N, 4)) / 35,
    (4279 * Math.pow(N, 4)) / 630,
  ];

  function llToGtm(lat, lon) {
    const phi = lat * RAD;
    const dl = (lon - GTM.lon0) * RAD;
    const s = Math.sin(phi);
    const t = Math.sinh(Math.atanh(s) - E1 * Math.atanh(E1 * s));
    const xi0 = Math.atan2(t, Math.cos(dl));
    const eta0 = Math.atanh(Math.sin(dl) / Math.sqrt(1 + t * t));
    let xi = xi0;
    let eta = eta0;
    for (let j = 1; j <= 4; j++) {
      xi += ALPHA[j - 1] * Math.sin(2 * j * xi0) * Math.cosh(2 * j * eta0);
      eta += ALPHA[j - 1] * Math.cos(2 * j * xi0) * Math.sinh(2 * j * eta0);
    }
    return { e: GTM.fe + GTM.k0 * AA * eta, n: GTM.fn + GTM.k0 * AA * xi };
  }

  function gtmToLl(e, n) {
    const xi0 = (n - GTM.fn) / (GTM.k0 * AA);
    const eta0 = (e - GTM.fe) / (GTM.k0 * AA);
    let xi = xi0;
    let eta = eta0;
    for (let j = 1; j <= 4; j++) {
      xi -= BETA[j - 1] * Math.sin(2 * j * xi0) * Math.cosh(2 * j * eta0);
      eta -= BETA[j - 1] * Math.cos(2 * j * xi0) * Math.sinh(2 * j * eta0);
    }
    const chi = Math.asin(Math.sin(xi) / Math.cosh(eta));
    let phi = chi;
    for (let j = 1; j <= 4; j++) phi += DELTA[j - 1] * Math.sin(2 * j * chi);
    const lam = GTM.lon0 * RAD + Math.atan2(Math.sinh(eta), Math.cos(xi));
    return { lat: phi * DEG, lon: lam * DEG };
  }

  /** ¿Parece una coordenada GTM de Guatemala? */
  function looksLikeGtm(e, n) {
    return e > 100000 && e < 900000 && n > 1400000 && n < 2100000;
  }

  /** Plano local tangente: x este, y norte, en metros. */
  function makeLocal(lat0, lon0) {
    const p = lat0 * RAD;
    const mLat = 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p) - 0.0023 * Math.cos(6 * p);
    const mLon = 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p) + 0.118 * Math.cos(5 * p);
    return {
      lat0, lon0, mLat, mLon,
      toXY: (lat, lon) => ({ x: (lon - lon0) * mLon, y: (lat - lat0) * mLat }),
      toLL: (x, y) => ({ lat: lat0 + y / mLat, lon: lon0 + x / mLon }),
    };
  }

  function haversine(lat1, lon1, lat2, lon2) {
    const dLat = (lat2 - lat1) * RAD;
    const dLon = (lon2 - lon1) * RAD;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371008.8 * Math.asin(Math.sqrt(a));
  }

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  /** Área con signo (shoelace) de un anillo [{x,y}] */
  function signedArea(ring) {
    let s = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i];
      const q = ring[(i + 1) % ring.length];
      s += p.x * q.y - q.x * p.y;
    }
    return s / 2;
  }

  function pointInRing(pt, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }

  /** Anillo [[lat,lon],...] -> utilidades. */
  function ringInfo(ringLL) {
    if (!ringLL || ringLL.length < 3) return null;
    let sLat = 0;
    let sLon = 0;
    ringLL.forEach((p) => { sLat += p[0]; sLon += p[1]; });
    const loc = makeLocal(sLat / ringLL.length, sLon / ringLL.length);
    const xy = ringLL.map((p) => loc.toXY(p[0], p[1]));
    const area = Math.abs(signedArea(xy));
    let per = 0;
    for (let i = 0; i < xy.length; i++) per += dist(xy[i], xy[(i + 1) % xy.length]);
    const lats = ringLL.map((p) => p[0]);
    const lons = ringLL.map((p) => p[1]);
    return {
      loc, xy, area, perimeter: per,
      bbox: { minLat: Math.min(...lats), maxLat: Math.max(...lats), minLon: Math.min(...lons), maxLon: Math.max(...lons) },
      center: { lat: loc.lat0, lon: loc.lon0 },
    };
  }

  const api = {
    RAD, DEG, GTM, llToGtm, gtmToLl, looksLikeGtm, makeLocal, haversine, dist,
    signedArea, pointInRing, ringInfo,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CEI = Object.assign(root.CEI || {}, { geo: api });
})(typeof self !== 'undefined' ? self : this);
