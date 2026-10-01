/* shadow-flicker.js — mode 'flicker' (default) toggles pixels on/off in place; mode 'drift' is the original.
    screen-style striping that only appears in shadows and dark midtones.
   Usage: <img src="photo.jpg" class="shadow-flicker" data-focus="0.3" data-strength="0.8">
          <script src="shadow-flicker.js"><\/script>
   Or:    ShadowFlicker.apply(imgElement, { focus, spread, strength, dash, levels, speed, contrast })
   Images must be same-origin (or served with CORS headers). */
(function () {
  const DEFAULTS = { focus: 0.4, spread: 0.15, strength: 1, line: 0, mode: 'flicker', rate: 15, dash: 4, levels: 6, speed: 1, contrast: 1.2, fps: 24, showMask: false, maxWidth: 0, maxScale: 0 };
  const hash = (a, b, c) => { let h = (a * 374761393 + b * 668265263 + c * 2246822519) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };

  function apply(img, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const canvas = document.createElement('canvas');
    canvas.className = img.className; canvas.style.cssText = img.style.cssText;
    canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', img.alt || '');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let base, lumA, w, h, frame, raf, last = 0, visible = true;
    const t0 = performance.now(), still = matchMedia('(prefers-reduced-motion: reduce)').matches;

    function setup() {
      // Backing store size. Rendering far above display size costs memory and
      // render time for detail nobody sees: this retains 24 bytes/px (base 12 +
      // lumA 4 + frame 4 + canvas 4) for the life of the page. maxScale caps it
      // at a multiple of the element's laid-out width; maxWidth is an absolute
      // cap. Both default to 0 (off) -> the original 1600 ceiling. L and dash
      // scale with w, so stripe size in SCREEN pixels is unchanged either way.
      var disp = Math.round(img.getBoundingClientRect().width) || 0;
      var cap = o.maxWidth > 0 ? o.maxWidth
              : (o.maxScale > 0 && disp > 0 ? Math.ceil(disp * o.maxScale) : 0);
      if (!(cap > 64)) cap = 1600;
      w = Math.min(img.naturalWidth, cap); h = Math.round(w * img.naturalHeight / img.naturalWidth);
      canvas.width = w; canvas.height = h;
      ctx.drawImage(img, 0, 0, w, h);
      const src = ctx.getImageData(0, 0, w, h).data;
      base = new Float32Array(w * h * 3); lumA = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) {
        for (let k = 0; k < 3; k++) {
          let v = src[i * 4 + k] / 255 - 0.5;
          base[i * 3 + k] = Math.max(0, Math.min(1, 0.5 + v * o.contrast)) * 255;
        }
        lumA[i] = (base[i * 3] * 0.3 + base[i * 3 + 1] * 0.59 + base[i * 3 + 2] * 0.11) / 255;
      }
      frame = ctx.createImageData(w, h);
      render(0);
    }

    function render(t) {
      const d = frame.data, step = 255 / (Math.max(2, o.levels) - 1);
      const L = o.line > 0 ? o.line : Math.max(1, Math.round(w / (canvas.clientWidth || w)));
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
      ctx.putImageData(frame, 0, 0);
    }

    function loop(now) {
      raf = requestAnimationFrame(loop);
      if (!visible || now - last < 1000 / Math.max(o.fps, o.mode !== 'drift' ? o.rate : 0)) return;
      last = now; render((now - t0) / 1000);
    }

    function start() {
      setup(); img.replaceWith(canvas);
      if (!still) raf = requestAnimationFrame(loop);
      if ('IntersectionObserver' in window) new IntersectionObserver(e => { visible = e[0].isIntersecting; }).observe(canvas);
    }
    if (img.complete && img.naturalWidth) start(); else img.addEventListener('load', start, { once: true });

    return {
      canvas,
      set(next) { const c = next.contrast !== undefined && next.contrast !== o.contrast; Object.assign(o, next); if (base) { c ? setup() : render((performance.now() - t0) / 1000); } },
      stop() { cancelAnimationFrame(raf); }
    };
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
