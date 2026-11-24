/* CEI Drone Studio — adaptadores por marca/formato
 * El núcleo (terrenos, misión, fotos) no sabe de marcas. Cada adaptador declara qué sabe hacer
 * (caps) y cómo convertir una misión neutra a lo que entiende cada app o dron.
 * estado: 'listo' | 'planificado'
 */
(function (root) {
  'use strict';
  const X = (typeof require !== 'undefined' && typeof module !== 'undefined') ? require('./export.js') : root.CEI.exp;
  const M = (typeof require !== 'undefined' && typeof module !== 'undefined') ? require('./mission.js') : root.CEI.mission;

  const slug = (s) => String(s || 'mision').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'mision';

  const ADAPTERS = {
    'dji-fly-kmz': {
      id: 'dji-fly-kmz', nombre: 'DJI Fly (archivo KMZ)', estado: 'listo',
      caps: { planificar: true, exportarMision: true, controlEnVivo: false, importarFotos: true },
      plataformas: 'iPhone, Android o control con pantalla',
      archivo: 'KMZ',
      pasos: [
        'En DJI Fly crea una ruta de waypoints con 2 o 3 puntos y guárdala.',
        'Conecta el teléfono o el control a la computadora y busca la carpeta de rutas de DJI Fly (en Android: Android/data/dji.go.v5/files/waypoint).',
        'Respalda el .kmz de esa ruta y reemplázalo por el archivo de Drone Studio con el mismo nombre.',
        'Cierra DJI Fly por completo, ábrelo de nuevo y carga la ruta guardada.',
        'Antes de volar la misión completa, prueba una versión corta en un lugar abierto.',
      ],
      advertencia: 'DJI no ofrece este método de importación y una actualización de DJI Fly podría romperlo. Las alturas van relativas al punto de despegue.',
      build(plan, ctx) {
        const bytes = X.buildKmz(plan, ctx);
        return [{ name: `${slug(ctx.nombre)}${ctx.sufijo || ''}.kmz`, mime: 'application/vnd.google-earth.kmz', data: bytes }];
      },
    },
    'litchi-csv': {
      id: 'litchi-csv', nombre: 'Litchi (CSV para Mission Hub)', estado: 'listo',
      caps: { planificar: true, exportarMision: true, controlEnVivo: false, importarFotos: true },
      plataformas: 'Android (Litchi Pilot) para Mini 3, Mini 3 Pro y Mini 4 Pro',
      archivo: 'CSV',
      pasos: [
        'Abre Litchi Mission Hub (flylitchi.com/hub) e importa el CSV (Missions → Import).',
        'Revisa los ajustes globales: modo de rumbo, acción al terminar y velocidad (el CSV no los guarda).',
        'Sincroniza la misión con la app y vuela con Litchi Pilot en Android.',
      ],
      advertencia: 'Litchi Pilot funciona solo en Android. Las fotos salen por distancia entre extremos de línea; verifica el intervalo antes de despegar.',
      build(plan, ctx) {
        return [{ name: `${slug(ctx.nombre)}${ctx.sufijo || ''}-litchi.csv`, mime: 'text/csv', data: X.buildLitchiCsv(plan, ctx) }];
      },
    },
    kml: {
      id: 'kml', nombre: 'KML y CSV (cualquier programa)', estado: 'listo',
      caps: { planificar: true, exportarMision: true, controlEnVivo: false, importarFotos: true },
      plataformas: 'Cualquiera: My ArQ, Modeler My ArQ, Google Earth, QGIS',
      archivo: 'KML + CSV',
      pasos: ['Abre el KML en Modeler My ArQ, Google Earth o QGIS.', 'Usa el CSV para llevar los puntos a otro programa de vuelo.'],
      advertencia: '',
      build(plan, ctx) {
        const path = plan.points.map((p) => [p.lat, p.lon]);
        const kml = X.buildKml(ctx.nombre + ' — misión', { ring: ctx.ring, path, alt: ctx.alt, takeoff: ctx.takeoff });
        const csv = X.buildPointsCsv(plan.points.map((p, i) => ({ name: 'F' + (i + 1), lat: p.lat, lon: p.lon, alt: ctx.alt, line: p.line })));
        return [
          { name: `${slug(ctx.nombre)}${ctx.sufijo || ''}-mision.kml`, mime: 'application/vnd.google-earth.kml+xml', data: kml },
          { name: `${slug(ctx.nombre)}${ctx.sufijo || ''}-puntos.csv`, mime: 'text/csv', data: csv },
        ];
      },
    },
    'dji-msdk-android': {
      id: 'dji-msdk-android', nombre: 'DJI SDK en Android (control en vivo)', estado: 'planificado',
      caps: { planificar: true, exportarMision: true, controlEnVivo: true, importarFotos: true },
      plataformas: 'Solo Android; Mini 3, Mini 3 Pro y Mini 4 Pro (SDK V5)',
      archivo: '—', pasos: [], advertencia: 'Fase 3: capa nativa que ejecuta la misión y muestra telemetría. No está en esta versión.',
      build() { throw new Error('Adaptador planificado: aún no disponible.'); },
    },
    mavlink: {
      id: 'mavlink', nombre: 'MAVLink (ArduPilot / PX4)', estado: 'planificado',
      caps: { planificar: true, exportarMision: true, controlEnVivo: true, importarFotos: true },
      plataformas: 'Drones con ArduPilot o PX4', archivo: '—', pasos: [],
      advertencia: 'Fase 4: apertura a otras marcas.',
      build() { throw new Error('Adaptador planificado: aún no disponible.'); },
    },
  };

  function forDrone(droneId) {
    const d = M.DRONES[droneId] || M.DRONES.generico;
    return d.adaptadores.map((id) => ADAPTERS[id]).filter(Boolean);
  }

  const api = { ADAPTERS, forDrone, slug };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CEI = Object.assign(root.CEI || {}, { adapters: api });
})(typeof self !== 'undefined' ? self : this);
