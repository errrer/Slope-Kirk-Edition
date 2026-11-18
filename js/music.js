/* Custom songs: add your own audio files (mp3 etc.) in Settings and they play
 * as a looping playlist while you play. Songs are stored in this browser
 * (IndexedDB), so they stay after you close the page. */
(function () {
  'use strict';

  var DB = 'slopeMusic', STORE = 'songs';
  var songs = [], cur = -1, objUrl = null, db = null, started = false;
  var audio = new Audio();
  audio.preload = 'auto';

  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  var userPaused = get('slopeMusicPaused') === '1';
  var loop = get('slopeMusicLoop') !== '0';          // default: loop on
  var volume = get('slopeMusicVol') !== null ? Number(get('slopeMusicVol')) : 70;
  if (!(volume >= 0 && volume <= 100)) volume = 70;
  audio.volume = volume / 100;

  // ---------- storage ----------
  function openDB() {
    return new Promise(function (res, rej) {
      if (!window.indexedDB) return rej(new Error('no indexedDB'));
      var r = indexedDB.open(DB, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true }); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function tx(mode) { return db.transaction(STORE, mode).objectStore(STORE); }
  function loadAll() {
    return new Promise(function (res) {
      var r = tx('readonly').getAll();
      r.onsuccess = function () { res(r.result || []); };
      r.onerror = function () { res([]); };
    });
  }
  function put(rec) {
    return new Promise(function (res, rej) {
      var r = tx('readwrite').add(rec);
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function del(id) {
    return new Promise(function (res) {
      var r = tx('readwrite').delete(id);
      r.onsuccess = r.onerror = function () { res(); };
    });
  }

  // ---------- playback ----------
  function playIndex(i) {
    if (!songs.length) return;
    cur = ((i % songs.length) + songs.length) % songs.length;
    if (objUrl) URL.revokeObjectURL(objUrl);
    objUrl = URL.createObjectURL(songs[cur].blob);
    audio.src = objUrl;
    var p = audio.play();
    if (p && p.catch) p.catch(function () { /* waits for a click/key */ });
    render();
  }
  audio.addEventListener('ended', function () {
    if (cur + 1 < songs.length) playIndex(cur + 1);       // next song
    else if (loop) playIndex(0);                          // end of playlist: start over
    else { cur = 0; audio.removeAttribute('src'); render(); }   // loop off: stop
  });
  audio.addEventListener('error', function () { if (songs.length > 1) playIndex(cur + 1); });

  function toggle() {
    if (!songs.length) return;
    if (audio.paused) {
      userPaused = false; set('slopeMusicPaused', '0');
      if (cur < 0 || !audio.src) playIndex(0); else audio.play().catch(function () {});
    } else {
      userPaused = true; set('slopeMusicPaused', '1'); audio.pause();
    }
    render();
  }

  // browsers only allow sound after a click or key press
  function onGesture() {
    if (started || userPaused || !songs.length) return;
    started = true;
    window.removeEventListener('pointerdown', onGesture, true);
    window.removeEventListener('keydown', onGesture, true);
    if (audio.paused) playIndex(cur < 0 ? 0 : cur);
  }
  window.addEventListener('pointerdown', onGesture, true);
  window.addEventListener('keydown', onGesture, true);

  // ---------- UI ----------
  var box;
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function render() {
    if (!box) return;
    var list = box.querySelector('#sm-list');
    if (!songs.length) {
      list.innerHTML = '<div class="sm-empty">No songs yet. Add some mp3 files.</div>';
    } else {
      list.innerHTML = songs.map(function (s, i) {
        return '<div class="sm-row' + (i === cur ? ' sm-cur' : '') + '" data-i="' + i + '">' +
          '<span class="sm-name" data-play="' + i + '" title="Play this song">' + (i === cur && !audio.paused ? '▶ ' : '') + esc(s.name) + '</span>' +
          '<span class="sm-x" data-del="' + i + '" title="Remove">×</span></div>';
      }).join('');
    }
    box.querySelector('#sm-toggle').textContent = audio.paused ? '▶ Play' : '⏸ Pause';
  }
  audio.addEventListener('play', render);
  audio.addEventListener('pause', render);

  function mount(panel) {
    var css = document.createElement('style');
    css.textContent =
      '#sl-panel{max-height:calc(100vh - 80px);overflow:auto}' +
      '#sm-box{margin-top:14px;padding-top:10px;border-top:1px solid #0f0}' +
      '#sm-box h3{margin:0 0 8px;font:bold 16px monospace}' +
      '#sm-list{max-height:130px;overflow:auto;margin:6px 0}' +
      '.sm-row{display:flex;justify-content:space-between;gap:8px;padding:3px 2px}' +
      '.sm-row.sm-cur{background:#032}' +
      '.sm-name{cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}' +
      '.sm-x{cursor:pointer;color:#f55;font-weight:bold;padding:0 4px}' +
      '.sm-empty{opacity:.7;font-size:12px}' +
      '#sm-box .sm-btns button{margin:4px 4px 0 0}' +
      '.sm-loop{display:block;margin:8px 0 0;cursor:pointer}' +
      '#sm-vol{width:100%;margin-top:8px;accent-color:#0f0}';
    document.head.appendChild(css);

    box = document.createElement('div');
    box.id = 'sm-box';
    box.innerHTML =
      '<h3>Custom songs</h3>' +
      '<div id="sm-list"></div>' +
      '<div class="sm-btns"><button id="sm-add">Add mp3...</button><button id="sm-toggle">▶ Play</button><button id="sm-next">⏭ Next</button></div>' +
      '<label class="sm-loop"><input id="sm-loop" type="checkbox"' + (loop ? ' checked' : '') + '> Loop playlist</label>' +
      '<input id="sm-file" type="file" accept="audio/*,.mp3" multiple style="display:none">' +
      '<input id="sm-vol" type="range" min="0" max="100" value="' + volume + '" title="Volume">' +
      '<div id="sl-note">Songs play on loop alongside the game and are saved in this browser. Use the speaker button in the game to turn the original sounds off.</div>';
    panel.appendChild(box);

    box.querySelector('#sm-add').addEventListener('click', function () { box.querySelector('#sm-file').click(); });
    box.querySelector('#sm-toggle').addEventListener('click', toggle);
    box.querySelector('#sm-loop').addEventListener('change', function (e) { loop = e.target.checked; set('slopeMusicLoop', loop ? '1' : '0'); });
    box.querySelector('#sm-next').addEventListener('click', function () { if (songs.length) { userPaused = false; set('slopeMusicPaused', '0'); playIndex(cur + 1); } });
    box.querySelector('#sm-vol').addEventListener('input', function (e) {
      volume = Number(e.target.value); audio.volume = volume / 100; set('slopeMusicVol', String(volume));
    });
    box.querySelector('#sm-file').addEventListener('change', function (e) {
      var files = Array.prototype.slice.call(e.target.files || []);
      e.target.value = '';
      if (!db) { alert('Your browser blocked saving songs (private mode?).'); return; }
      var wasEmpty = !songs.length;
      Promise.all(files.map(function (f) {
        var rec = { name: f.name.replace(/\.[^.]+$/, ''), blob: f };
        return put(rec).then(function (id) { rec.id = id; songs.push(rec); });
      })).then(function () {
        render();
        if (wasEmpty && songs.length) { userPaused = false; set('slopeMusicPaused', '0'); started = true; playIndex(0); }
      }, function () { alert('Could not save those songs (storage full?).'); });
    });
    box.addEventListener('click', function (e) {
      var pl = e.target.getAttribute && e.target.getAttribute('data-play');
      var dl = e.target.getAttribute && e.target.getAttribute('data-del');
      if (pl !== null && pl !== undefined) { userPaused = false; set('slopeMusicPaused', '0'); started = true; playIndex(Number(pl)); }
      if (dl !== null && dl !== undefined) {
        var i = Number(dl), rec = songs[i];
        del(rec.id).then(function () {
          songs.splice(i, 1);
          if (i === cur) { audio.pause(); audio.removeAttribute('src'); cur = -1; if (songs.length && !userPaused) playIndex(i); }
          else if (i < cur) cur--;
          render();
        });
      }
    });
    render();
  }

  openDB().then(function (d) { db = d; return loadAll(); }).then(function (all) {
    songs = all; if (songs.length && cur < 0) cur = 0; render();
  }, function () { /* storage unavailable: feature stays empty */ });

  document.addEventListener('DOMContentLoaded', function () {
    var panel = document.getElementById('sl-panel');
    if (panel) mount(panel);
  });

  window.SlopeMusic = { state: function () { return { songs: songs.length, cur: cur, loop: loop, paused: audio.paused, t: audio.currentTime, src: !!audio.src, vol: audio.volume }; } };
})();
