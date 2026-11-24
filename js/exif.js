/* CEI Drone Studio — lector de EXIF/XMP de fotos JPEG de dron (sin dependencias)
 * Lee solo el encabezado del archivo (primeros 128 KB), así que sirve con cientos de fotos.
 */
(function (root) {
  'use strict';

  const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

  function parseTiff(dv, base) {
    const le = dv.getUint16(base) === 0x4949;
    const u16 = (o) => dv.getUint16(o, le);
    const u32 = (o) => dv.getUint32(o, le);
    function readIfd(off) {
      const out = {};
      const n = u16(base + off);
      for (let i = 0; i < n; i++) {
        const p = base + off + 2 + i * 12;
        const tag = u16(p);
        const type = u16(p + 2);
        const count = u32(p + 4);
        const size = (TYPE_SIZE[type] || 1) * count;
        const pos = size <= 4 ? p + 8 : base + u32(p + 8);
        out[tag] = { type, count, pos };
      }
      return out;
    }
    function num(e, i) {
      i = i || 0;
      if (!e) return null;
      switch (e.type) {
        case 1: case 7: return dv.getUint8(e.pos + i);
        case 3: return u16(e.pos + 2 * i);
        case 4: return u32(e.pos + 4 * i);
        case 5: { const d = u32(e.pos + 8 * i + 4); return d ? u32(e.pos + 8 * i) / d : 0; }
        default: return null;
      }
    }
    function str(e) {
      if (!e) return null;
      let s = '';
      for (let i = 0; i < e.count; i++) {
        const c = dv.getUint8(e.pos + i);
        if (!c) break;
        s += String.fromCharCode(c);
      }
      return s.trim();
    }
    function dms(e) {
      if (!e || e.count < 3) return null;
      return num(e, 0) + num(e, 1) / 60 + num(e, 2) / 3600;
    }

    const out = {};
    const ifd0 = readIfd(u32(base + 4));
    out.make = str(ifd0[0x010f]);
    out.model = str(ifd0[0x0110]);
    if (ifd0[0x8769]) {
      const ex = readIfd(u32(ifd0[0x8769].pos));
      out.date = str(ex[0x9003]) || str(ex[0x9004]);
      out.f35 = num(ex[0xa405]);
      out.focal = num(ex[0x920a]);
      out.w = num(ex[0xa002]);
      out.h = num(ex[0xa003]);
    }
    if (ifd0[0x8825]) {
      const g = readIfd(u32(ifd0[0x8825].pos));
      const lat = dms(g[2]);
      const lon = dms(g[4]);
      if (lat != null && lon != null) {
        out.lat = str(g[1]) === 'S' ? -lat : lat;
        out.lon = str(g[3]) === 'W' ? -lon : lon;
      }
      if (g[6]) out.alt = (num(g[5]) === 1 ? -1 : 1) * num(g[6]);
    }
    return out;
  }

  function xmpNum(xmp, name) {
    const m = xmp.match(new RegExp('drone-dji:' + name + '(?:="|>)\\s*([+-]?\\d+(?:\\.\\d+)?)'));
    return m ? parseFloat(m[1]) : null;
  }

  /** buf: ArrayBuffer del inicio del JPEG. Devuelve {lat,lon,alt,rel,yaw,pitch,date,f35,w,h,make,model} */
  function parseJpeg(buf) {
    const dv = new DataView(buf);
    const res = {};
    if (dv.byteLength < 4 || dv.getUint16(0) !== 0xffd8) throw new Error('No es un JPEG');
    let p = 2;
    let xmp = '';
    try {
      while (p + 4 <= dv.byteLength) {
        if (dv.getUint8(p) !== 0xff) break;
        const marker = dv.getUint8(p + 1);
        if (marker === 0xda || marker === 0xd9) break;
        const len = dv.getUint16(p + 2);
        if (marker === 0xe1) {
          const head = String.fromCharCode(...new Uint8Array(buf, p + 4, Math.min(29, len - 2)));
          if (head.startsWith('Exif\0\0')) {
            Object.assign(res, parseTiff(dv, p + 10));
          } else if (head.startsWith('http://ns.adobe.com/xap/1.0/')) {
            const bytes = new Uint8Array(buf, p + 4 + 29, Math.max(0, Math.min(len - 2 - 29, dv.byteLength - (p + 33))));
            xmp = new TextDecoder().decode(bytes);
          }
        }
        p += 2 + len;
      }
    } catch (e) { /* encabezado truncado: nos quedamos con lo leído */ }

    if (xmp) {
      res.rel = xmpNum(xmp, 'RelativeAltitude');
      res.absAlt = xmpNum(xmp, 'AbsoluteAltitude');
      res.yaw = xmpNum(xmp, 'FlightYawDegree');
      res.pitch = xmpNum(xmp, 'GimbalPitchDegree');
      if (res.lat == null) {
        const la = xmpNum(xmp, 'GpsLatitude');
        const lo = xmpNum(xmp, 'GpsLongitude') ?? xmpNum(xmp, 'GpsLongtitude');
        if (la != null && lo != null) { res.lat = la; res.lon = lo; }
      }
      if (res.alt == null && res.absAlt != null) res.alt = res.absAlt;
    }
    return res;
  }

  async function readPhoto(file) {
    const buf = await file.slice(0, 131072).arrayBuffer();
    const r = parseJpeg(buf);
    r.name = file.name;
    r.size = file.size;
    return r;
  }

  const api = { parseJpeg, readPhoto };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CEI = Object.assign(root.CEI || {}, { exif: api });
})(typeof self !== 'undefined' ? self : this);
