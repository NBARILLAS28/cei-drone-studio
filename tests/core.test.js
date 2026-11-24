'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const G = require('../js/geo.js');
const Z = require('../js/zip.js');
const M = require('../js/mission.js');
const X = require('../js/export.js');
const E = require('../js/exif.js');
const I = require('../js/importers.js');
const F = require('../js/fotos.js');
const A = require('../js/adapters.js');
const PYREF = [499256.80613548664, 1618268.685003403];

// Terreno rectangular ~120 x 70 m cerca de Chimaltenango
function rect(lat0, lon0, w, h) {
  const loc = G.makeLocal(lat0, lon0);
  return [[0, 0], [w, 0], [w, h], [0, h]].map(([x, y]) => { const p = loc.toLL(x, y); return [p.lat, p.lon]; });
}
const RING = rect(14.6611, -90.8197, 120, 70);

const [PYE, PYN] = PYREF;
test('GTM coincide con pyproj (valores de referencia) y vuelve al origen', () => {
  const r = G.llToGtm(14.6349, -90.5069);
  // pyproj: tmerc lon0=-90.5 k0=0.9998 fe=500000
  assert.ok(Math.abs(r.e - PYE) < 0.001 && Math.abs(r.n - PYN) < 0.001, `E ${r.e} N ${r.n}`);
  const b = G.gtmToLl(r.e, r.n);
  assert.ok(Math.abs(b.lat - 14.6349) < 1e-9 && Math.abs(b.lon + 90.5069) < 1e-9);
});

test('GSD a 80 m con cámara de 24 mm equivalente y 4000 px ≈ 2.9 cm', () => {
  const cam = M.cameraAt(M.DRONES.mini4pro, '12', 80);
  assert.ok(Math.abs(cam.gsd * 100 - 2.885) < 0.01, String(cam.gsd));
  assert.ok(Math.abs(cam.fpAcross - 115.4) < 0.1);
  assert.ok(Math.abs(cam.fpAlong - 86.5) < 0.1);
});

test('planMission genera líneas, puntos y respeta el área', () => {
  const plan = M.planMission(RING, { drone: 'mini4pro', alt: 80, velocidad: 4 }, null);
  assert.ok(plan.ok, plan.warnings.join(' '));
  assert.ok(plan.stats.fotos > 4);
  assert.ok(plan.stats.lineas >= 1);
  // espaciado entre líneas coincide con huella * (1 - solape)
  assert.ok(Math.abs(plan.cam.lineSpacingMax - 115.4 * 0.3) < 0.2);
  assert.ok(plan.cam.lineSpacing <= plan.cam.lineSpacingMax * 1.05); // tolerancia de 5 % para no añadir una línea por centímetros
  // áreas
  assert.ok(Math.abs(plan.stats.areaM2 - 120 * 70) < 20, String(plan.stats.areaM2));
  // cada punto está dentro del terreno ampliado por la extensión
  const ext = plan.cam.photoSpacingNominal + 1;
  plan.points.forEach((p) => {
    assert.ok(p.x > -ext - 60 && p.x < 200, 'x fuera');
  });
  // los extremos marcan inicio/fin por segmento
  const ends = plan.points.filter((p) => p.fin);
  assert.equal(ends.length, plan.stats.segmentos * 2);
});

test('el espaciado real entre fotos no supera el nominal', () => {
  const plan = M.planMission(RING, { alt: 60, velocidad: 3 }, null);
  assert.ok(plan.cam.photoSpacing <= plan.cam.photoSpacingNominal + 1e-6);
});

test('advierte si la velocidad rompe el intervalo mínimo', () => {
  const plan = M.planMission(RING, { alt: 60, velocidad: 12 }, null);
  assert.ok(plan.warnings.some((w) => /al menos/.test(w)));
});

test('una misión larga se divide en varias baterías sin perder puntos', () => {
  const big = rect(14.6611, -90.8197, 400, 300);
  const plan = M.planMission(big, { alt: 60, velocidad: 5, utilMin: 8 }, [14.6611, -90.8197]);
  assert.ok(plan.ok);
  assert.ok(plan.sorties.length > 1, 'sorties ' + plan.sorties.length);
  const total = plan.sorties.reduce((s, x) => s + x.photos, 0);
  assert.equal(total, plan.points.length);
  // las salidas son contiguas
  for (let i = 1; i < plan.sorties.length; i++) assert.equal(plan.sorties[i].from, plan.sorties[i - 1].to + 1);
  const sub = M.slicePlan(plan, plan.sorties[1].from, plan.sorties[1].to);
  assert.equal(sub.points[0].fin, 'inicio');
  assert.equal(sub.points[sub.points.length - 1].fin, 'fin');
});

test('polígono cóncavo (L) genera segmentos solo dentro de la figura', () => {
  const loc = G.makeLocal(14.6611, -90.8197);
  const L = [[0, 0], [150, 0], [150, 40], [50, 40], [50, 120], [0, 120]].map(([x, y]) => { const p = loc.toLL(x, y); return [p.lat, p.lon]; });
  const plan = M.planMission(L, { alt: 70, velocidad: 4, angulo: 90 }, null);
  assert.ok(plan.ok);
  assert.ok(plan.stats.segmentos >= plan.stats.lineas, 'segmentos');
  assert.ok(Math.abs(plan.stats.areaM2 - (150 * 40 + 50 * 80)) < 30);
});

test('KMZ: ZIP válido con template.kml y waylines.wpml, y se puede releer', async () => {
  const plan = M.planMission(RING, { alt: 80, velocidad: 4 }, null);
  const bytes = X.buildKmz(plan, { alt: 80, velocidad: 4, droneEnum: 68 });
  fs.writeFileSync('/tmp/prueba.kmz', bytes);
  const files = await Z.unzip(bytes);
  assert.deepEqual(files.map((f) => f.name).sort(), ['wpmz/template.kml', 'wpmz/waylines.wpml']);
  const wl = new TextDecoder().decode(files.find((f) => f.name.endsWith('.wpml')).data);
  assert.equal((wl.match(/<Placemark>/g) || []).length, plan.points.length);
  assert.equal((wl.match(/takePhoto/g) || []).length, plan.points.length);
  assert.ok(wl.includes('http://www.uav.com/wpmz/1.0.2'));
  assert.ok(wl.includes('<wpml:droneEnumValue>68</wpml:droneEnumValue>'));
  assert.equal((wl.match(/>gimbalRotate</g) || []).length, 1); // solo en el primer punto
});

test('CSV de Litchi: todas las filas tienen las mismas columnas que el encabezado', () => {
  const plan = M.planMission(RING, { alt: 80, velocidad: 4 }, null);
  const csv = X.buildLitchiCsv(plan, { alt: 80, velocidad: 4 }).trim().split('\n');
  const n = csv[0].split(',').length;
  assert.equal(n, 46);
  csv.forEach((r) => assert.equal(r.split(',').length, n));
  assert.equal(csv.length - 1, plan.points.filter((p) => p.fin).length);
});

test('KML exportado se vuelve a importar con el mismo polígono', () => {
  const kml = X.buildKml('Prueba', { ring: RING, vertices: true, takeoff: [14.66, -90.82] });
  const r = I.parseKml(kml);
  assert.equal(r.polygons.length, 1);
  assert.equal(r.polygons[0].ring.length, 4);
  assert.ok(Math.abs(r.polygons[0].ring[2][0] - RING[2][0]) < 1e-7);
  assert.ok(r.points.length >= 5);
});

test('importa KML estilo My ArQ solo con puntos', () => {
  const kml = `<kml><Document><Placemark><name>P1</name><Point><coordinates>-90.8197,14.6611,0</coordinates></Point></Placemark>
  <Placemark><name><![CDATA[P2]]></name><Point><coordinates>-90.8190,14.6611,0</coordinates></Point></Placemark></Document></kml>`;
  const r = I.parseKml(kml);
  assert.equal(r.points.length, 2);
  assert.equal(r.points[1].name, 'P2');
  assert.equal(I.ringFromPoints(r.points).length, 2);
});

test('importa .json de Modeler My ArQ (GTM) y lo convierte a lat/lon', () => {
  const a = G.llToGtm(14.6611, -90.8197);
  const json = {
    formato: 'modeler-my-arq', version: 1, nombre: 'Prueba',
    puntos: [
      { id: 1, nombre: 'P1', e: a.e, n: a.n }, { id: 2, nombre: 'P2', e: a.e + 100, n: a.n },
      { id: 3, nombre: 'P3', e: a.e + 100, n: a.n + 50 }, { id: 4, nombre: 'P4', e: a.e, n: a.n + 50 },
    ],
    lotes: [{ id: 1, nombre: 'Lote A', pts: [1, 2, 3, 4] }],
  };
  const r = I.importText(JSON.stringify(json), 'json');
  assert.equal(r.polygons.length, 1);
  assert.ok(Math.abs(r.polygons[0].ring[0][0] - 14.6611) < 1e-8);
  assert.equal(r.avisos.length, 0);
  const info = G.ringInfo(r.polygons[0].ring);
  assert.ok(Math.abs(info.area - 5000) < 5, String(info.area));
});

test('EXIF: lee GPS, lente, tamaño y XMP de DJI de JPEG reales generados con PIL', () => {
  const dir = path.join(__dirname, 'fixtures');
  const read = (n) => { const b = fs.readFileSync(path.join(dir, n)); return E.parseJpeg(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
  const a = read('foto1.jpg');
  assert.ok(Math.abs(a.lat - 14.6611) < 1e-5, String(a.lat));
  assert.ok(Math.abs(a.lon + 90.8197) < 1e-5, String(a.lon));
  assert.equal(a.f35, 24);
  assert.equal(a.w, 4000);
  assert.equal(a.make, 'DJI');
  assert.ok(Math.abs(a.rel - 80.04) < 1e-6);
  assert.ok(Math.abs(a.pitch + 90) < 1e-6);
  assert.ok(Math.abs(a.alt - 1800.5) < 0.01);
  const s = read('sin_gps.jpg');
  assert.equal(s.lat, undefined);
  assert.throws(() => E.parseJpeg(new Uint8Array([1, 2, 3, 4]).buffer));
});

test('análisis de fotos: cobertura alta en una cuadrícula que cubre el terreno', () => {
  const big = rect(14.6611, -90.8197, 300, 220);
  const plan = M.planMission(big, { alt: 80, velocidad: 4 }, null);
  const photos = plan.points.map((p, i) => ({ name: 'F' + i, lat: p.lat, lon: p.lon, rel: 80, f35: 24 }));
  const r = F.analyze(photos, big, plan, { f35: 24 });
  assert.ok(r.cobertura > 0.98, String(r.cobertura));
  assert.ok(r.cobertura3 > 0.9, String(r.cobertura3));
  // quitar tres líneas seguidas deja un hueco que la huella de las vecinas no alcanza a cubrir
  const sin = photos.filter((_, i) => ![2, 3, 4].includes(plan.points[i].line));
  const r2 = F.analyze(sin, big, plan, { f35: 24 });
  assert.ok(r2.cobertura < 0.9, String(r2.cobertura));
  assert.ok(r2.avisos.some((a) => /aparece en alguna foto/.test(a)));
});

test('adaptadores: Mini 4 Pro recomienda KMZ; Mini 3 Pro recomienda Litchi; planificados no construyen', () => {
  assert.equal(M.DRONES.mini4pro.recomendado, 'dji-fly-kmz');
  assert.equal(M.DRONES.mini3pro.recomendado, 'litchi-csv');
  assert.ok(!A.forDrone('mini3pro').some((a) => a.id === 'dji-fly-kmz'));
  assert.throws(() => A.ADAPTERS.mavlink.build());
  const plan = M.planMission(RING, { alt: 80, velocidad: 4 }, null);
  const f = A.ADAPTERS.kml.build(plan, { nombre: 'Casa Pastora', alt: 80, ring: RING });
  assert.equal(f.length, 2);
  assert.equal(f[0].name, 'casa-pastora-mision.kml');
});
