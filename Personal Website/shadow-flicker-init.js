/* shadow-flicker-init.js — applies the shadow-flicker effect to every image on the site.

   Most images here are injected by app.js after DOMContentLoaded (the photo
   mosaic, blog cards, music cover art), and the mosaic re-renders whenever a
   tag filter changes. shadow-flicker.js's own auto() only scans once at load,
   so it would miss nearly everything. This watches the DOM instead.

   Per-image overrides still work: any data-* attribute on an <img> wins over
   the PRESET below. Opt out with class="no-flicker" on the image, or
   data-no-flicker on any ancestor. */
(function () {
  if (!window.ShadowFlicker) return;

  // Nico's preset.
  var PRESET = {
    focus: 0.47,
    spread: 0.22,
    strength: 1,
    dash: 4,
    levels: 7,
    rate: 7,
    contrast: 1.15,

    // Not in the original spec, but free: the loop throttles at
    // 1000 / max(fps, rate), and in flicker mode the output is a pure
    // function of floor(t * rate) -- so at rate 7 the default fps of 24
    // re-renders each frame ~3.4x for a byte-identical result (verified:
    // 0 of 750,000 pixels differ). Matching fps to rate cuts ~71% of the
    // main-thread work with no visual change.
    fps: 7
  };

  var KEYS = ["focus", "spread", "strength", "line", "mode", "rate",
              "dash", "levels", "speed", "contrast", "fps", "showMask"];

  // getImageData() throws on a cross-origin image, which would leave a blank
  // canvas in place of a working <img>. Everything on this site is local, but
  // check anyway so a future external URL degrades to a plain image.
  function sameOrigin(img) {
    try {
      return new URL(img.currentSrc || img.src, location.href).origin === location.origin;
    } catch (e) {
      return false;
    }
  }

  function optsFor(img) {
    var o = {}, k, v, i;
    for (k in PRESET) o[k] = PRESET[k];
    for (i = 0; i < KEYS.length; i++) {
      v = img.dataset[KEYS[i]];
      if (v !== undefined) o[KEYS[i]] = KEYS[i] === "mode" ? v : +v;
    }
    return o;
  }

  function enhance(img) {
    if (img.dataset.sfDone) return;
    if (img.classList.contains("no-flicker")) return;
    if (img.closest("[data-no-flicker]")) return;
    if (!img.getAttribute("src")) return;
    if (!sameOrigin(img)) return;

    img.dataset.sfDone = "1";
    try {
      window.ShadowFlicker.apply(img, optsFor(img));
    } catch (e) {
      delete img.dataset.sfDone; // leave the plain <img> alone
    }
  }

  function scan(root) {
    if (root.tagName === "IMG") { enhance(root); return; }
    if (!root.querySelectorAll) return;
    var imgs = root.querySelectorAll("img:not([data-sf-done])"), i;
    for (i = 0; i < imgs.length; i++) enhance(imgs[i]);
  }

  function boot() {
    scan(document);
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var added = muts[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          if (added[j].nodeType === 1) scan(added[j]);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
