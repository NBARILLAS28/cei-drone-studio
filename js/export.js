/* CEI Drone Studio — exportadores de misión y de datos
 * - KMZ/WPML para DJI Fly (Mini 4 Pro y otros con "Waypoint Flight")
 * - CSV de Litchi (Litchi Pilot / Mission Hub)
 * - KML y CSV genéricos (abren en My ArQ, Modeler My ArQ, Google Earth, QGIS)
 */
(function (root) {
  'use strict';
  const Z = (typeof require !== 'undefined' && typeof module !== 'undefined') ? require('./zip.js') : root.CEI.zip;

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  const f8 = (n) => Number(n).toFixed(8);
  const f2 = (n) => Number(n).toFixed(2);

  // DJI Fly escribe este espacio de nombres (no el de la documentación pública).
  const WPML_NS = 'http://www.uav.com/wpmz/1.0.2';

  function turnFor(p) {
    return p.fin === 'inicio' || p.fin === 'fin'
      ? { mode: 'toPointAndStopWithDiscontinuityCurvature', damp: 0, straight: false }
      : { mode: 'toPointAndPassWithContinuityCurvature', damp: 0.2, straight: true };
  }

  function actionGroup(i, withGimbal) {
    const actions = [];
    let id = 0;
    if (withGimbal) {
      actions.push(`
          <wpml:action>
            <wpml:actionId>${id++}</wpml:actionId>
            <wpml:actionActuatorFunc>gimbalRotate</wpml:actionActuatorFunc>
            <wpml:actionActuatorFuncParam>
              <wpml:gimbalRotateMode>absoluteAngle</wpml:gimbalRotateMode>
              <wpml:gimbalPitchRotateEnable>1</wpml:gimbalPitchRotateEnable>
              <wpml:gimbalPitchRotateAngle>-90</wpml:gimbalPitchRotateAngle>
              <wpml:gimbalRollRotateEnable>0</wpml:gimbalRollRotateEnable>
              <wpml:gimbalRollRotateAngle>0</wpml:gimbalRollRotateAngle>
              <wpml:gimbalYawRotateEnable>0</wpml:gimbalYawRotateEnable>
              <wpml:gimbalYawRotateAngle>0</wpml:gimbalYawRotateAngle>
              <wpml:gimbalRotateTimeEnable>0</wpml:gimbalRotateTimeEnable>
              <wpml:gimbalRotateTime>0</wpml:gimbalRotateTime>
              <wpml:payloadPositionIndex>0</wpml:payloadPositionIndex>
            </wpml:actionActuatorFuncParam>
          </wpml:action>`);
    }
    actions.push(`
          <wpml:action>
            <wpml:actionId>${id++}</wpml:actionId>
            <wpml:actionActuatorFunc>takePhoto</wpml:actionActuatorFunc>
            <wpml:actionActuatorFuncParam>
              <wpml:fileSuffix>P${i + 1}</wpml:fileSuffix>
              <wpml:payloadPositionIndex>0</wpml:payloadPositionIndex>
            </wpml:actionActuatorFuncParam>
          </wpml:action>`);
    return `
        <wpml:actionGroup>
          <wpml:actionGroupId>${i}</wpml:actionGroupId>
          <wpml:actionGroupStartIndex>${i}</wpml:actionGroupStartIndex>
          <wpml:actionGroupEndIndex>${i}</wpml:actionGroupEndIndex>
          <wpml:actionGroupMode>parallel</wpml:actionGroupMode>
          <wpml:actionTrigger>
            <wpml:actionTriggerType>reachPoint</wpml:actionTriggerType>
          </wpml:actionTrigger>${actions.join('')}
        </wpml:actionGroup>`;
  }

  /** Devuelve {template, waylines} como texto. o: {alt, velocidad, droneEnum, autor} */
  function buildWpml(plan, o) {
    const alt = Number(o.alt);
    const vel = Number(o.velocidad);
    const enumV = o.droneEnum == null ? 68 : o.droneEnum;
    const now = Date.now();
    const pts = plan.points;
    const secH = Math.max(2, Math.min(20, alt));
    const rth = Math.max(30, Math.round(alt + 10));

    const mission = (extra) => `
  <wpml:missionConfig>
    <wpml:flyToWaylineMode>safely</wpml:flyToWaylineMode>
    <wpml:finishAction>goHome</wpml:finishAction>
    <wpml:exitOnRCLost>executeLostAction</wpml:exitOnRCLost>
    <wpml:executeRCLostAction>goBack</wpml:executeRCLostAction>
    <wpml:takeOffSecurityHeight>${secH}</wpml:takeOffSecurityHeight>
    <wpml:globalTransitionalSpeed>${vel}</wpml:globalTransitionalSpeed>${extra}
    <wpml:droneInfo>
      <wpml:droneEnumValue>${enumV}</wpml:droneEnumValue>
      <wpml:droneSubEnumValue>0</wpml:droneSubEnumValue>
    </wpml:droneInfo>
  </wpml:missionConfig>`;

    const tplMarks = pts.map((p, i) => {
      const t = turnFor(p);
      return `
    <Placemark>
      <Point><coordinates>${f8(p.lon)},${f8(p.lat)}</coordinates></Point>
      <wpml:index>${i}</wpml:index>
      <wpml:ellipsoidHeight>${f2(alt)}</wpml:ellipsoidHeight>
      <wpml:height>${f2(alt)}</wpml:height>
      <wpml:useGlobalHeight>1</wpml:useGlobalHeight>
      <wpml:useGlobalSpeed>1</wpml:useGlobalSpeed>
      <wpml:useGlobalHeadingParam>1</wpml:useGlobalHeadingParam>
      <wpml:useGlobalTurnParam>0</wpml:useGlobalTurnParam>
      <wpml:waypointTurnParam>
        <wpml:waypointTurnMode>${t.mode}</wpml:waypointTurnMode>
        <wpml:waypointTurnDampingDist>${t.damp}</wpml:waypointTurnDampingDist>
      </wpml:waypointTurnParam>${t.straight ? `
      <wpml:useStraightLine>1</wpml:useStraightLine>` : ''}
      <wpml:gimbalPitchAngle>-90</wpml:gimbalPitchAngle>${actionGroup(i, i === 0)}
    </Placemark>`;
    }).join('');

    const template = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="${WPML_NS}">
<Document>
  <wpml:author>${esc(o.autor || 'CEI Drone Studio')}</wpml:author>
  <wpml:createTime>${now}</wpml:createTime>
  <wpml:updateTime>${now}</wpml:updateTime>${mission('')}
  <Folder>
    <wpml:templateType>waypoint</wpml:templateType>
    <wpml:templateId>0</wpml:templateId>
    <wpml:waylineCoordinateSysParam>
      <wpml:coordinateMode>WGS84</wpml:coordinateMode>
      <wpml:heightMode>relativeToStartPoint</wpml:heightMode>
      <wpml:positioningType>GPS</wpml:positioningType>
    </wpml:waylineCoordinateSysParam>
    <wpml:autoFlightSpeed>${vel}</wpml:autoFlightSpeed>
    <wpml:globalHeight>${f2(alt)}</wpml:globalHeight>
    <wpml:gimbalPitchMode>usePointSetting</wpml:gimbalPitchMode>
    <wpml:globalWaypointHeadingParam>
      <wpml:waypointHeadingMode>followWayline</wpml:waypointHeadingMode>
      <wpml:waypointHeadingAngle>0</wpml:waypointHeadingAngle>
      <wpml:waypointPoiPoint>0.000000,0.000000,0.000000</wpml:waypointPoiPoint>
      <wpml:waypointHeadingPathMode>followBadArc</wpml:waypointHeadingPathMode>
    </wpml:globalWaypointHeadingParam>
    <wpml:globalWaypointTurnMode>toPointAndPassWithContinuityCurvature</wpml:globalWaypointTurnMode>
    <wpml:globalUseStraightLine>1</wpml:globalUseStraightLine>${tplMarks}
  </Folder>
</Document>
</kml>
`;

    const wlMarks = pts.map((p, i) => {
      const t = turnFor(p);
      return `
      <Placemark>
        <Point><coordinates>${f8(p.lon)},${f8(p.lat)}</coordinates></Point>
        <wpml:index>${i}</wpml:index>
        <wpml:executeHeight>${f2(alt)}</wpml:executeHeight>
        <wpml:waypointSpeed>${vel}</wpml:waypointSpeed>
        <wpml:waypointHeadingParam>
          <wpml:waypointHeadingMode>followWayline</wpml:waypointHeadingMode>
        </wpml:waypointHeadingParam>
        <wpml:waypointTurnParam>
          <wpml:waypointTurnMode>${t.mode}</wpml:waypointTurnMode>
          <wpml:waypointTurnDampingDist>${t.damp}</wpml:waypointTurnDampingDist>
        </wpml:waypointTurnParam>
        <wpml:useStraightLine>${t.straight ? 1 : 0}</wpml:useStraightLine>${actionGroup(i, i === 0)}
      </Placemark>`;
    }).join('');

    const waylines = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="${WPML_NS}">
<Document>${mission(`
    <wpml:globalRTHHeight>${rth}</wpml:globalRTHHeight>`)}
  <Folder>
    <wpml:templateId>0</wpml:templateId>
    <wpml:executeHeightMode>relativeToStartPoint</wpml:executeHeightMode>
    <wpml:waylineId>0</wpml:waylineId>
    <wpml:autoFlightSpeed>${vel}</wpml:autoFlightSpeed>${wlMarks}
  </Folder>
</Document>
</kml>
`;
    return { template, waylines };
  }

  function buildKmz(plan, o) {
    const w = buildWpml(plan, o);
    return Z.zipStore([
      { name: 'wpmz/template.kml', data: w.template },
      { name: 'wpmz/waylines.wpml', data: w.waylines },
    ]);
  }

  const LITCHI_HEADER = (() => {
    const base = ['latitude', 'longitude', 'altitude(m)', 'heading(deg)', 'curvesize(m)', 'rotationdir', 'gimbalmode', 'gimbalpitchangle'];
    for (let i = 1; i <= 15; i++) base.push('actiontype' + i, 'actionparam' + i);
    base.push('altitudemode', 'speed(m/s)', 'poi_latitude', 'poi_longitude', 'poi_altitude(m)', 'poi_altitudemode', 'photo_timeinterval', 'photo_distinterval');
    return base.join(',');
  })();

  /** Litchi: solo los extremos de cada línea; las fotos salen por distancia entre extremos. */
  function buildLitchiCsv(plan, o) {
    const spacing = Math.round(plan.cam.photoSpacing * 10) / 10;
    const rows = [LITCHI_HEADER];
    let first = true;
    plan.points.forEach((p) => {
      if (!p.fin) return;
      const acts = [];
      for (let i = 0; i < 15; i++) acts.push(i === 0 && first ? '5,-90' : '-1,0');
      const dist = p.fin === 'inicio' ? spacing : -1;
      rows.push([
        f8(p.lat), f8(p.lon), f2(o.alt), 0, 0, 0, 2, -90, acts.join(','),
        0, o.velocidad, 0, 0, 0, 0, -1, dist,
      ].join(','));
      first = false;
    });
    return rows.join('\n') + '\n';
  }

  /** KML genérico: terreno, trayectoria y/o puntos. */
  function buildKml(nombre, d) {
    const parts = [];
    if (d.ring && d.ring.length >= 3) {
      const c = d.ring.concat([d.ring[0]]).map((p) => `${f8(p[1])},${f8(p[0])},0`).join(' ');
      parts.push(`<Placemark><name>${esc(d.nombreTerreno || 'Terreno')}</name><Style><LineStyle><color>ff2f7cf5</color><width>3</width></LineStyle><PolyStyle><color>332f7cf5</color></PolyStyle></Style><Polygon><tessellate>1</tessellate><outerBoundaryIs><LinearRing><coordinates>${c}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`);
      if (d.vertices) {
        d.ring.forEach((p, i) => parts.push(`<Placemark><name>P${i + 1}</name><Point><coordinates>${f8(p[1])},${f8(p[0])},0</coordinates></Point></Placemark>`));
      }
    }
    if (d.path && d.path.length > 1) {
      const c = d.path.map((p) => `${f8(p[1])},${f8(p[0])},${f2(d.alt || 0)}`).join(' ');
      parts.push(`<Placemark><name>${esc(d.nombreRuta || 'Ruta de vuelo')}</name><Style><LineStyle><color>ff1360ff</color><width>2</width></LineStyle></Style><LineString><altitudeMode>relativeToGround</altitudeMode><coordinates>${c}</coordinates></LineString></Placemark>`);
    }
    if (d.points) {
      d.points.forEach((p, i) => parts.push(`<Placemark><name>${esc(p.name || 'F' + (i + 1))}</name><Point><coordinates>${f8(p.lon)},${f8(p.lat)},${f2(p.alt || 0)}</coordinates></Point></Placemark>`));
    }
    if (d.takeoff) {
      parts.push(`<Placemark><name>Despegue</name><Point><coordinates>${f8(d.takeoff[1])},${f8(d.takeoff[0])},0</coordinates></Point></Placemark>`);
    }
    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(nombre)}</name>
${parts.join('\n')}
</Document></kml>
`;
  }

  function buildPointsCsv(points) {
    const rows = ['nombre,lat,lon,altura_m,linea'];
    points.forEach((p, i) => rows.push([p.name || 'F' + (i + 1), f8(p.lat), f8(p.lon), f2(p.alt || 0), p.line == null ? '' : p.line + 1].join(',')));
    return rows.join('\n') + '\n';
  }

  const api = { buildWpml, buildKmz, buildLitchiCsv, buildKml, buildPointsCsv, LITCHI_HEADER, WPML_NS, esc };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CEI = Object.assign(root.CEI || {}, { exp: api });
})(typeof self !== 'undefined' ? self : this);
