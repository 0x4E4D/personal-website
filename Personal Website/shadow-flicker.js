/* shadow-flicker.js — mode 'flicker' (default) toggles pixels on/off in place; mode 'drift' is the original.
    screen-style striping that only appears in shadows and dark midtones.
   Usage: <img src="photo.jpg" class="shadow-flicker" data-focus="0.3" data-strength="0.8">
          <script src="shadow-flicker.js"><\/script>
   Or:    ShadowFlicker.apply(imgElement, { focus, spread, strength, dash, levels, speed, contrast })
   Images must be same-origin (or served with CORS headers).

   Performance:
   - The pixel work runs in a background Web Worker drawing to an
     OffscreenCanvas, so the page itself (scrolling, clicks, music players)
     never waits on it. Browsers without OffscreenCanvas run the same code on
     the main thread instead. Pass { worker: false } to force that.
   - The mask (one Math.exp per pixel) is static, so it is computed once at
     setup. Pixels outside the mask never change either: they are written
     once and never touched again, and each frame only walks the masked
     pixels. Output is byte-identical to the straightforward per-pixel loop
     (drawGeneric, still used for 'drift' and showMask).
   - Nothing happens until an image is actually on screen, and the animation
     stops completely while it is scrolled away, on a hidden page, removed,
     or the tab is in the background. */
(function () {
  const DEFAULTS = { focus: 0.4, spread: 0.15, strength: 1, line: 0, mode: 'flicker', rate: 15, dash: 4, levels: 6, speed: 1, contrast: 1.2, fps: 24, showMask: false, maxWidth: 0, maxScale: 0 };

  // ---------------------------------------------------------------------------
  // Core pixel code. Self-contained (no outside references) because it is also
  // stringified into the worker. State lives in a plain object `s`:
  //   s.o (options), s.w, s.h, s.frame (ImageData), plus the buffers built here.
  // ---------------------------------------------------------------------------
  function core() {
    const hash = (a, b, c) => { let h = (a * 374761393 + b * 668265263 + c * 2246822519) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };

    // Backing store size. Rendering far above display size costs memory and
    // render time for detail nobody sees. maxScale caps it at a multiple of
    // the element's laid-out width; maxWidth is an absolute cap. Both default
    // to 0 (off) -> the original 1600 ceiling. L and dash scale with w, so
    // stripe size in SCREEN pixels is unchanged either way.
    function size(o, disp, nw, nh) {
      let cap = o.maxWidth > 0 ? o.maxWidth
              : (o.maxScale > 0 && disp > 0 ? Math.ceil(disp * o.maxScale) : 0);
      if (!(cap > 64)) cap = 1600;
      const w = Math.min(nw, cap);
      return { w, h: Math.round(w * nh / nw) };
    }

    function lineSize(s, dispWidth) {
      return s.o.line > 0 ? s.o.line : Math.max(1, Math.round(s.w / (dispWidth || s.w)));
    }

    function interval(o) {
      return 1000 / Math.max(o.fps, o.mode !== 'drift' ? o.rate : 0);
    }

    function build(s, src) {
      s.fast = s.o.mode !== 'drift' && !s.o.showMask;
      if (s.fast) buildFast(s, src); else buildGeneric(s, src);
    }

    function draw(s, t, L) {
      if (s.fast) drawFast(s, t, L); else drawGeneric(s, t, L);
    }

    function buildGeneric(s, src) {
      const { w, h, o } = s;
      s.rowStart = s.idx = s.B = s.M = null;
      const base = s.base = new Float32Array(w * h * 3), lumA = s.lumA = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) {
        for (let k = 0; k < 3; k++) {
          let v = src[i * 4 + k] / 255 - 0.5;
          base[i * 3 + k] = Math.max(0, Math.min(1, 0.5 + v * o.contrast)) * 255;
        }
        lumA[i] = (base[i * 3] * 0.3 + base[i * 3 + 1] * 0.59 + base[i * 3 + 2] * 0.11) / 255;
      }
    }

    // Masked pixels only, grouped by row: idx = pixel index, B = contrast-
    // adjusted rgb (Float32, exactly like the generic path's base), M = mask.
    function buildFast(s, src) {
      const { w, h, o } = s;
      s.base = s.lumA = null;
      const n = w * h, d = s.frame.data, c = o.contrast;
      const px = new Float32Array(3), lum = new Float32Array(1), mask = new Float64Array(n);
      let count = 0;
      for (let i = 0; i < n; i++) {
        const p = i * 4;
        px[0] = Math.max(0, Math.min(1, 0.5 + (src[p] / 255 - 0.5) * c)) * 255;
        px[1] = Math.max(0, Math.min(1, 0.5 + (src[p + 1] / 255 - 0.5) * c)) * 255;
        px[2] = Math.max(0, Math.min(1, 0.5 + (src[p + 2] / 255 - 0.5) * c)) * 255;
        lum[0] = (px[0] * 0.3 + px[1] * 0.59 + px[2] * 0.11) / 255;
        const z = (lum[0] - o.focus) / o.spread, m = Math.exp(-z * z);
        mask[i] = m;
        if (m > 0.02) count++;
        // Static output for every pixel; masked ones are overwritten per frame
        d[p] = px[0]; d[p + 1] = px[1]; d[p + 2] = px[2]; d[p + 3] = 255;
      }
      const rowStart = s.rowStart = new Uint32Array(h + 1), idx = s.idx = new Uint32Array(count);
      const B = s.B = new Float32Array(count * 3), M = s.M = new Float64Array(count);
      let j = 0;
      for (let y = 0; y < h; y++) {
        rowStart[y] = j;
        for (let x = 0, i = y * w; x < w; x++, i++) {
          if (mask[i] > 0.02) {
            const p = i * 4;
            idx[j] = i; M[j] = mask[i];
            B[j * 3]     = Math.max(0, Math.min(1, 0.5 + (src[p] / 255 - 0.5) * c)) * 255;
            B[j * 3 + 1] = Math.max(0, Math.min(1, 0.5 + (src[p + 1] / 255 - 0.5) * c)) * 255;
            B[j * 3 + 2] = Math.max(0, Math.min(1, 0.5 + (src[p + 2] / 255 - 0.5) * c)) * 255;
            j++;
          }
        }
      }
      rowStart[h] = j;
    }

    function drawFast(s, t, L) {
      const { w, h, o, rowStart, idx, B, M } = s;
      const d = s.frame.data, step = 255 / (Math.max(2, o.levels) - 1);
      const f = Math.floor(t * o.rate), A = o.strength;
      const dash = Math.max(1, o.dash | 0) * L;
      for (let y = 0; y < h; y++) {
        const a = rowStart[y], e = rowStart[y + 1];
        if (a === e) continue;
        const row = (y / L) | 0, odd = (row & 1) === 1, yw = y * w;
        let lastCx = -1, u = 0;
        for (let j = a; j < e; j++) {
          const i = idx[j], q = j * 3, p = i * 4;
          const k = A * M[j], tint = 70 * k;
          let r = B[q], g = B[q + 1], b = B[q + 2];
          if (odd) { g += tint; r -= tint * 0.6; b -= tint * 0.6; } else { r += tint * 0.8; b += tint * 0.7; g -= tint * 0.7; }
          const cx = ((i - yw) / dash) | 0;
          if (cx !== lastCx) { lastCx = cx; u = step * 0.5 * (1 + (hash(cx, row, f) - 0.5) * 1.4); }
          const qr = Math.floor((r + u) / step) * step, qg = Math.floor((g + u) / step) * step, qb = Math.floor((b + u) / step) * step;
          const mix = Math.min(1, k * 1.3);
          d[p] = r + (qr - r) * mix; d[p + 1] = g + (qg - g) * mix; d[p + 2] = b + (qb - b) * mix;
        }
      }
    }

    function drawGeneric(s, t, L) {
      const { w, h, o, base, lumA } = s;
      const d = s.frame.data, step = 255 / (Math.max(2, o.levels) - 1);
      const flick = o.mode !== 'drift';
      const f = flick ? Math.floor(t * o.rate) : Math.floor(t * 10 * o.speed);
      const scroll = flick ? 0 : Math.floor(t * 4 * o.speed);
      const A = flick ? o.strength : o.strength * (0.75 + 0.25 * Math.sin(t * 1.6 * o.speed));
      const dash = Math.max(1, o.dash | 0) * L;
      for (let y = 0; y < h; y++) {
        const row = (y / L) | 0, odd = ((row + scroll) & 1) === 1;
        const shift = flick ? 0 : (hash(row, 7, f >> 1) * dash) | 0;
        for (let x = 0; x < w; x++) {
          const i = y * w + x, q = i * 3, p = i * 4;
          const z = (lumA[i] - o.focus) / o.spread, m = Math.exp(-z * z);
          if (o.showMask) { const v = m * 255; d[p] = v; d[p + 1] = v * 0.4; d[p + 2] = v * 0.8; d[p + 3] = 255; continue; }
          let r = base[q], g = base[q + 1], b = base[q + 2];
          if (m > 0.02) {
            const k = A * m, tint = 70 * k;
            if (odd) { g += tint; r -= tint * 0.6; b -= tint * 0.6; } else { r += tint * 0.8; b += tint * 0.7; g -= tint * 0.7; }
            let qr, qg, qb;
            if (flick) {
              const cx = ((x / dash) | 0), cy = row;
              const on = hash(cx, cy, f) - 0.5;
              const u = step * 0.5 * (1 + on * 1.4);
              qr = Math.floor((r + u) / step) * step; qg = Math.floor((g + u) / step) * step; qb = Math.floor((b + u) / step) * step;
            } else {
              const n = (hash(((x + shift) / dash) | 0, row, f) - 0.5) * step * 1.6;
              qr = Math.round((r + n) / step) * step; qg = Math.round((g + n) / step) * step; qb = Math.round((b + n) / step) * step;
            }
            const mix = Math.min(1, k * 1.3);
            r += (qr - r) * mix; g += (qg - g) * mix; b += (qb - b) * mix;
          }
          d[p] = r; d[p + 1] = g; d[p + 2] = b; d[p + 3] = 255;
        }
      }
    }

    return { size, lineSize, interval, build, draw };
  }

  // ---------------------------------------------------------------------------
  // Worker side: owns every OffscreenCanvas and runs one shared timer that
  // only ticks while at least one canvas is visible.
  // ---------------------------------------------------------------------------
  function workerMain(C) {
    const items = new Map();
    let pageHidden = false, timer = 0;

    const active = (s) => s.visible && !s.stopped && !s.still && !pageHidden;

    function render(s, now) {
      C.draw(s, (now - s.t0) / 1000, C.lineSize(s, s.disp));
      s.ctx.putImageData(s.frame, 0, 0);
    }

    function setup(s, bitmap) {
      const canvas = s.ctx.canvas;
      if (canvas.width !== s.w) canvas.width = s.w;
      if (canvas.height !== s.h) canvas.height = s.h;
      s.ctx.drawImage(bitmap, 0, 0, s.w, s.h);
      bitmap.close();
      const src = s.ctx.getImageData(0, 0, s.w, s.h).data;
      s.frame = s.ctx.createImageData(s.w, s.h);
      C.build(s, src);
    }

    function run() {
      timer = 0;
      const now = performance.now();
      let next = Infinity;
      items.forEach((s) => {
        if (!active(s)) return;
        const iv = C.interval(s.o);
        if (now - s.last >= iv - 2) { s.last = now; render(s, now); }
        next = Math.min(next, iv - (now - s.last));
      });
      if (next !== Infinity) timer = setTimeout(run, Math.max(1, next));
    }
    function kick() { if (!timer) timer = setTimeout(run, 0); }

    self.onmessage = (e) => {
      const m = e.data, s = items.get(m.id);
      try {
        if (m.type === 'init') {
          const n = { o: m.o, w: m.w, h: m.h, disp: m.disp, still: m.still, visible: false, stopped: false,
                      last: 0, t0: performance.now(), ctx: m.canvas.getContext('2d', { willReadFrequently: true }) };
          setup(n, m.bitmap);
          items.set(m.id, n);
          render(n, performance.now());
          self.postMessage({ type: 'ready', id: m.id });
        } else if (m.type === 'page') {
          pageHidden = m.hidden; kick();
        } else if (!s) {
          if (m.bitmap) m.bitmap.close();
        } else if (m.type === 'vis') {
          s.visible = m.visible; kick();
        } else if (m.type === 'disp') {
          s.disp = m.disp;
        } else if (m.type === 'set') {
          Object.assign(s.o, m.next); s.w = m.w; s.h = m.h;
          setup(s, m.bitmap); render(s, performance.now()); kick();
        } else if (m.type === 'stop') {
          s.stopped = true;
        } else if (m.type === 'drop') {
          items.delete(m.id);
        }
      } catch (err) {
        items.delete(m.id);
        self.postMessage({ type: 'error', id: m.id });
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Main thread
  // ---------------------------------------------------------------------------
  const C = core();
  const hasIO = 'IntersectionObserver' in window;
  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  let worker; // undefined = not tried yet, false = unavailable
  const handlers = new Map();
  let nextId = 1;
  const registry = 'FinalizationRegistry' in window
    ? new FinalizationRegistry((id) => { if (worker) worker.postMessage({ type: 'drop', id }); })
    : null;

  function getWorker() {
    if (worker !== undefined) return worker;
    worker = false;
    try {
      if (typeof OffscreenCanvas === 'undefined' ||
          !HTMLCanvasElement.prototype.transferControlToOffscreen ||
          !OffscreenCanvas.prototype.transferToImageBitmap ||
          !new OffscreenCanvas(1, 1).getContext('2d')) return worker;
      const src = '(' + workerMain.toString() + ')((' + core.toString() + ')());';
      const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      w.onmessage = (e) => { const fn = handlers.get(e.data.id); if (fn) fn(e.data); };
      document.addEventListener('visibilitychange', () => w.postMessage({ type: 'page', hidden: document.hidden }));
      worker = w;
    } catch (e) { worker = false; }
    return worker;
  }

  // Calls fn once the image has loaded AND is on screen.
  function whenOnScreen(img, fn) {
    function go() {
      if (!hasIO) { fn(); return; }
      const io = new IntersectionObserver((es) => {
        if (!es[es.length - 1].isIntersecting) return;
        io.disconnect();
        fn();
      });
      io.observe(img);
    }
    if (img.complete && img.naturalWidth) go(); else img.addEventListener('load', go, { once: true });
  }

  function dispOf(el) { return Math.round(el.getBoundingClientRect().width) || 0; }

  // The photo scaled to w x h exactly as drawImage() does it on a normal
  // canvas, handed over as a bitmap (no pixel readback on this thread).
  // Not createImageBitmap(img): for photos with a colour profile (iPhone
  // Display P3) Chrome converts colours differently on that path, which
  // shifts the shadow mask.
  function scaledBitmap(img, w, h) {
    const oc = new OffscreenCanvas(w, h);
    oc.getContext('2d').drawImage(img, 0, 0, w, h);
    return oc.transferToImageBitmap();
  }

  // Worker-backed instance: the main thread only grabs a bitmap and forwards
  // visibility / size changes. The <img> stays until the first frame is ready.
  function workerInstance(img, canvas, o, still, W) {
    const id = nextId++;
    let stopped = false, live = false;

    function start() {
      if (stopped || !img.isConnected) return;
      const disp = dispOf(img);
      const { w, h } = C.size(o, disp, img.naturalWidth, img.naturalHeight);
      let bitmap, off;
      try { bitmap = scaledBitmap(img, w, h); } catch (e) { return; }
      try {
        canvas.width = w; canvas.height = h;
        off = canvas.transferControlToOffscreen();
      } catch (e) { bitmap.close(); return; }

      handlers.set(id, (m) => {
        handlers.delete(id);
        if (m.type !== 'ready') return;               // error: keep the <img>
        if (!img.isConnected) { W.postMessage({ type: 'drop', id }); return; }
        img.replaceWith(canvas);
        live = true;
        if (registry) registry.register(canvas, id);
        if (hasIO) {
          new IntersectionObserver((es) => {
            W.postMessage({ type: 'vis', id, visible: es[es.length - 1].isIntersecting });
          }).observe(canvas);
        } else W.postMessage({ type: 'vis', id, visible: true });
        if ('ResizeObserver' in window) {
          new ResizeObserver((es) => {
            const cw = Math.round(es[es.length - 1].contentRect.width);
            if (cw) W.postMessage({ type: 'disp', id, disp: cw });
          }).observe(canvas);
        }
      });
      W.postMessage({ type: 'init', id, canvas: off, bitmap, o, w, h, disp, still }, [off, bitmap]);
    }

    return {
      start,
      set(next) {
        Object.assign(o, next);
        if (!live) return;
        const { w, h } = C.size(o, dispOf(canvas), img.naturalWidth, img.naturalHeight);
        const bitmap = scaledBitmap(img, w, h);
        W.postMessage({ type: 'set', id, next, w, h, bitmap }, [bitmap]);
      },
      stop() { stopped = true; W.postMessage({ type: 'stop', id }); }
    };
  }

  // Main-thread instance (fallback, or { worker: false }).
  const queue = [];
  let pumping = false;
  // One setup per task, so a burst of images arriving together can't freeze scrolling.
  function enqueue(fn) {
    queue.push(fn);
    if (!pumping) { pumping = true; setTimeout(pump, 0); }
  }
  function pump() {
    const fn = queue.shift();
    if (fn) { try { fn(); } catch (e) { /* leave the plain <img> in place */ } }
    if (queue.length) setTimeout(pump, 0); else pumping = false;
  }

  function mainInstance(img, canvas, o, still) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const s = { o };
    let built = false, raf = 0, last = 0, visible = !hasIO, stopped = false, t0 = 0;

    function setup() {
      const { w, h } = C.size(o, dispOf(canvas.isConnected ? canvas : img), img.naturalWidth, img.naturalHeight);
      s.w = w; s.h = h;
      canvas.width = w; canvas.height = h;
      ctx.drawImage(img, 0, 0, w, h);
      const src = ctx.getImageData(0, 0, w, h).data;
      s.frame = ctx.createImageData(w, h);
      C.build(s, src);
      built = true;
    }
    function render(now) {
      C.draw(s, (now - t0) / 1000, C.lineSize(s, canvas.clientWidth));
      ctx.putImageData(s.frame, 0, 0);
    }
    function loop(now) {
      raf = 0;
      if (stopped || !visible || !canvas.isConnected) return;
      raf = requestAnimationFrame(loop);
      if (now - last < C.interval(o)) return;
      last = now; render(now);
    }
    function wake() {
      if (!raf && built && !still && !stopped && visible) raf = requestAnimationFrame(loop);
    }
    function start() {
      if (stopped || !img.isConnected) return;
      t0 = performance.now();
      setup();
      img.replaceWith(canvas);
      render(performance.now());
      if (hasIO) {
        new IntersectionObserver((es) => { visible = es[es.length - 1].isIntersecting; wake(); }).observe(canvas);
      } else wake();
    }
    return {
      start: () => enqueue(start),
      set(next) { Object.assign(o, next); if (built) { setup(); render(performance.now()); wake(); } },
      stop() { stopped = true; cancelAnimationFrame(raf); raf = 0; }
    };
  }

  function apply(img, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const useWorker = o.worker !== false;
    delete o.worker;
    const canvas = document.createElement('canvas');
    canvas.className = img.className; canvas.style.cssText = img.style.cssText;
    canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', img.alt || '');
    const W = useWorker && getWorker();
    const inst = W ? workerInstance(img, canvas, o, reducedMotion(), W)
                   : mainInstance(img, canvas, o, reducedMotion());
    whenOnScreen(img, inst.start);
    return { canvas, set: inst.set, stop: inst.stop };
  }

  function auto() {
    document.querySelectorAll('img.shadow-flicker').forEach(img => {
      const d = img.dataset, opts = {};
      Object.keys(DEFAULTS).forEach(k => { if (d[k] !== undefined) opts[k] = k === 'mode' ? d[k] : +d[k]; });
      apply(img, opts);
    });
  }
  window.ShadowFlicker = { apply };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto); else auto();
})();
