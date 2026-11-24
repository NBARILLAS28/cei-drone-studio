/* CEI Drone Studio — mapa propio en canvas (mosaicos "slippy", sin librerías)
 * - Arrastrar, pellizcar y rueda para mover/acercar
 * - Sin mapa base: dibuja una cuadrícula tipo plano topográfico
 * - Manijas arrastrables (vértices del terreno) y toque simple para dibujar
 */
(function (root) {
  'use strict';

  const TILE = 256;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  class SlippyMap {
    constructor(canvas, opts) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.lat = opts.lat ?? 14.6349;
      this.lon = opts.lon ?? -90.8197;
      this.z = opts.z ?? 15;
      this.tileUrl = opts.tileUrl || null;
      this.attribution = opts.attribution || '';
      this.onDraw = opts.onDraw || (() => {});
      this.onTap = opts.onTap || (() => {});
      this.onHandleDrag = opts.onHandleDrag || (() => {});
      this.handleProvider = opts.handleProvider || (() => []);
      this.tiles = new Map();
      this.pointers = new Map();
      this.w = 0;
      this.h = 0;
      this.dpr = 1;
      this._raf = 0;
      this._bind();
      this._resize();
    }

    /* ---------- proyección ---------- */
    _world(z) { return TILE * Math.pow(2, z); }
    _px(lat, lon, z) {
      const ws = this._world(z);
      const s = Math.sin((lat * Math.PI) / 180);
      return {
        x: ((lon + 180) / 360) * ws,
        y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * ws,
      };
    }
    _ll(x, y, z) {
      const ws = this._world(z);
      const lon = (x / ws) * 360 - 180;
      const n = Math.PI - (2 * Math.PI * y) / ws;
      return { lat: (180 / Math.PI) * Math.atan(Math.sinh(n)), lon };
    }
    project(lat, lon) {
      const c = this._px(this.lat, this.lon, this.z);
      const p = this._px(lat, lon, this.z);
      return { x: p.x - c.x + this.w / 2, y: p.y - c.y + this.h / 2 };
    }
    unproject(x, y) {
      const c = this._px(this.lat, this.lon, this.z);
      return this._ll(c.x + x - this.w / 2, c.y + y - this.h / 2, this.z);
    }
    metersPerPixel() {
      return (156543.03392 * Math.cos((this.lat * Math.PI) / 180)) / Math.pow(2, this.z);
    }

    /* ---------- vista ---------- */
    setView(lat, lon, z) {
      this.lat = clamp(lat, -85, 85);
      this.lon = ((lon + 540) % 360) - 180;
      if (z != null) this.z = clamp(z, 2, 21);
      this.redraw();
    }
    fitBounds(b, pad) {
      pad = pad == null ? 48 : pad;
      const availW = Math.max(60, this.w - pad * 2);
      const availH = Math.max(60, this.h - pad * 2);
      let z = 20;
      for (; z > 2; z -= 0.25) {
        const a = this._px(b.maxLat, b.minLon, z);
        const c = this._px(b.minLat, b.maxLon, z);
        if (Math.abs(c.x - a.x) <= availW && Math.abs(c.y - a.y) <= availH) break;
      }
      this.setView((b.minLat + b.maxLat) / 2, (b.minLon + b.maxLon) / 2, z);
    }
    /** Desplaza el centro para que el área visible no quede tapada por el panel (móvil). */
    setInsets(top, bottom, left, right) {
      this.insets = { top: top || 0, bottom: bottom || 0, left: left || 0, right: right || 0 };
    }
    zoomBy(dz, x, y) {
      const nz = clamp(this.z + dz, 2, 21);
      if (nz === this.z) return;
      x = x == null ? this.w / 2 : x;
      y = y == null ? this.h / 2 : y;
      const before = this.unproject(x, y);
      this.z = nz;
      const after = this.project(before.lat, before.lon);
      this._panBy(after.x - x, after.y - y);
    }
    _panBy(dx, dy) {
      const c = this._px(this.lat, this.lon, this.z);
      const ll = this._ll(c.x + dx, c.y + dy, this.z);
      this.lat = clamp(ll.lat, -85, 85);
      this.lon = ll.lon;
      this.redraw();
    }
    setTiles(url, attribution) {
      this.tileUrl = url || null;
      this.attribution = attribution || '';
      this.redraw();
    }

    /* ---------- dibujo ---------- */
    redraw() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => { this._raf = 0; this._draw(); });
    }
    _resize() {
      const r = this.canvas.getBoundingClientRect();
      this.dpr = Math.min(window.devicePixelRatio || 1, 3);
      this.w = Math.max(1, Math.round(r.width));
      this.h = Math.max(1, Math.round(r.height));
      this.canvas.width = Math.round(this.w * this.dpr);
      this.canvas.height = Math.round(this.h * this.dpr);
      this.redraw();
    }
    _draw() {
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.fillStyle = '#dde4e1';
      ctx.fillRect(0, 0, this.w, this.h);
      if (this.tileUrl) this._drawTiles(ctx);
      else this._drawGrid(ctx);
      this.onDraw(ctx, this);
      this._drawScale(ctx);
      if (this.tileUrl && this.attribution) {
        ctx.font = '10px system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(255,255,255,.85)';
        const tw = ctx.measureText(this.attribution).width;
        ctx.fillRect(this.w - tw - 10, this.h - 15, tw + 10, 15);
        ctx.fillStyle = '#20313f';
        ctx.fillText(this.attribution, this.w - 5, this.h - 4);
        ctx.textAlign = 'left';
      }
    }
    _drawTiles(ctx) {
      const tz = clamp(Math.round(this.z), 1, 19);
      const scale = Math.pow(2, this.z - tz);
      const size = TILE * scale;
      const c = this._px(this.lat, this.lon, tz);
      const cx = c.x;
      const cy = c.y;
      const half = { w: this.w / 2 / scale, h: this.h / 2 / scale };
      const x0 = Math.floor((cx - half.w) / TILE);
      const x1 = Math.floor((cx + half.w) / TILE);
      const y0 = Math.floor((cy - half.h) / TILE);
      const y1 = Math.floor((cy + half.h) / TILE);
      const max = Math.pow(2, tz);
      for (let ty = y0; ty <= y1; ty++) {
        if (ty < 0 || ty >= max) continue;
        for (let tx = x0; tx <= x1; tx++) {
          const wx = ((tx % max) + max) % max;
          const img = this._tile(tz, wx, ty);
          const sx = (tx * TILE - cx) * scale + this.w / 2;
          const sy = (ty * TILE - cy) * scale + this.h / 2;
          if (img && img.complete && img.naturalWidth) ctx.drawImage(img, sx, sy, size + 0.5, size + 0.5);
        }
      }
    }
    _tile(z, x, y) {
      const key = z + '/' + x + '/' + y + '|' + this.tileUrl;
      let t = this.tiles.get(key);
      if (!t) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => this.redraw();
        img.onerror = () => { img._fail = true; };
        img.src = this.tileUrl.replace('{z}', z).replace('{x}', x).replace('{y}', y);
        t = img;
        this.tiles.set(key, t);
        if (this.tiles.size > 400) this.tiles.delete(this.tiles.keys().next().value);
      }
      return t;
    }
    _drawGrid(ctx) {
      const mpp = this.metersPerPixel();
      const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
      const step = steps.find((s) => s / mpp >= 60) || 20000;
      const a = this.unproject(0, this.h);
      const b = this.unproject(this.w, 0);
      const latStep = step / 111320;
      const lonStep = step / (111320 * Math.cos((this.lat * Math.PI) / 180));
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(32,49,63,.12)';
      ctx.beginPath();
      for (let lat = Math.floor(a.lat / latStep) * latStep; lat <= b.lat; lat += latStep) {
        const y = this.project(lat, this.lon).y;
        ctx.moveTo(0, y); ctx.lineTo(this.w, y);
      }
      for (let lon = Math.floor(a.lon / lonStep) * lonStep; lon <= b.lon; lon += lonStep) {
        const x = this.project(this.lat, lon).x;
        ctx.moveTo(x, 0); ctx.lineTo(x, this.h);
      }
      ctx.stroke();
    }
    _drawScale(ctx) {
      const mpp = this.metersPerPixel();
      const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
      const target = 110 * mpp;
      const m = steps.filter((s) => s <= target).pop() || 1;
      const px = m / mpp;
      const ins = this.insets || { bottom: 0, left: 0 };
      const x = 14 + (ins.left || 0);
      const y = this.h - 18 - (ins.bottom || 0);
      ctx.save();
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,.9)';
      ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x, y); ctx.lineTo(x + px, y); ctx.lineTo(x + px, y - 5); ctx.stroke();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#14283a';
      ctx.stroke();
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.fillStyle = '#14283a';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,.9)';
      const label = m >= 1000 ? m / 1000 + ' km' : m + ' m';
      ctx.strokeText(label, x + 4, y - 8);
      ctx.fillText(label, x + 4, y - 8);
      ctx.restore();
    }

    /* ---------- interacción ---------- */
    _bind() {
      const cv = this.canvas;
      cv.style.touchAction = 'none';
      new ResizeObserver(() => this._resize()).observe(cv);
      cv.addEventListener('pointerdown', (e) => this._down(e));
      cv.addEventListener('pointermove', (e) => this._move(e));
      cv.addEventListener('pointerup', (e) => this._up(e));
      cv.addEventListener('pointercancel', (e) => this._up(e, true));
      cv.addEventListener('wheel', (e) => {
        e.preventDefault();
        const r = cv.getBoundingClientRect();
        this.zoomBy(-e.deltaY * 0.0025, e.clientX - r.left, e.clientY - r.top);
      }, { passive: false });
      cv.addEventListener('dblclick', (e) => {
        const r = cv.getBoundingClientRect();
        this.zoomBy(1, e.clientX - r.left, e.clientY - r.top);
      });
    }
    _pos(e) {
      const r = this.canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    _hit(p) {
      const hs = this.handleProvider() || [];
      let best = null;
      let bd = 22 * 22;
      hs.forEach((hd) => {
        const s = this.project(hd.lat, hd.lon);
        const d = (s.x - p.x) ** 2 + (s.y - p.y) ** 2;
        if (d < bd) { bd = d; best = hd; }
      });
      return best;
    }
    _down(e) {
      this.canvas.setPointerCapture(e.pointerId);
      const p = this._pos(e);
      this.pointers.set(e.pointerId, { x: p.x, y: p.y, sx: p.x, sy: p.y, t: Date.now() });
      if (this.pointers.size === 1) {
        this.drag = this._hit(p);
        this.moved = false;
      } else {
        this.drag = null;
        this.moved = true;
        const [a, b] = [...this.pointers.values()];
        this.pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    }
    _move(e) {
      const q = this.pointers.get(e.pointerId);
      if (!q) return;
      const p = this._pos(e);
      const dx = p.x - q.x;
      const dy = p.y - q.y;
      q.x = p.x; q.y = p.y;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinch) this.zoomBy(Math.log2(d / this.pinch), (a.x + b.x) / 2, (a.y + b.y) / 2);
        this.pinch = d;
        this._panBy(-dx / 2, -dy / 2);
        return;
      }
      if (Math.hypot(p.x - q.sx, p.y - q.sy) > 6) this.moved = true;
      if (this.drag) {
        const ll = this.unproject(p.x, p.y);
        this.onHandleDrag(this.drag, ll.lat, ll.lon, false);
        this.redraw();
      } else if (this.moved) {
        this._panBy(-dx, -dy);
      }
    }
    _up(e, cancel) {
      const q = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      if (!q) return;
      const p = this._pos(e);
      if (this.pointers.size === 0) {
        if (this.drag && this.moved) {
          const ll = this.unproject(p.x, p.y);
          this.onHandleDrag(this.drag, ll.lat, ll.lon, true);
        } else if (!this.moved && !cancel && Date.now() - q.t < 600) {
          const ll = this.unproject(p.x, p.y);
          this.onTap(ll.lat, ll.lon, p);
        }
        this.drag = null;
        this.pinch = 0;
      }
    }
  }

  const api = { SlippyMap };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CEI = Object.assign(root.CEI || {}, api);
})(typeof self !== 'undefined' ? self : this);
