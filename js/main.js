/*
 * MemoryBurn - js/main.js
 *
 * Boot, the fixed-step loop and the screen state machine. The sim steps at D.STEP (60 Hz); rendering
 * interpolates between the previous and current step. Everything that touches the sim goes through
 * stepRun / app.cmd so a networked host can replace those two later.
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
    uiScale: 100, textSize: 100, vfx: 100, gameSpeed: 100, dmgTaken: 100, fpsCap: 0, skipStory: false, radio: true
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
    dps: 0, fps: 60, optionsReturn: 'menu'
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
    if (app.sim) { app.sim.settings.gameSpeed = s.gameSpeed / 100; app.sim.settings.dmgTaken = s.dmgTaken / 100; }
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
  app.toMenu = function () { app.sim = null; R.fx.reset(); app.go('menu'); };

  // Sim commands from the UI. In a networked build this becomes "send to host".
  app.cmd = function (c) {
    if (!app.sim) return false;
    var ok = MB.sim.command(app.sim, app.slot, c);
    R.fx.consume(app.sim.events, fxSettings(true));
    afterSim();
    return ok;
  };

  function afterSim() {
    var s = app.sim;
    if (!s) return;
    if (s.phase === 'shop' && app.screen === 'play') {
      if (s.wave === ST.last) { // the campaign's last contract just ended; the ending shows even with Skip Story on
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

  function stepRun(dt) {
    var s = app.sim;
    app.acc += dt;
    var n = 0;
    while (app.acc >= STEP && s.phase === 'play' && n < 8) {
      app.prev = R.snapshot(s);
      var inputs = s.players.map(function (pl, i) { return i === app.slot ? sampleInput(s) : MB.bot.input(s, i); });
      MB.sim.step(s, inputs);
      R.fx.consume(s.events, fxSettings(true));
      MB.radio.events(app, s.events);
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

  /* ------------------------------------------------------------------ frame */
  function update(dt) {
    app.t += dt; app.screenT += dt;
    var sc = app.screen;
    if (app.debug && app.sim) {
      if (IN.pressed('Digit8') && sc === 'play') app.cmd({ t: 'debugSkip' });
      if (IN.pressed('Digit9')) app.cmd({ t: 'debugCash' });
    }
    if (sc === 'play' && app.sim) {
      if (app.deathT > 0) {
        app.deathT -= dt;
        if (app.deathT <= 0) app.go('gameover');
      } else if (IN.pressed('Escape') || IN.padPressed('start')) {
        app.pauseTab = 0; app.go('pause');
      } else stepRun(dt);
      MB.radio.update(app, dt);
      app.bannerT = Math.max(0, app.bannerT - dt);
    } else if (ATTRACT_SCREENS[sc]) stepAttract(dt);
    var ws = worldState();
    R.fx.update(dt, ws ? ws.biome : 'Neon Grid');
  }

  function worldState() {
    if (ATTRACT_SCREENS[app.screen]) return attract.sim;
    return app.sim;
  }

  function draw(dt) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#0d0912'; g.fillRect(0, 0, canvas.width, canvas.height);
    var v = IN.view;
    g.setTransform(v.scale, 0, 0, v.scale, v.ox, v.oy);
    g.save();
    g.beginPath(); g.rect(0, 0, W, H); g.clip();
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    var ws = worldState();
    if (ws) {
      var att = ATTRACT_SCREENS[app.screen];
      var sh = R.fx.shake();
      g.save(); g.translate(sh[0], sh[1]);
      R.world(g, ws, att ? attract.prev : app.prev, att ? attract.alpha : app.alpha, app.t,
        { rangeRing: !att && app.settings.rangeRing && app.screen === 'play', localSlot: att ? -1 : app.slot });
      g.restore();
    }
    UI.begin(g, dt);
    var fn = SC[app.screen];
    if (app.screen === 'play' || app.screen === 'pause') SC.hud(app, g, dt);
    if (app.screen !== 'play' && fn) fn(app, g, dt);
    UI.end();
    g.restore();
  }

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
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
    resize();
    IN.poll();
    update(dt);
    draw(dt);
    IN.endFrame();
  }

  MB.main = {
    start: function () {
      canvas = document.getElementById('game');
      g = canvas.getContext('2d');
      IN.attach(canvas);
      savedJson = JSON.stringify(app.settings);
      app.applySettings();
      window.addEventListener('blur', function () { if (app.screen === 'play' && app.deathT <= 0) { app.pauseTab = 0; app.go('pause'); } });
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
