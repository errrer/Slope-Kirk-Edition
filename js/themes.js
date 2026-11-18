/* Slope themes: settings menu + texture swapping.
 *
 * The game is a compiled Unity WebGL build, so themes work by swapping the
 * game's five tile textures as they are uploaded to the GPU:
 *   polygon, polygonThin       -> safe (green) parts
 *   polygonRed, polygonRedThin -> lava (red) parts, the ones that kill you
 *   speedArrow                 -> speed-up arrows (glowing green)
 * Each texture is recognised by a hash of its original pixels.
 */
(function () {
  'use strict';

  var THEMES = {
    classic: { name: 'Classic (original)' },
    azam: { name: 'Azam Khan', src: 'themes/azam-khan.jpg' },
    custom: { name: 'Custom image' }
  };
  var KEY = 'slopeTheme', IMG_KEY = 'slopeCustomImage';
  var ARROW_SRC = 'themes/arrow-glow.png';
  var SIZE = 256;

  // fnv1a hash of the original level-0 pixels -> which tile it is
  var TILES = {
    'a49bb6b5': { kind: 'green', border: 14, dim: 1.0 },   // polygon
    'b715ede1': { kind: 'green', border: 8,  dim: 1.0 },   // polygonThin
    'd06a5141': { kind: 'red',   border: 14, dim: 1.0 },   // polygonRed
    '9956c33f': { kind: 'red',   border: 10, dim: 0.7 },   // polygonRedThin
    '87223d03': { kind: 'arrow' }                          // speedArrow
  };

  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }

  var theme = get(KEY) || 'classic';
  if (!THEMES[theme]) theme = 'classic';
  if (theme === 'custom' && !get(IMG_KEY)) theme = 'classic';

  var tiles = {};      // hash -> RGBA Uint8Array(SIZE*SIZE*4)
  var ready;

  function loadImage(src) {
    return new Promise(function (res, rej) {
      var im = new Image();
      im.onload = function () { res(im); };
      im.onerror = function () { rej(new Error('image failed: ' + src.slice(0, 40))); };
      im.src = src;
    });
  }

  function squareCanvas(img, size) {
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var x = c.getContext('2d');
    var s = Math.min(img.width, img.height);
    x.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
    return c;
  }

  function buildTile(photoData, cfg) {
    var out = new Uint8Array(SIZE * SIZE * 4);
    var red = cfg.kind === 'red';
    for (var y = 0; y < SIZE; y++) {
      for (var x = 0; x < SIZE; x++) {
        var i = (y * SIZE + x) * 4;
        var edge = Math.min(x, y, SIZE - 1 - x, SIZE - 1 - y);
        var r, g, b;
        if (edge < cfg.border) {            // bright coloured border keeps tile edges readable
          r = red ? 255 : 0; g = red ? 0 : 255; b = 0;
          r *= cfg.dim; g *= cfg.dim;
        } else {                            // photo, tinted
          var lum = (0.299 * photoData[i] + 0.587 * photoData[i + 1] + 0.114 * photoData[i + 2]) / 255;
          lum = Math.min(1, 0.12 + lum * 0.95) * cfg.dim;
          r = red ? 255 * lum : 0;
          g = red ? 0 : 255 * lum;
          b = 0;
        }
        out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = 255;
      }
    }
    return out;
  }

  function prepare() {
    if (theme === 'classic') return Promise.resolve();
    var photoSrc = theme === 'custom' ? get(IMG_KEY) : THEMES[theme].src;
    return Promise.all([loadImage(photoSrc), loadImage(ARROW_SRC)]).then(function (r) {
      var photo = squareCanvas(r[0], SIZE).getContext('2d').getImageData(0, 0, SIZE, SIZE).data;
      var arrow = squareCanvas(r[1], SIZE).getContext('2d').getImageData(0, 0, SIZE, SIZE).data;
      Object.keys(TILES).forEach(function (h) {
        var cfg = TILES[h];
        if (cfg.kind === 'arrow') {
          var a = new Uint8Array(SIZE * SIZE * 4);
          for (var i = 0; i < a.length; i++) a[i] = arrow[i];
          tiles[h] = a;
        } else {
          tiles[h] = buildTile(photo, cfg);
        }
      });
    });
  }

  function hashOf(view) {
    if (!view) return '';
    var a = new Uint8Array(view.buffer, view.byteOffset || 0, Math.min(view.byteLength, 4096));
    var x = 2166136261;
    for (var i = 0; i < a.length; i++) { x ^= a[i]; x = Math.imul(x, 16777619) >>> 0; }
    return x.toString(16);
  }

  function installHooks() {
    [window.WebGL2RenderingContext].forEach(function (C) {
      if (!C) return;
      var P = C.prototype;
      var oBind = P.bindTexture, oActive = P.activeTexture, oStorage = P.texStorage2D,
          oSub = P.texSubImage2D, oCSub = P.compressedTexSubImage2D, oMip = P.generateMipmap,
          oStore = P.pixelStorei;
      var unit = 0, bound = {};

      P.activeTexture = function (u) { unit = u - 0x84C0; return oActive.call(this, u); };
      P.bindTexture = function (t, tex) { if (t === 0x0DE1) bound[unit] = tex; return oBind.call(this, t, tex); };

      // Unity allocates the 32x32, 6-level tiles with immutable storage: swap for a big RGBA texture.
      P.texStorage2D = function (t, levels, ifmt, w, h) {
        if (t === 0x0DE1 && levels === 6 && w === 32 && h === 32 && (ifmt === 32849 || ifmt === 33776)) {
          var tex = bound[unit];
          if (tex) { tex.__slopeTheme = true; return oStorage.call(this, t, 9, 32856, SIZE, SIZE); }
        }
        return oStorage.call(this, t, levels, ifmt, w, h);
      };

      function themed(gl, t, level, view) {
        var tex = bound[unit];
        if (t !== 0x0DE1 || !tex || !tex.__slopeTheme) return false;
        if (level !== 0) return true;                      // mips are regenerated below
        var h = hashOf(view);
        var px = tiles[h] || tiles['a49bb6b5'];
        var gen = gl.getParameter(0x9240), pre = gl.getParameter(0x9241), al = gl.getParameter(0x0CF5);
        oStore.call(gl, 0x9240, false); oStore.call(gl, 0x9241, false); oStore.call(gl, 0x0CF5, 1);
        oSub.call(gl, t, 0, 0, 0, SIZE, SIZE, 0x1908, 0x1401, px);
        oMip.call(gl, t);
        oStore.call(gl, 0x9240, gen); oStore.call(gl, 0x9241, pre); oStore.call(gl, 0x0CF5, al);
        return true;
      }

      P.texSubImage2D = function (t, level, xo, yo, w, h, fmt, type, px) {
        if (arguments.length === 9 && themed(this, t, level, px)) return;
        return oSub.apply(this, arguments);
      };
      P.compressedTexSubImage2D = function (t, level, xo, yo, w, h, fmt, data) {
        if (themed(this, t, level, data)) return;
        return oCSub.apply(this, arguments);
      };
    });
  }

  // ---------- settings UI ----------
  function buildUI() {
    var css = document.createElement('style');
    css.textContent =
      '#sl-gear{position:fixed;left:10px;top:10px;z-index:9999;width:42px;height:42px;border:2px solid #0f0;background:#000;color:#0f0;font:26px/36px monospace;text-align:center;cursor:pointer;border-radius:6px;opacity:.85;user-select:none}' +
      '#sl-gear:hover{opacity:1}' +
      '#sl-panel{position:fixed;left:10px;top:60px;z-index:9999;width:260px;padding:14px;background:#000;border:2px solid #0f0;border-radius:6px;color:#0f0;font:14px monospace;display:none}' +
      '#sl-panel h3{margin:0 0 10px;font:bold 16px monospace}' +
      '#sl-panel label{display:block;margin:7px 0;cursor:pointer}' +
      '#sl-panel button{margin-top:8px;background:#000;color:#0f0;border:1px solid #0f0;padding:6px 10px;font:14px monospace;cursor:pointer;border-radius:4px}' +
      '#sl-panel button:hover{background:#0f0;color:#000}' +
      '#sl-note{margin-top:10px;font-size:12px;opacity:.75}';
    document.head.appendChild(css);

    var gear = document.createElement('div');
    gear.id = 'sl-gear'; gear.title = 'Settings'; gear.textContent = '⚙';
    var panel = document.createElement('div');
    panel.id = 'sl-panel';
    var h = '<h3>Settings - Themes</h3>';
    Object.keys(THEMES).forEach(function (k) {
      h += '<label><input type="radio" name="sl-theme" value="' + k + '"' + (k === theme ? ' checked' : '') + '> ' + THEMES[k].name + '</label>';
    });
    h += '<button id="sl-custom-btn">Custom theme: choose image...</button>' +
         '<input id="sl-file" type="file" accept="image/*" style="display:none">' +
         '<div id="sl-note">Safe parts are green, lava is red, speed arrows glow green. The page reloads to apply a theme.</div>';
    panel.innerHTML = h;
    document.body.appendChild(gear);
    document.body.appendChild(panel);

    gear.addEventListener('click', function () { panel.style.display = panel.style.display === 'block' ? 'none' : 'block'; });
    panel.addEventListener('change', function (e) {
      if (e.target.name !== 'sl-theme') return;
      if (e.target.value === 'custom' && !get(IMG_KEY)) { document.getElementById('sl-file').click(); return; }
      set(KEY, e.target.value); location.reload();
    });
    document.getElementById('sl-custom-btn').addEventListener('click', function () { document.getElementById('sl-file').click(); });
    document.getElementById('sl-file').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var url = URL.createObjectURL(f);
      loadImage(url).then(function (img) {
        var data = squareCanvas(img, 512).toDataURL('image/jpeg', 0.85);
        if (!set(IMG_KEY, data)) { alert('Could not save that image (browser storage is full or blocked).'); return; }
        set(KEY, 'custom'); location.reload();
      }, function () { alert('That file could not be read as an image.'); });
    });
  }

  ready = prepare().then(function () {
    if (theme !== 'classic') installHooks();
  }).catch(function (err) {
    if (window.console) console.warn('Theme failed, using classic:', err);
    tiles = {};
  });
  document.addEventListener('DOMContentLoaded', buildUI);
  window.SlopeThemes = { ready: ready, theme: theme };
})();
