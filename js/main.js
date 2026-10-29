/*
 * MemoryBurn - js/main.js
 *
 * Boot, the fixed-step loop and the screen state machine. The sim steps at D.STEP (60 Hz); rendering
 * interpolates between the previous and current step. Everything that touches the sim goes through
 * stepRun / app.cmd.
 *
 * Online co-op (js/net/net.js): app.coop is set for the whole run. The host steps the real sim on every screen
 * (menus don't pause a shared run), feeds the other slots from MB.net.inputFor and sends its events out. A guest
 * never steps: app.sim is a mirror that MB.net fills from snapshots, app.cmd sends commands to the host, and the
 * frame listener plays each snapshot's events.
 */
(function () {
  'use strict';
  var D = MB.data, R = MB.render, IN = MB.input, UI = MB.ui, SC = MB.screens, ST = MB.data.STORY;
  var W = D.VIRTUAL_W, H = D.VIRTUAL_H, STEP = D.STEP;
  var canvas, g;
  var params = new URLSearchParams(location.search);

  /* ------------------------------------------------------------------ settings */
  var KEY = 'memoryburn.settings.v1';
  var DEFAULTS = {
    manualFire: false, aimAssist: false, shake: true, tracers: true, dmgNums: true, reducedFlashes: false, rangeRing: true,
    uiScale: 100, textSize: 100, vfx: 100, gameSpeed: 100, dmgTaken: 100, fpsCap: 0, skipStory: false, radio: true,
    resolution: 0, // % of native pixels; 0 = Auto (drops when frames run slow)
    masterVol: 80, musicVol: 70, sfxVol: 80
  };
  function loadSettings() {
    var s = {}, k;
    for (k in DEFAULTS) s[k] = DEFAULTS[k];
    try {
      var raw = window.localStorage.getItem(KEY);
      if (raw) { var o = JSON.parse(raw); for (k in DEFAULTS) if (typeof o[k] === typeof DEFAULTS[k]) s[k] = o[k]; }
    } catch (e) { /* storage blocked: defaults */ }
    return s;
  }
  var savedJson = '';

  /* ------------------------------------------------------------------ app */
  var ATTRACT_SCREENS = { menu: 1, options: 1, chars: 1, difficulty: 1 };
  var app = MB.app = {
    version: '0.2.0', screen: 'menu', screenT: 0, t: 0, menuT0: 0,
    settings: loadSettings(), debug: params.has('debug'),
    sim: null, slot: 0, prev: null, alpha: 1, acc: 0,
    arch: 0, difficulty: 'Normal', pauseTab: 0, story: null, ending: null, bannerT: 0, deathT: 0,
    dps: 0, fps: 60, optionsReturn: 'menu', coop: false, toasts: [], coopMsg: ''
  };
  var dmgLog = [];
  var attract = { sim: null, prev: null, acc: 0, alpha: 1 };

  app.go = function (name) {
    if (name === 'options') app.optionsReturn = app.screen === 'pause' ? 'pause' : 'menu';
    if (name === 'menu' && app.screen !== 'options') app.menuT0 = app.t;
    app.screen = name; app.screenT = 0;
    UI.clearFocus(); IN.flush();
    app.saveSettings();
  };

  function fxSettings(local) {
    var s = app.settings;
    return { shake: local && s.shake, tracers: s.tracers, dmgNums: local && s.dmgNums, reducedFlashes: s.reducedFlashes, vfx: s.vfx / 100, localSlot: local ? app.slot : -1 };
  }

  app.applySettings = function () {
    var s = app.settings;
    UI.textScale = s.textSize / 100;
    MB.audio.setVolumes(s);
    if (app.sim && !app.sim.remote) { app.sim.settings.gameSpeed = s.gameSpeed / 100; app.sim.settings.dmgTaken = s.dmgTaken / 100; } // a guest shows the host's
  };
  app.saveSettings = function () {
    var j = JSON.stringify(app.settings);
    if (j === savedJson) return;
    savedJson = j;
    try { window.localStorage.setItem(KEY, j); } catch (e) { /* storage blocked */ }
  };

  function newSeed() {
    if (params.has('seed')) return (+params.get('seed')) >>> 0;
    return (Math.random() * 4294967296) >>> 0; // UI-side only; the sim never sees Math.random
  }

  app.startRun = function () {
    app.sim = MB.sim.create({
      seed: newSeed(), difficulty: app.difficulty, players: [{ arch: app.arch }],
      settings: { gameSpeed: app.settings.gameSpeed / 100, dmgTaken: app.settings.dmgTaken / 100 }
    });
    app.slot = 0; app.prev = null; app.acc = 0; app.alpha = 1; dmgLog = []; app.dps = 0;
    app.bannerT = 2.4; app.deathT = 0; app.pauseTab = 0;
    R.fx.reset(); MB.radio.reset(); app.ending = null;
    if (!app.settings.skipStory) {
      app.story = { beats: ST.resolve(ST.intro, app.arch), idx: 0, chars: 0, head: SC.actHead(1), sub: 'Doc\'s clinic, Neon Grid' };
      app.go('intro');
    } else app.go('play');
  };
  app.toMenu = function () {
    if (app.coop || MB.net.state !== 'idle') MB.net.leave();
    app.coop = false; app.sim = null; R.fx.reset(); app.go('menu');
  };

  app.toast = function (msg) {
    app.toasts.push({ msg: String(msg), t: 0 });
    if (app.toasts.length > 4) app.toasts.shift();
  };

  // Sim commands from the UI. A guest sends them to the host, which applies them for that guest's slot.
  app.cmd = function (c) {
    if (!app.sim) return false;
    if (app.coop && app.sim.remote) return MB.net.sendCmd(c);
    return app.hostCmd(app.slot, c);
  };
  app.hostCmd = function (slot, c) {
    var s = app.sim;
    if (!s || s.remote) return false;
    var ok = MB.sim.command(s, slot, c);
    R.fx.consume(s.events, fxSettings(true));
    MB.audio.events(app, s.events);
    if (app.coop) { MB.net.hostEvents(s.events); MB.net.hostChanged(); }
    afterSim();
    return ok;
  };

  // A co-op run starts (or this client becomes the host of one). info: {meta, localSlot, role, spectator, late, migrated}
  app.startCoopRun = function (info) {
    app.coop = true; app.slot = info.localSlot | 0;
    if (info.migrated) { app.prev = null; app.acc = 0; app.alpha = 1; afterSim(); return; } // net already swapped in the restored sim
    var meta = info.meta;
    app.sim = info.role === 'host' ? MB.sim.create(meta) : MB.snap.newMirror(meta);
    app.prev = null; app.acc = 0; app.alpha = 1; dmgLog = []; app.dps = 0;
    app.bannerT = 2.4; app.deathT = 0; app.pauseTab = 0;
    R.fx.reset(); MB.radio.reset(); app.ending = null;
    var me = meta.players[app.slot];
    app.arch = me ? me.arch : 0;
    if (!app.settings.skipStory && !info.late && !info.spectator) {
      app.story = { beats: ST.resolve(ST.intro, app.arch), idx: 0, chars: 0, head: SC.actHead(1), sub: 'Doc\'s clinic, Neon Grid' };
      app.go('intro');
    } else { MB.net.storyDone(); app.go('play'); }
  };

  // In co-op the phase moves on without this client (others ready up, a late joiner lands mid-shop), so any
  // in-run screen follows it; the pause menu is only an overlay there.
  var COOP_RUN = { play: 1, pause: 1, shop: 1, preview: 1, gameover: 1 };
  function afterSim() {
    var s = app.sim;
    if (!s) return;
    if (app.coop) {
      var sc = app.screen;
      if (!COOP_RUN[sc]) return;
      if (s.phase === 'play' && sc !== 'play' && sc !== 'pause') { R.fx.reset(); app.prev = null; app.acc = 0; app.bannerT = 2.4; app.deathT = 0; dmgLog = []; app.go('play'); return; }
      if (s.phase === 'shop' && sc !== 'shop') {
        if (s.wave === ST.last && !app.settings.skipStory && sc !== 'gameover') {
          app.ending = { stage: 'lead', choice: null, story: { beats: ST.ending.lead, idx: 0, chars: 0, head: 'The Vault', sub: 'Under the reactor' } };
          app.go('ending');
        } else app.go('shop');
        return;
      }
      if (s.phase === 'preview' && sc !== 'preview') { sc = 'shop'; app.screen = 'shop'; }
      if (s.phase === 'gameover' && (sc === 'play' || sc === 'pause')) { if (app.deathT <= 0) app.deathT = 1.6; return; }
    }
    if (s.phase === 'shop' && app.screen === 'play') {
      if (s.wave === ST.last && !app.settings.skipStory) { // the campaign's last contract just ended
        app.ending = { stage: 'lead', choice: null, story: { beats: ST.ending.lead, idx: 0, chars: 0, head: 'The Vault', sub: 'Under the reactor' } };
        app.go('ending');
      } else app.go('shop');
    } else if (s.phase === 'preview' && app.screen === 'shop') {
      var ct = ST.contract(s.wave + 1);
      app.story = ct && ct.scene && !app.settings.skipStory
        ? { beats: ST.resolve(ct.scene, s.players[app.slot].arch), idx: 0, chars: 0, head: SC.actHead(s.wave + 1), sub: 'Before contract ' + (s.wave + 1) + ': ' + ct.title } : null;
      app.go('preview');
    } else if (s.phase === 'play' && app.screen === 'preview') {
      R.fx.reset(); app.prev = null; app.acc = 0; app.bannerT = 2.4; dmgLog = [];
      app.go('play');
    } else if (s.phase === 'gameover' && app.screen === 'play' && app.deathT <= 0) app.deathT = 1.6;
  }

  /* ------------------------------------------------------------------ input -> sim */
  function sampleInput(s) {
    var p = s.players[app.slot], inp = IN.sample(p, app.settings);
    if (app.settings.aimAssist && inp.manual) {
      // nudge aim onto the nearest enemy within ~16 degrees of the cursor direction
      var aa = Math.atan2(inp.aimY - p.y, inp.aimX - p.x), best = null, bd = Infinity;
      s.enemies.forEach(function (e) {
        var da = Math.abs(Math.atan2(Math.sin(Math.atan2(e.y - p.y, e.x - p.x) - aa), Math.cos(Math.atan2(e.y - p.y, e.x - p.x) - aa)));
        var d = MB.util.dist(p.x, p.y, e.x, e.y);
        if (da < 0.28 && d < p.range_px && d < bd) { bd = d; best = e; }
      });
      if (best) { inp.aimX = best.x; inp.aimY = best.y; }
    }
    return inp;
  }

  // What the local runner sends while a menu covers the arena: stand still, keep the aim.
  function idleInput(p) { return { mx: 0, my: 0, dash: false, aimX: p.aimX, aimY: p.aimY, fire: false, manual: !!app.settings.manualFire }; }

  function stepRun(dt) {
    var s = app.sim;
    app.acc += dt;
    var n = 0;
    while (app.acc >= STEP && s.phase === 'play' && n < 8) {
      app.prev = R.snapshot(s);
      var inputs = s.players.map(function (pl, i) {
        if (i === app.slot) return app.screen === 'play' ? sampleInput(s) : idleInput(pl);
        return app.coop ? MB.net.inputFor(s, i) : MB.bot.input(s, i);
      });
      MB.sim.step(s, inputs);
      if (app.coop) MB.net.hostEvents(s.events);
      R.fx.consume(s.events, fxSettings(true));
      MB.radio.events(app, s.events);
      MB.audio.events(app, s.events);
      for (var i = 0; i < s.events.length; i++) {
        var e = s.events[i];
        if (e.t === 'hit' && e.slot === app.slot) dmgLog.push([s.time, e.dmg]);
      }
      app.acc -= STEP; n++;
    }
    if (n === 8) app.acc = 0; // fell far behind (tab was hidden): drop the backlog
    app.alpha = s.phase === 'play' ? app.acc / STEP : 1;
    while (dmgLog.length && dmgLog[0][0] < s.time - 3) dmgLog.shift();
    if (dmgLog.length) {
      var tot = 0; dmgLog.forEach(function (d) { tot += d[1]; });
      app.dps = Math.round(tot / Math.min(3, Math.max(0.5, s.time - dmgLog[0][0])));
    } else app.dps = 0;
    afterSim();
  }

  function stepAttract(dt) {
    var a = attract;
    if (!a.sim || a.sim.phase === 'gameover' || a.sim.wave > 3) {
      a.sim = MB.sim.create({ seed: newSeed(), players: [{ arch: (Math.random() * 8) | 0 }] });
      a.prev = null; a.acc = 0; R.fx.reset();
    }
    var s = a.sim;
    if (s.phase === 'shop') { MB.bot.shop(s, 0).forEach(function (c) { MB.sim.command(s, 0, c); }); }
    if (s.phase === 'preview') { MB.sim.command(s, 0, { t: 'deploy' }); R.fx.reset(); a.prev = null; }
    a.acc += dt;
    var n = 0;
    while (a.acc >= STEP && s.phase === 'play' && n < 8) {
      a.prev = R.snapshot(s);
      MB.sim.step(s, [MB.bot.input(s, 0)]);
      R.fx.consume(s.events, fxSettings(false));
      a.acc -= STEP; n++;
    }
    if (n === 8) a.acc = 0;
    a.alpha = a.acc / STEP;
  }

  // A guest: snapshots move the mirror (net.tick); this only sends input and picks up the interpolation.
  function guestRun() {
    var s = app.sim, v = MB.net.view();
    app.slot = MB.net.localSlot(); // a late joiner gets a dropped runner's slot after the host hears from them
    var p = s.players[app.slot];
    app.prev = v.prev; app.alpha = v.alpha;
    if (!p || MB.net.isSpectator()) return;
    MB.net.sendInput(app.screen === 'play' && app.deathT <= 0 ? sampleInput(s) : idleInput(p));
  }

  function coopUpdate(dt) {
    var s = app.sim, sc = app.screen;
    if (sc === 'play') {
      if (app.deathT > 0) {
        app.deathT -= dt;
        if (app.deathT <= 0) app.go('gameover');
      } else if (IN.pressed('Escape') || IN.padPressed('start')) { app.pauseTab = 0; app.go('pause'); }
    }
    var held = MB.net.holding() > 0;
    if (held) app.bannerT = 2.4; // the contract banner plays once the crew is in
    if (s.remote) guestRun();
    else {
      if (!held) stepRun(dt); else { app.prev = null; app.alpha = 1; }
      MB.net.autopilot(s);
    }
    if (sc === 'play' || sc === 'pause') { MB.radio.update(app, dt); app.bannerT = Math.max(0, app.bannerT - dt); }
  }

  /* ------------------------------------------------------------------ frame */
  function update(dt) {
    app.t += dt; app.screenT += dt;
    for (var ti = app.toasts.length - 1; ti >= 0; ti--) { app.toasts[ti].t += dt; if (app.toasts[ti].t > 4.5) app.toasts.splice(ti, 1); }
    var sc = app.screen;
    if (app.debug && app.sim) {
      if (IN.pressed('Digit8') && sc === 'play') app.cmd({ t: 'debugSkip' });
      if (IN.pressed('Digit9')) app.cmd({ t: 'debugCash' });
    }
    if (app.coop && app.sim) coopUpdate(dt);
    else if (sc === 'play' && app.sim) {
      if (app.deathT > 0) {
        app.deathT -= dt;
        if (app.deathT <= 0) app.go('gameover');
      } else if (IN.pressed('Escape') || IN.padPressed('start')) {
        app.pauseTab = 0; app.go('pause');
      } else stepRun(dt);
      MB.radio.update(app, dt);
      app.bannerT = Math.max(0, app.bannerT - dt);
    } else if (ATTRACT_SCREENS[sc]) stepAttract(dt);
    MB.net.tick(dt); // after the host stepped, so its snapshot is the newest state
    var ws = worldState();
    R.fx.update(dt, ws ? ws.biome : 'Neon Grid');
    MB.audio.update(app, dt);
  }

  function worldState() {
    if (ATTRACT_SCREENS[app.screen] || app.screen === 'coop' || app.screen === 'lobby') return attract.sim;
    return app.sim;
  }

  function draw(dt) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#0d0912'; g.fillRect(0, 0, canvas.width, canvas.height);
    var v = IN.view;
    g.setTransform(v.scale, 0, 0, v.scale, v.ox, v.oy);
    g.save();
    g.beginPath(); g.rect(0, 0, W, H); g.clip();
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'low'; // sprites carry pre-shrunk copies (sprites.js halfOf)
    MB.sprites.zoom = v.scale;
    var ws = worldState();
    if (ws) {
      var att = ws === attract.sim;
      var sh = R.fx.shake();
      g.save(); g.translate(sh[0], sh[1]);
      R.world(g, ws, att ? attract.prev : app.prev, att ? attract.alpha : app.alpha, app.t,
        { rangeRing: !att && app.settings.rangeRing && app.screen === 'play', localSlot: att ? -1 : app.slot, names: !att && app.coop ? MB.net.nameOf : null });
      g.restore();
    }
    UI.begin(g, dt);
    var fn = SC[app.screen];
    if (app.screen === 'play' || app.screen === 'pause') SC.hud(app, g, dt);
    if (app.screen !== 'play' && fn) fn(app, g, dt);
    SC.toasts(app, g);
    UI.end();
    g.restore();
  }

  // Auto resolution: render at native pixels (DPR capped at 2) until frames run slow, then step the
  // backing store down, and back up once there is headroom again. Canvas fill rate is what limits weak
  // GPUs and software rendering, so this is the one knob that always helps.
  var autoK = 1, slowT = 0, fastT = 0, ema = 1 / 60, upWait = 8; // upWait doubles on every drop so it can't flap
  function autoRes(raw) {
    if (raw > 0.25) return; // tab switch or hitch, not a load signal
    ema += (raw - ema) * 0.08;
    var cap = app.settings.fpsCap, target = cap > 0 ? Math.max(1 / 60, 1 / cap) : 1 / 60;
    if (ema > target * 1.22) { slowT += raw; fastT = 0; } else if (ema < target * 1.08) { fastT += raw; slowT = 0; } else { slowT = 0; fastT = 0; }
    if (slowT > 1.2 && autoK > 0.5) { autoK = Math.max(0.5, autoK - 0.15); slowT = 0; ema = target; upWait = Math.min(120, upWait * 2); }
    else if (fastT > upWait && autoK < 1) { autoK = Math.min(1, autoK + 0.1); fastT = 0; }
  }
  app.renderScale = function () { return app.settings.resolution > 0 ? app.settings.resolution / 100 : autoK; };

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2) * app.renderScale();
    var cw = Math.max(1, Math.round(window.innerWidth * dpr)), ch = Math.max(1, Math.round(window.innerHeight * dpr));
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    var s = Math.min(cw / W, ch / H);
    IN.view.scale = s; IN.view.ox = (cw - W * s) / 2; IN.view.oy = (ch - H * s) / 2;
  }

  var last = 0, fpsAcc = 0, fpsN = 0;
  function frame(ts) {
    window.requestAnimationFrame(frame);
    var raw = last ? (ts - last) / 1000 : 1 / 60;
    var cap = app.settings.fpsCap;
    if (cap > 0 && raw < 1 / cap - 0.002) return;
    last = ts;
    var dt = Math.min(0.1, raw);
    fpsAcc += raw; fpsN++;
    if (fpsAcc >= 0.5) { app.fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
    if (app.settings.resolution === 0 && app.screen === 'play') autoRes(raw);
    resize();
    IN.poll();
    update(dt);
    draw(dt);
    IN.endFrame();
  }

  /* ------------------------------------------------------------------ co-op wiring */
  var CLOSE_MSG = {
    version: 'Your game is a different version from the host\'s. Refresh the page and try again.',
    kicked: 'The host removed you from the crew.', full: 'That crew is full.',
    'host-left': 'The host left and the run could not carry on.', 'connection-lost': 'Lost the connection to the relay.'
  };
  function bindNet() {
    var net = MB.net;
    net.bind({
      getSim: function () { return app.coop ? app.sim : null; },
      setSim: function (sim) { app.sim = sim; },
      command: function (slot, c) { return app.hostCmd(slot, c); }
    });
    net.on('start', function (info) { app.startCoopRun(info); });
    net.on('frame', function (f) {
      var s = app.sim;
      if (!app.coop || !s) return;
      R.fx.consume(f.events, fxSettings(true));
      MB.radio.events(app, f.events);
      MB.audio.events(app, f.events);
      for (var i = 0; i < f.events.length; i++) { var e = f.events[i]; if (e.t === 'hit' && e.slot === app.slot) dmgLog.push([s.time, e.dmg]); }
      while (dmgLog.length && dmgLog[0][0] < s.time - 3) dmgLog.shift();
      var tot = 0; dmgLog.forEach(function (d) { tot += d[1]; });
      app.dps = dmgLog.length ? Math.round(tot / Math.min(3, Math.max(0.5, s.time - dmgLog[0][0]))) : 0;
      afterSim();
    });
    net.on('reset', function () { app.coop = false; app.sim = null; app.ending = null; R.fx.reset(); app.go('lobby'); });
    net.on('toast', function (m) { app.toast(m); });
    net.on('error', function (e) { if (app.screen === 'coop' || app.screen === 'lobby') app.coopMsg = e.message; });
    net.on('closed', function (reason) {
      if (reason === 'connection-lost-host') return; // the host keeps playing offline
      var wasRun = app.coop;
      // a failed join already put the relay's own message up; keep it
      if (wasRun || app.screen === 'lobby' || !app.coopMsg) app.coopMsg = CLOSE_MSG[reason] || (reason ? String(reason) : 'Disconnected.');
      app.coop = false; app.sim = null; app.ending = null; R.fx.reset();
      if (wasRun || app.screen === 'lobby') app.go('coop');
    });
  }

  // Browsers stop requestAnimationFrame in background tabs, which would freeze everyone's run while the host
  // looks at another tab. A worker's timer keeps running, so it drives update() (no drawing) while hidden.
  function hiddenTicker() {
    var last = 0, w;
    try { w = new Worker(URL.createObjectURL(new Blob(['setInterval(function () { postMessage(0); }, 33);'], { type: 'text/javascript' }))); } catch (e) { return; }
    w.onmessage = function () {
      if (!document.hidden || !app.coop) { last = 0; return; }
      var now = performance.now(), dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 30;
      last = now;
      update(dt);
      IN.endFrame();
    };
  }

  MB.main = {
    start: function () {
      canvas = document.getElementById('game');
      g = canvas.getContext('2d');
      IN.attach(canvas);
      savedJson = JSON.stringify(app.settings);
      app.applySettings();
      // a shared run doesn't stop for one player's menu, so co-op doesn't pause on blur
      window.addEventListener('blur', function () { if (app.screen === 'play' && app.deathT <= 0 && !app.coop) { app.pauseTab = 0; app.go('pause'); } });
      bindNet();
      hiddenTicker();
      if (params.has('screen')) { // ?screen=shop etc. for screenshots and debugging
        var want = params.get('screen');
        app.arch = (+params.get('arch') || 0) % 8;
        if (want !== 'menu' && !ATTRACT_SCREENS[want]) {
          app.settings.skipStory = true; app.startRun(); app.settings.skipStory = false;
          var s = app.sim;
          if (want !== 'play') {
            for (var i = 0; i < 60 * 10; i++) { MB.sim.step(s, [MB.bot.input(s, 0)]); R.fx.consume(s.events, fxSettings(true)); }
            if (want === 'shop' || want === 'preview' || want === 'pause' || want === 'gameover') {
              if (want === 'shop' || want === 'preview') { s.waveTime = 0; MB.sim.step(s, [{}]); s.players[0].cash += 120; }
              if (want === 'preview') { MB.sim.command(s, 0, { t: 'ready' }); app.story = null; }
              if (want === 'gameover') { s.players[0].hp = 0; s.players[0].iframe = 0; MB.sim.step(s, [{}]); }
            }
          }
          app.go(want);
        } else app.go(want);
      }
      window.requestAnimationFrame(frame);
    }
  };
})();
