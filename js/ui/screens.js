/*
 * MemoryBurn - js/ui/screens.js
 *
 * Every screen and the in-run HUD, drawn with MB.ui on top of the world. Screens read sim state and
 * act only through the app object from main.js (app.cmd for sim commands, app.go for navigation),
 * so the same screens work when the sim lives on a host.
 *
 *   MB.screens.<name>(app, g, dt)   names: menu options chars difficulty intro hud shop preview pause gameover ending
 *                                   (coop and lobby live in js/ui/coop.js)
 *   MB.screens.toasts(app, g)        short notices (co-op joins and drops) over every screen
 */
(function () {
  'use strict';
  var SC = MB.screens = {}, UI = MB.ui, S = MB.sprites, P = S.palette, D = MB.data, IN = MB.input, TAU = Math.PI * 2;
  var W = D.VIRTUAL_W, H = D.VIRTUAL_H;
  var C = UI.C;

  function shortName(a) { return a.name.replace(/\s*\(.*\)$/, ''); }
  function weaponName(a) { var m = /\((.*)\)/.exec(a.name); return m ? m[1] : 'Sidearm'; }
  SC.shortName = shortName;

  /* ------------------------------------------------------------------ shared bits */
  function backdrop(g, a) {
    var gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, 'rgba(14,9,22,' + (a * 0.75) + ')'); gr.addColorStop(1, 'rgba(14,9,22,' + a + ')');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
  }
  function scanlines(g, t) {
    g.save(); g.globalAlpha = 0.05; g.fillStyle = '#ffffff';
    var off = (t * 40) % 6;
    for (var y = off; y < H; y += 6) g.fillRect(0, y, W, 2);
    g.restore();
  }
  function tile(g, x, y, s, col, key, o) {
    o = o || {};
    UI.rr(x - 3, y - 3, s + 6, s + 6, s * 0.2); g.fillStyle = C.edge; g.fill();
    UI.rr(x, y, s, s, s * 0.18); g.fillStyle = S.shade(col, -0.55); g.fill();
    UI.rr(x + 4, y + 4, s - 8, s - 8, s * 0.15); g.fillStyle = S.shade(col, -0.35); g.fill();
    var sp = S.get(key), fit = (s * (o.fill || 0.78)) / Math.max(sp.w, sp.h);
    S.draw(g, key, x + s / 2, y + s / 2 + (o.dy || 0), { scale: fit });
  }
  SC.tile = tile;

  var archCache = [];
  function archStats(i) {
    if (!archCache[i]) archCache[i] = MB.sim.create({ seed: 1, players: [{ arch: i }] }).players[0];
    return archCache[i];
  }

  // Stats panel rows: [label, icon, getter, format]
  var STAT_ROWS = [
    ['Max HP', 'icon:max_hp', function (p) { return p.max_hp; }, function (v) { return String(Math.trunc(v)); }],
    ['HP Regen', 'icon:health_regen', function (p) { return p.health_regen; }, function (v) { return v.toFixed(2) + '/s'; }],
    ['Lifesteal', 'icon:lifesteal', function (p) { return p.lifesteal; }, function (v) { return Math.round(v * 100) + '%'; }],
    ['Damage', 'icon:damage', function (p) { return p.damage; }, function (v) { return String(Math.trunc(v)); }],
    ['Attack Speed', 'icon:attack_speed', function (p) { return p.attack_speed; }, function (v) { return v.toFixed(2) + 'x'; }],
    ['Crit Chance', 'icon:crit_chance', function (p) { return p.crit_chance; }, function (v) { return Math.round(v * 100) + '%'; }],
    ['Crit Damage', 'icon:crit_mult', function (p) { return p.crit_mult; }, function (v) { return v.toFixed(2) + 'x'; }],
    ['Armor', 'icon:armor', function (p) { return p.armor; }, function (v) { return String(Math.trunc(v)); }],
    ['Speed', 'icon:speed', function (p) { return p.speed; }, function (v) { return String(Math.round(v)); }],
    ['Luck', 'icon:luck', function (p) { return p.luck; }, function (v) { return String(Math.trunc(v)); }],
    ['Pickup Range', 'icon:pickup', function (p) { return p.pickup_range; }, function (v) { return String(Math.round(v)); }],
    ['Projectiles', 'icon:bullets', function (p) { return p.bullets; }, function (v) { return String(Math.trunc(v)); }],
    ['Proj. Speed', 'icon:bullet_speed', function (p) { return p.bullet_speed; }, function (v) { return String(Math.round(v)); }],
    ['Drones', 'pet:turret_buddy', function (p) { return p.pets.length; }, function (v) { return String(v); }]
  ];

  // What buying `item` would change, computed by applying it to a copy of the player with the sim's own code.
  function itemDeltas(p, item) {
    var q = JSON.parse(JSON.stringify(p));
    MB.sim.applyItem(q, item);
    var out = [];
    STAT_ROWS.forEach(function (r) {
      var a = r[2](p), b = r[2](q);
      if (Math.abs(a - b) > 1e-9) out.push({ label: r[0], from: r[3](a), to: r[3](b), up: b > a });
    });
    return out;
  }

  /* ------------------------------------------------------------------ options (menu + pause tab) */
  function optionsPanel(app, x, y, w) {
    var s = app.settings, colW = (w - 80) / 2, x2 = x + colW + 80, yy = y, step = 66;
    s.manualFire = UI.toggle('o:manual', 'Manual Fire (hold LMB)', s.manualFire, x, yy, colW); yy += step;
    s.aimAssist = UI.toggle('o:aim', 'Aim Assist (manual fire)', s.aimAssist, x, yy, colW); yy += step;
    s.shake = UI.toggle('o:shake', 'Screen Shake', s.shake, x, yy, colW); yy += step;
    s.tracers = UI.toggle('o:tracers', 'Bullet Tracers', s.tracers, x, yy, colW); yy += step;
    s.dmgNums = UI.toggle('o:dmg', 'Damage Numbers', s.dmgNums, x, yy, colW); yy += step;
    s.reducedFlashes = UI.toggle('o:flash', 'Reduced Flashes', s.reducedFlashes, x, yy, colW); yy += step;
    s.rangeRing = UI.toggle('o:ring', 'Show Range Ring', s.rangeRing, x, yy, colW); yy += step;
    s.radio = UI.toggle('o:radio', 'Radio Chatter', s.radio, x, yy, colW); yy += step;
    s.skipStory = UI.toggle('o:story', 'Skip Story', s.skipStory, x, yy, colW); yy += step;
    var pct = function (v) { return Math.round(v) + '%'; }, vpct = function (v) { return v === 0 ? 'Off' : Math.round(v) + '%'; };
    yy = y;
    s.masterVol = UI.slider('o:vol', 'Master Volume', s.masterVol, 0, 100, 5, x2, yy, colW, vpct); yy += step;
    s.musicVol = UI.slider('o:music', 'Music', s.musicVol, 0, 100, 5, x2, yy, colW, vpct); yy += step;
    s.sfxVol = UI.slider('o:sfx', 'Sound Effects', s.sfxVol, 0, 100, 5, x2, yy, colW, vpct); yy += step;
    s.uiScale = UI.slider('o:ui', 'HUD Scale', s.uiScale, 75, 140, 5, x2, yy, colW, pct); yy += step;
    s.textSize = UI.slider('o:text', 'Text Size', s.textSize, 80, 140, 5, x2, yy, colW, pct); yy += step;
    s.vfx = UI.slider('o:vfx', 'VFX Intensity', s.vfx, 50, 150, 5, x2, yy, colW, pct); yy += step;
    s.gameSpeed = UI.slider('o:speed', 'Game Speed', s.gameSpeed, 60, 120, 5, x2, yy, colW, pct); yy += step;
    s.dmgTaken = UI.slider('o:taken', 'Damage Taken', s.dmgTaken, 50, 150, 5, x2, yy, colW, pct); yy += step;
    s.fpsCap = UI.slider('o:fps', 'FPS Cap', s.fpsCap, 0, 240, 10, x2, yy, colW, function (v) { return v === 0 ? 'Vsync' : String(v); }); yy += step;
    // the left end of the track is Auto (stored as 0); fixed scales run 40-100%
    var res = UI.slider('o:res', 'Resolution', s.resolution || 30, 30, 100, 10, x2, yy, colW, function (v) { return v === 30 ? 'Auto' : v + '%'; }); yy += step;
    s.resolution = res === 30 ? 0 : res;
    app.applySettings();
  }

  /* ------------------------------------------------------------------ menu */
  var glitchNext = 4, glitchT = 0;
  function title(g, str, x, y, size, t, intro) {
    var j = 0;
    if (intro < 1.8) j = 12 * (1 - intro / 1.8);
    glitchNext -= 1 / 60;
    if (glitchNext <= 0) { glitchT = 0.16; glitchNext = 3 + MB.fx.uniform(0, 4); }
    if (glitchT > 0) { glitchT -= 1 / 60; j = Math.max(j, 9); }
    g.save();
    g.font = size + 'px ' + UI.FONT_T; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    g.lineWidth = size * 0.2; g.strokeStyle = C.edge;
    g.strokeText(str, x, y + size * 0.08); g.strokeText(str, x, y);
    if (j > 0) {
      g.globalCompositeOperation = 'lighter';
      [['rgba(255,70,90,0.85)', -1], ['rgba(70,255,200,0.8)', 1], ['rgba(110,150,255,0.8)', 0]].forEach(function (c) {
        g.fillStyle = c[0]; g.fillText(str, x + MB.fx.uniform(-j, j) + c[1] * j * 0.6, y + MB.fx.uniform(-j, j) * 0.5);
      });
      g.globalCompositeOperation = 'source-over';
    }
    var gr = g.createLinearGradient(0, y - size * 0.5, 0, y + size * 0.5);
    gr.addColorStop(0, '#fff6e0'); gr.addColorStop(0.55, '#ffd35a'); gr.addColorStop(1, '#ff7a3c');
    g.fillStyle = gr; g.globalAlpha = j > 6 ? 0.75 : 1; g.fillText(str, x, y);
    g.restore();
  }

  SC.menu = function (app, g) {
    backdrop(g, 0.62); scanlines(g, app.t);
    var intro = app.t - (app.menuT0 || 0);
    title(g, 'MEMORY BURN', W / 2, 270, 170, app.t, intro);
    UI.text('Somebody sold your memories. Forty eddies a hit.', W / 2, 395, { size: 32, font: 'body', align: 'center', color: C.text });
    UI.text('By Andre Nijman', W / 2, 440, { size: 24, font: 'body', align: 'center', color: C.dim, outline: false });
    // character line-up
    for (var i = 0; i < 8; i++) {
      var cx = W / 2 + (i - 3.5) * 120, cy = 560 + Math.abs(Math.sin(app.t * 3 + i * 0.8)) * -10;
      S.draw(g, 'shadow', cx, 600, { scale: 0.8 });
      S.draw(g, 'char:' + i, cx, cy, { scale: 0.95, flip: i >= 4 });
    }
    if (UI.button('m:start', 'Start Run', W / 2 - 220, 680, 440, 92, { tone: 'primary', size: 46 })) app.go('chars');
    if (UI.button('m:coop', 'Co-op', W / 2 - 220, 796, 440, 72, { size: 34, sub: 'Online, up to 4' })) { app.coopMsg = ''; app.go('coop'); }
    if (UI.button('m:opts', 'Options', W / 2 - 220, 892, 440, 64, { size: 30 })) app.go('options');
    UI.text('WASD move  ·  Space dash  ·  auto-fire  ·  Esc pause', W / 2, H - 70, { size: 24, font: 'body', align: 'center', color: C.dim, outline: false });
    UI.text('v' + app.version, W - 24, H - 30, { size: 18, font: 'body', align: 'right', color: '#6f6480', outline: false });
  };

  SC.options = function (app, g) {
    backdrop(g, 0.8);
    UI.text('Options', W / 2, 90, { size: 76, align: 'center' });
    UI.panel(160, 160, W - 320, 700);
    optionsPanel(app, 230, 200, W - 460);
    if (UI.button('op:back', 'Back', W / 2 - 160, 920, 320, 76, { size: 36 }) || IN.back()) app.go(app.optionsReturn || 'menu');
  };

  /* ------------------------------------------------------------------ character select */
  SC.chars = function (app, g) {
    backdrop(g, 0.8);
    UI.text('Select your character', W / 2, 84, { size: 70, align: 'center' });
    var cols = 4, cw = 410, ch = 380, gx = 30, gy = 34, x0 = (W - (cols * cw + (cols - 1) * gx)) / 2, y0 = 150;
    var hovered = -1;
    for (var i = 0; i < 8; i++) {
      var a = D.ARCHETYPES[i], ps = archStats(i);
      var x = x0 + (i % cols) * (cw + gx), y = y0 + Math.floor(i / cols) * (ch + gy);
      var hov = UI.hover(x, y, cw, ch) || (app.charFocus === i && !IN.mouse.moved && app.keyNav);
      if (hov) hovered = i;
      var lift = hov ? -8 : 0;
      UI.panel(x, y + lift, cw, ch, { fill: hov ? '#3b3050' : C.panel, glow: hov ? a.color : null });
      // portrait plate
      g.save(); UI.rr(x + 18, y + 18 + lift, 150, 170, 14); g.fillStyle = S.shade(a.color, -0.72); g.fill(); g.clip();
      g.fillStyle = S.rgba(a.color, 0.18); g.beginPath(); g.arc(x + 93, y + 120 + lift, 70, 0, TAU); g.fill();
      var bob = hov ? Math.abs(Math.sin(app.t * 8)) * -8 : Math.sin(app.t * 2 + i) * 2;
      S.draw(g, 'shadow', x + 93, y + 168 + lift, { scale: 0.9 });
      S.draw(g, 'char:' + i, x + 90, y + 108 + lift + bob, { scale: 1.25 });
      S.draw(g, 'gun:' + i, x + 122, y + 132 + lift + bob * 0.5, { scale: 0.9, rot: -0.2 });
      g.restore();
      UI.text(shortName(a), x + 186, y + 46 + lift, { size: 34, maxW: cw - 200 });
      UI.text(weaponName(a), x + 186, y + 86 + lift, { size: 22, font: 'body', color: a.color, outline: false });
      var lines = UI.wrap(a.desc, cw - 200, 22, 'body');
      lines.forEach(function (ln, k) { UI.text(ln, x + 186, y + 124 + lift + k * 28, { size: 22, font: 'body', color: C.dim, outline: false }); });
      // stat chips
      var chips = [['icon:max_hp', ps.max_hp], ['icon:damage', ps.damage], ['icon:speed', ps.speed], ['icon:crit_chance', ps.range_px]];
      chips.forEach(function (c, k) {
        var cx = x + 22 + (k % 2) * 190, cy = y + 214 + Math.floor(k / 2) * 66 + lift;
        UI.rr(cx, cy, 176, 54, 12); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fill();
        S.draw(g, c[0], cx + 24, cy + 27, { scale: 0.56 });
        UI.text(String(Math.round(c[1])), cx + 50, cy + 28, { size: 26 });
        UI.text(['HP', 'DMG', 'SPD', 'RNG'][k], cx + 166, cy + 28, { size: 17, font: 'body', align: 'right', color: C.dim, outline: false });
      });
      if (hov && IN.mouse.clicked && UI.hover(x, y, cw, ch)) { app.arch = i; app.go('difficulty'); }
    }
    // keyboard: arrows move a highlight, Enter picks
    if (IN.pressed('ArrowRight') || IN.padPressed('right')) { app.charFocus = ((app.charFocus | 0) + 1) % 8; app.keyNav = true; }
    if (IN.pressed('ArrowLeft') || IN.padPressed('left')) { app.charFocus = ((app.charFocus | 0) + 7) % 8; app.keyNav = true; }
    if (IN.pressed('ArrowDown') || IN.pressed('ArrowUp') || IN.padPressed('down') || IN.padPressed('up')) { app.charFocus = ((app.charFocus | 0) + 4) % 8; app.keyNav = true; }
    if (IN.mouse.moved) app.keyNav = false;
    if (app.keyNav && IN.confirm()) { app.arch = app.charFocus | 0; app.go('difficulty'); }
    UI.text(hovered >= 0 ? 'Click to pick ' + shortName(D.ARCHETYPES[hovered]) + '.' : 'Pick a character to continue.', W / 2, H - 96, { size: 26, font: 'body', align: 'center', color: C.dim, outline: false });
    if (UI.button('c:back', 'Back', 60, H - 130, 220, 70, { size: 30, tone: 'ghost' }) || IN.back()) app.go('menu');
  };

  /* ------------------------------------------------------------------ difficulty */
  var DIFF_SUB = { Normal: 'Standard threat', Hard: '+25% spawns & damage', Insane: '+50% spawns & damage' };
  SC.difficulty = function (app, g) {
    backdrop(g, 0.8);
    UI.text('Choose Difficulty', W / 2, 200, { size: 72, align: 'center' });
    var a = D.ARCHETYPES[app.arch];
    S.draw(g, 'shadow', W / 2, 400, { scale: 1.3 });
    S.draw(g, 'char:' + app.arch, W / 2, 330 - Math.abs(Math.sin(app.t * 4)) * 10, { scale: 1.7 });
    S.draw(g, 'gun:' + app.arch, W / 2 + 44, 362, { scale: 1.2, rot: -0.15 });
    UI.text(shortName(a), W / 2, 448, { size: 40, align: 'center', color: a.color });
    D.DIFFICULTIES.forEach(function (d, i) {
      var tone = i === 0 ? 'good' : i === 1 ? 'primary' : 'danger';
      if (UI.button('d:' + d, d, W / 2 - 540 + i * 370, 520, 340, 120, { tone: tone, size: 44, sub: DIFF_SUB[d] })) { app.difficulty = d; app.startRun(); }
    });
    UI.text('Difficulty is locked for this run.', W / 2, 700, { size: 26, font: 'body', align: 'center', color: C.dim, outline: false });
    if (UI.button('df:back', 'Back', 60, H - 130, 220, 70, { size: 30, tone: 'ghost' }) || IN.back()) app.go('chars');
  };

  /* ------------------------------------------------------------------ story (intro, between contracts, ending) */
  var ST = D.STORY;
  function runArch(app) { return app.sim ? app.sim.players[app.slot].arch : app.arch; }

  // Speaker badge: the cast portrait clipped into a ring in the speaker's colour.
  SC.portrait = function (g, app, who, x, y, r) {
    var sp = ST.speakers[who] || {}, col = sp.color || C.cyan, key = sp.portrait;
    if (key === 'char') key = 'char:' + runArch(app);
    g.fillStyle = C.edge; g.beginPath(); g.arc(x, y, r + 8, 0, TAU); g.fill();
    g.fillStyle = S.shade(col, -0.62); g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    g.save(); g.beginPath(); g.arc(x, y, r, 0, TAU); g.clip();
    g.globalAlpha = 0.18; g.fillStyle = col;
    for (var yy = y - r; yy < y + r; yy += 8) g.fillRect(x - r, yy + ((app.t * 24) % 8), r * 2, 3);
    g.globalAlpha = 1;
    var spr = key && S.get(key);
    if (spr) {
      var big = spr.w > 100, sc = big ? r * 1.7 / 132 : r / 34;
      S.draw(g, key, x, y + r * (big ? 0.28 : 0.2), { scale: sc });
    }
    g.restore();
    g.lineWidth = 4; g.strokeStyle = col; g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke();
  };

  // Header line for a story panel: act name + title, or the contract name.
  SC.actHead = function (wave) { var a = ST.acts[ST.actIndex(wave)]; return a.name + '  ·  ' + a.title; };

  // Returns true while the story panel is up. `st` = {beats, idx, chars, head}
  function storyPanel(app, g, st, dt, opts) {
    opts = opts || {};
    var beat = st.beats[st.idx], who = beat[0], line = beat[1], sp = ST.speakers[who] || {}, col = sp.color || C.cyan;
    var memory = who === 'FRAGMENT', typed = Math.floor(st.chars || 0);
    st.chars = Math.min(line.length, (st.chars || 0) + dt * 46);
    for (var c = typed + 1; c <= Math.floor(st.chars); c++) if (c % 3 === 1) MB.audio.blip(who, line[c - 1]);
    var px = W / 2 - 640, py = 250, pw = 1280, ph = 440;
    if (st.head) {
      UI.text(st.head, W / 2, 130, { size: 64, align: 'center', color: memory ? '#f1e3c4' : C.text });
      if (st.sub) UI.text(st.sub, W / 2, 190, { size: 28, font: 'body', align: 'center', color: C.dim, outline: false });
    }
    UI.panel(px, py, pw, ph, memory ? { glow: S.rgba(col, 0.6), fill: '#2b2320', lo: '#1c1714' } : { glow: S.rgba(col, 0.5) });
    if (memory) { // old-film grain over recovered memories
      g.save(); UI.rr(px, py, pw, ph, 18); g.clip();
      g.fillStyle = 'rgba(255,230,180,0.05)';
      for (var k = 0; k < 40; k++) g.fillRect(px + MB.fx.uniform(0, pw), py, 2, ph);
      g.restore();
    }
    SC.portrait(g, app, who, px + 130, py + 150, 84);
    var label = who === 'NINE' ? 'YOU' : who, tag = sp.tag;
    UI.rr(px + 250, py + 46, UI.measure(label, 30) + 40, 50, 12); g.fillStyle = col; g.fill();
    UI.text(label, px + 270, py + 72, { size: 30, color: C.edge, outline: false });
    if (tag) UI.text(tag, px + 250 + UI.measure(label, 30) + 60, py + 72, { size: 22, color: col, outlineW: 5 });
    var lines = UI.wrap(line.slice(0, Math.floor(st.chars)), pw - 330, 34, 'body');
    lines.slice(0, 6).forEach(function (ln, k) {
      UI.text(ln, px + 252, py + 150 + k * 48, { size: 34, font: 'body', color: memory ? '#f1e3c4' : C.text, outline: false });
    });
    // pager dots
    for (var i = 0; i < st.beats.length; i++) {
      g.fillStyle = i === st.idx ? col : '#5a5068'; g.beginPath(); g.arc(W / 2 - (st.beats.length - 1) * 14 + i * 28, py + ph - 44, 8, 0, TAU); g.fill();
    }
    var last = st.idx === st.beats.length - 1 && st.chars >= line.length;
    var advance = UI.button('st:next', last ? (opts.lastLabel || 'Continue') : 'Next', px + pw - 280, py + ph - 88, 240, 66, { tone: 'primary', size: 30 })
      || IN.pressed('Space') || IN.confirm();
    if (st.idx > 0 && UI.button('st:back', 'Back', px + 40, py + ph - 88, 180, 66, { size: 30 })) { st.idx--; st.chars = 0; MB.audio.ui('pageTurn'); }
    if (!opts.noSkip) {
      app.settings.skipStory = UI.toggle('st:skip', 'Skip story', app.settings.skipStory, px + pw - 330, py + ph + 40, 330);
      if (app.settings.skipStory) return false;
    }
    if (advance) {
      if (st.chars < line.length) st.chars = line.length;
      else { st.idx++; st.chars = 0; if (st.idx >= st.beats.length) return false; MB.audio.ui('pageTurn'); }
    }
    UI.text('Space or Enter to continue', px, py + ph + 62, { size: 24, font: 'body', color: C.dim, outline: false });
    return true;
  }

  SC.intro = function (app, g, dt) {
    backdrop(g, 0.85); scanlines(g, app.t);
    if (!storyPanel(app, g, app.story, dt)) { app.story = null; app.saveSettings(); if (app.coop) MB.net.storyDone(); app.go('play'); }
  };

  // After the last contract: the lead-in, the choice, the epilogue, then Afterburn or the menu.
  SC.ending = function (app, g, dt) {
    var e = app.ending;
    if (!e) { app.go('menu'); return; }
    backdrop(g, 0.97); scanlines(g, app.t);
    if (e.stage === 'lead' || e.stage === 'epilogue') {
      if (storyPanel(app, g, e.story, dt, { noSkip: true, lastLabel: e.stage === 'lead' ? 'Decide' : 'Continue' })) return;
      e.stage = e.stage === 'lead' ? 'choice' : 'done'; IN.flush(); UI.clearFocus();
      return;
    }
    if (e.stage === 'choice') {
      UI.text('The core shard', W / 2, 200, { size: 72, align: 'center' });
      S.draw(g, 'npc:shard', W / 2, 400 + Math.sin(app.t * 2) * 8, { scale: 2.6 });
      ST.ending.choices.forEach(function (c, i) {
        if (UI.button('end:' + c.id, c.label, W / 2 - 560 + i * 600, 620, 520, 130, { tone: i === 0 ? 'primary' : 'danger', size: 46, sub: c.sub })) {
          e.choice = c.id; e.stage = 'epilogue'; MB.audio.ui(c.id);
          e.story = { beats: ST.resolve(c.beats, runArch(app)), idx: 0, chars: 0, head: 'Epilogue', sub: c.label };
        }
      });
      return;
    }
    title(g, 'CAMPAIGN CLEAR', W / 2, 260, 130, app.t, 99);
    UI.text(e.choice === 'plug' ? 'You plugged it in.' : 'You smashed it.', W / 2, 390, { size: 40, align: 'center', color: C.text });
    UI.text('Lethe still wants its stock back. Afterburn keeps this run going for as long as you last.', W / 2, 470,
      { size: 28, font: 'body', align: 'center', color: C.dim, outline: false });
    if (UI.button('end:on', 'Keep running', W / 2 - 460, 580, 440, 100, { tone: 'primary', size: 44, sub: 'Afterburn' }) || IN.confirm()) { app.ending = null; app.go('shop'); }
    if (UI.button('end:menu', 'Menu', W / 2 + 20, 580, 440, 100, { size: 44 }) || IN.back()) { app.ending = null; app.toMenu(); }
  };

  /* ------------------------------------------------------------------ HUD */
  SC.hud = function (app, g) {
    var st = app.sim, p = st.players[app.slot], s = app.settings.uiScale / 100;
    var VW = W / s;
    g.save(); g.scale(s, s);
    // HP
    UI.bar(30, 28, 440, 46, p.hp / p.max_hp, '#ef4d5f', Math.max(0, Math.ceil(p.hp)) + ' / ' + p.max_hp);
    S.draw(g, 'icon:max_hp', 34, 50, { scale: 0.85 });
    // dash
    var dashF = p.dash_cd <= 0 ? 1 : 1 - p.dash_cd / p.dash_cd_max;
    UI.bar(30, 92, 260, 22, dashF, p.dash_cd <= 0 ? P.cyan : '#3f8f98', null);
    UI.text(p.dash_cd <= 0 ? 'DASH READY' : 'DASH ' + p.dash_cd.toFixed(1) + 's', 304, 104, { size: 22, color: p.dash_cd <= 0 ? P.cyan : C.dim, outlineW: 5 });
    // materials + eddies
    S.draw(g, 'hud:mat', 52, 156, { scale: 1.15 });
    UI.text(String(p.materials), 84, 158, { size: 42 });
    S.draw(g, 'hud:coin', 52, 214, { scale: 1.15 });
    UI.text(String(p.cash), 84, 216, { size: 42, color: P.yellow });
    // co-op mini bars
    st.players.forEach(function (o, k) {
      if (k === app.slot) return;
      var yy = 262 + (k - (k > app.slot ? 1 : 0)) * 40;
      if (app.coop) {
        UI.text(MB.net.nameOf(o.slot), 30, yy + 10, { size: 22, maxW: 150 });
        UI.bar(190, yy, 180, 20, o.alive ? o.hp / o.max_hp : 0, o.alive ? '#ef4d5f' : '#5a5068', null);
        if (!o.alive) UI.text('DOWN', 384, yy + 10, { size: 20, color: '#ff6a7a', outlineW: 5 });
        return;
      }
      UI.text('P' + (o.slot + 1), 30, yy + 10, { size: 22 });
      UI.bar(76, yy, 180, 20, o.alive ? o.hp / o.max_hp : 0, o.alive ? '#ef4d5f' : '#5a5068', null);
    });
    if (app.coop) coopHud(app, g, st, p, VW);
    // wave + timer
    var tLeft = Math.max(0, Math.ceil(st.waveTime));
    UI.text('WAVE ' + st.wave, VW / 2, 42, { size: 40, align: 'center' });
    var hot = tLeft <= 5, pulse = hot ? 1 + Math.max(0, Math.sin(app.t * 10)) * 0.12 : 1;
    g.save(); g.translate(VW / 2, 106); g.scale(pulse, pulse);
    UI.text(String(tLeft), 0, 0, { size: 76, align: 'center', color: hot ? '#ff6a7a' : C.text });
    g.restore();
    // side-job card
    var q = st.quest;
    if (q) {
      var qx = VW - 480, qy = 24, qw = 450;
      UI.panel(qx, qy, qw, 112, { r: 16, edge: 6, alpha: 0.92 });
      UI.text('SIDE-JOB', qx + 22, qy + 26, { size: 20, color: P.yellow, outlineW: 5 });
      var done = q.kind === 'NoHit' ? (!q.fail && q.progress >= q.target) : q.progress >= q.target;
      var tag = q.fail ? 'FAILED' : done ? 'DONE' : '';
      if (tag) UI.text(tag, qx + qw - 22, qy + 26, { size: 22, align: 'right', color: q.fail ? '#ff6a7a' : P.green, outlineW: 5 });
      UI.text(q.label, qx + 22, qy + 60, { size: 24, font: 'body', color: C.text, outline: false, maxW: qw - 44 });
      var f = q.fail ? 0 : Math.min(1, q.progress / q.target);
      UI.bar(qx + 22, qy + 84, qw - 44, 14, f, q.fail ? '#5a5068' : done ? P.green : P.yellow, null);
    }
    // district chip
    var b = D.BIOMES[st.biome];
    UI.text(st.biome, VW - 30, 170, { size: 30, align: 'right', color: S.floorDefs[st.biome] ? S.shade(S.floorDefs[st.biome].glow || S.floorDefs[st.biome].base, 0.55) : C.text });
    UI.text(b.notes, VW - 30, 204, { size: 20, font: 'body', align: 'right', color: C.dim, outline: false });
    // perf line
    UI.text('DPS ' + app.dps + '   ·   ' + app.fps + ' FPS', VW - 24, H / s - 26, { size: 20, font: 'body', align: 'right', color: '#9b90ac', outline: false });
    if (app.debug) UI.text('DEBUG  8 skip · 9 +100', 24, H / s - 26, { size: 20, font: 'body', color: '#ff9a3c', outline: false });
    // wave start banner
    if (app.bannerT > 0 && !(app.coop && MB.net.holding() > 0)) {
      var k2 = app.bannerT, inA = Math.min(1, (2.4 - k2) / 0.25), outA = Math.min(1, k2 / 0.4), al = Math.min(inA, outA);
      g.save(); g.globalAlpha = al;
      var by = 300 - (1 - inA) * 40;
      var ct = ST.contract(st.wave), bossW = st.wave % 5 === 0;
      var head = ct ? (ct.boss ? ct.boss.name.toUpperCase() : ct.title.toUpperCase()) : bossW ? 'OVERLORD CONTRACT' : st.wave > ST.last ? 'AFTERBURN ' + (st.wave - ST.last) : 'CONTRACT ' + st.wave;
      UI.text(head, VW / 2, by, { size: 88, align: 'center', color: bossW ? '#ff6a7a' : C.text });
      UI.text('Contract ' + st.wave + '  ·  ' + st.biome + '  ·  ' + b.notes, VW / 2, by + 70, { size: 30, font: 'body', align: 'center', color: C.text });
      g.restore();
    }
    MB.radio.draw(app, g, VW, H / s);
    g.restore();
  };

  function coopHud(app, g, st, p, VW) {
    var cy = H / (app.settings.uiScale / 100) / 2;
    var hold = MB.net.holding();
    if (MB.net.isSpectator()) UI.text('SPECTATING', VW / 2, 170, { size: 34, align: 'center', color: P.cyan });
    if (hold > 0 && st.phase === 'play') {
      UI.text('Waiting for ' + hold + (hold === 1 ? ' runner' : ' runners') + ' to finish the briefing…', VW / 2, cy + 200, { size: 40, align: 'center' });
    } else if (!MB.net.isSpectator() && !p.alive && st.phase === 'play') {
      UI.text('DOWN', VW / 2, cy - 180, { size: 96, align: 'center', color: '#ff6a7a' });
      UI.text('The crew has to finish the contract. Doc patches you up at the market.', VW / 2, cy - 110, { size: 30, font: 'body', align: 'center', color: C.text });
    }
    var net = MB.net;
    if (net.role() === 'offline') UI.text('OFFLINE  ·  autopilot runs the crew', VW / 2, 200, { size: 22, align: 'center', color: '#ff9a3c', outlineW: 5 });
    else UI.text(net.lobby ? net.lobby.code + '  ·  ' + net.rtt + ' ms' : '', 24, H / (app.settings.uiScale / 100) - 56, { size: 18, font: 'body', color: '#9b90ac', outline: false });
  }

  // Joins, drops and host changes in co-op; app.toasts is filled by main.js.
  SC.toasts = function (app, g) {
    app.toasts.forEach(function (t, i) {
      var a = Math.min(1, t.t / 0.2, (4.5 - t.t) / 0.5);
      if (a <= 0) return;
      g.save(); g.globalAlpha = a;
      var w = Math.min(1100, UI.measure(t.msg, 26, 'body') + 60), x = W / 2 - w / 2, y = H - 200 - i * 70;
      UI.panel(x, y, w, 56, { r: 14, edge: 5, alpha: 0.95 });
      UI.text(t.msg, W / 2, y + 28, { size: 26, font: 'body', align: 'center', color: C.text, outline: false });
      g.restore();
    });
  };

  /* ------------------------------------------------------------------ shop */
  SC.shop = function (app, g) {
    var st = app.sim, p = st.players[app.slot], shop = p.shop;
    backdrop(g, 0.82);
    UI.text('Back-Alley Market', 70, 84, { size: 66 });
    UI.text('Wave ' + st.wave + ' cleared', 74, 136, { size: 26, font: 'body', color: C.dim, outline: false });
    // eddies
    S.draw(g, 'hud:coin', 1180, 92, { scale: 1.6 });
    UI.text(String(p.cash), 1214, 94, { size: 60, color: P.yellow });
    var hoverDeltas = null, tipItem = null, tipX = 0, tipY = 0;
    var cw = 400, chh = 500, gap = 30, x0 = 70, y0 = 180;
    var pulse = 0.5 + 0.5 * Math.sin(app.t * 3.2);
    for (var i = 0; i < shop.items.length; i++) {
      var x = x0 + i * (cw + gap), y = y0;
      if (shop.items[i] == null) { // bought: the slot stays empty until the next shop or a reroute
        UI.rr(x, y, cw, chh, 22); g.fillStyle = 'rgba(0,0,0,0.28)'; g.fill();
        g.save(); g.setLineDash([18, 14]); g.lineWidth = 4; g.strokeStyle = '#5a4f6c'; UI.rr(x + 2, y + 2, cw - 4, chh - 4, 20); g.stroke(); g.restore();
        UI.text('SOLD', x + cw / 2, y + chh / 2 - 20, { size: 48, align: 'center', color: '#7d7290', outlineW: 5 });
        UI.text('Restocks next contract', x + cw / 2, y + chh / 2 + 30, { size: 24, font: 'body', align: 'center', color: '#7d7290', outline: false });
        continue;
      }
      var item = D.ITEM_POOL[shop.items[i]], rc = D.RARITY_COL[item.rarity];
      var locked = !!shop.locks[i];
      var can = p.cash >= item.cost;
      var hov = UI.hover(x, y, cw, chh);
      // rarity glow
      g.save(); g.globalAlpha = 0.25 + 0.35 * pulse; UI.rr(x - 12, y - 12, cw + 24, chh + 32, 26); g.fillStyle = rc; g.fill(); g.restore();
      UI.panel(x, y, cw, chh, { fill: hov ? '#352b45' : C.panel, glow: rc });
      tile(g, x + 26, y + 26, 128, rc, D.itemIcon(item), { fill: item['+stat'] === 'pet' ? 0.85 : 0.8 });
      var nameLines = UI.wrap(item.name, cw - 200, 32, 'title');
      nameLines.slice(0, 2).forEach(function (ln, k) { UI.text(ln, x + 172, y + 50 + k * 36 - (nameLines.length > 1 ? 0 : -12), { size: 32 }); });
      UI.text(item.rarity.toUpperCase(), x + 172, y + 130, { size: 22, color: rc, outlineW: 5 });
      // lock button, beside the buy button so it never covers the name
      var lx = x + cw - 26 - 74, ly = y + chh - 96;
      var lh = UI.hover(lx, ly, 74, 74);
      UI.rr(lx - 4, ly - 4, 82, 82 + 4, 16); g.fillStyle = C.edge; g.fill();
      UI.rr(lx, ly, 74, 74, 13); g.fillStyle = locked ? '#7a5a14' : (lh ? '#5a4f6c' : '#3d3350'); g.fill();
      if (locked) { g.lineWidth = 4; g.strokeStyle = P.yellow; UI.rr(lx + 2, ly + 2, 70, 70, 11); g.stroke(); }
      S.draw(g, locked ? 'hud:lock' : 'hud:unlock', lx + 37, ly + 39, { scale: 1.3, alpha: locked || lh ? 1 : 0.75 });
      if (lh && IN.mouse.clicked) { MB.audio.ui(locked ? 'unlock' : 'lock'); app.cmd({ t: 'lock', i: i }); }
      // description + deltas
      var dl = UI.wrap(item.desc, cw - 52, 26, 'body');
      dl.forEach(function (ln, k) { UI.text(ln, x + 26, y + 196 + k * 34, { size: 26, font: 'body', color: C.text, outline: false }); });
      var deltas = itemDeltas(p, item);
      deltas.slice(0, 4).forEach(function (d, k) {
        var yy = y + 206 + dl.length * 34 + k * 34;
        UI.text(d.label, x + 26, yy, { size: 22, font: 'body', color: C.dim, outline: false });
        UI.text(d.from + '  ›  ' + d.to, x + cw - 26, yy, { size: 24, align: 'right', color: d.up ? P.green : '#ff6a7a', outlineW: 4 });
      });
      if (hov && !lh) hoverDeltas = deltas;
      // buy
      if (UI.button('s:buy' + i, String(item.cost), x + 26, y + chh - 96, cw - 52 - 92, 74, { tone: can ? 'primary' : 'danger', disabled: !can, icon: 'hud:coin', size: 38 })) app.cmd({ t: 'buy', i: i });
    }
    // owned items
    var iy = 730;
    UI.text('Items', 72, iy, { size: 34 });
    UI.text(String(p.items.length), 170, iy + 2, { size: 26, color: C.dim, outlineW: 4 });
    var counts = {}, order = [];
    p.items.forEach(function (idx) { if (!counts[idx]) { counts[idx] = 0; order.push(idx); } counts[idx]++; });
    order.forEach(function (idx, k) {
      var it2 = D.ITEM_POOL[idx], tx = 70 + (k % 16) * 78, ty = iy + 30 + Math.floor(k / 16) * 78;
      if (ty > 920) return;
      tile(g, tx, ty, 66, D.RARITY_COL[it2.rarity], D.itemIcon(it2));
      if (counts[idx] > 1) UI.text('x' + counts[idx], tx + 62, ty + 56, { size: 20, align: 'right', outlineW: 5 });
      if (UI.hover(tx, ty, 66, 66)) { tipItem = it2; tipX = tx; tipY = ty; }
    });
    if (!order.length) UI.text('Nothing yet. Spend those eddies.', 72, iy + 60, { size: 24, font: 'body', color: '#7d7290', outline: false });
    // last side-job + haul
    var lq = st.lastQuest, msg = 'Haul: ' + p.lastHaul + ' materials → eddies';
    if (lq) msg += '   ·   Side-job ' + (lq.done ? 'paid +₵' + lq.reward : 'failed');
    UI.text(msg, 72, 948, { size: 24, font: 'body', color: lq && lq.done ? P.green : C.dim, outline: false });
    // reroll + start
    if (UI.button('s:reroll', 'Reroute  5', 70, 980, 300, 80, { icon: 'hud:coin', size: 32, disabled: p.cash < 5 })) app.cmd({ t: 'reroll' });
    var waiting = p.ready && st.players.some(function (o) { return !o.ready; });
    if (app.coop && !MB.net.isSpectator()) crewStatus(app, st, 1400 + 230, 940);
    if (MB.net.isSpectator()) UI.text('Spectating', 1630, 1012, { size: 36, align: 'center', color: P.cyan });
    else if (UI.button('s:go', waiting ? 'Waiting…' : 'Contract Start', 1400, 966, 460, 94, { tone: 'good', size: 42, disabled: waiting })) app.cmd({ t: 'ready' });
    // stats panel
    statsPanel(app, g, p, 1400, 40, 460, 890, hoverDeltas);
    if (tipItem) tooltip(g, tipItem, tipX, tipY);
  };

  // "Waiting on: Kai, Mo" above the ready / deploy button in co-op
  function crewStatus(app, st, cx, y) {
    var wait = [];
    st.players.forEach(function (o) { if (!o.ready && o.slot !== app.slot) wait.push(MB.net.nameOf(o.slot)); });
    var me = st.players[app.slot];
    if (!me || !me.ready || !wait.length) return;
    UI.text('Waiting on ' + wait.join(', '), cx, y, { size: 24, font: 'body', align: 'center', color: C.dim, outline: false, maxW: 600 });
  }

  function statsPanel(app, g, p, x, y, w, h, deltas) {
    UI.panel(x, y, w, h);
    S.draw(g, 'char:' + p.arch, x + 56, y + 62, { scale: 0.8 });
    UI.text(shortName(D.ARCHETYPES[p.arch]), x + 104, y + 50, { size: 34, maxW: w - 130 });
    UI.text('HP ' + Math.ceil(p.hp) + ' / ' + p.max_hp + '   ·   Range ' + Math.round(p.range_px), x + 104, y + 88, { size: 20, font: 'body', color: C.dim, outline: false });
    var map = {};
    (deltas || []).forEach(function (d) { map[d.label] = d; });
    STAT_ROWS.forEach(function (r, k) {
      var yy = y + 140 + k * 52;
      if (k % 2 === 0) { UI.rr(x + 14, yy - 24, w - 28, 48, 10); g.fillStyle = 'rgba(255,255,255,0.04)'; g.fill(); }
      S.draw(g, r[1], x + 44, yy, { scale: r[1].indexOf('pet:') === 0 ? 0.55 : 0.6 });
      UI.text(r[0], x + 80, yy, { size: 24, font: 'body', color: C.text, outline: false });
      var d = map[r[0]];
      if (d) UI.text(d.to, x + w - 28, yy, { size: 28, align: 'right', color: d.up ? P.green : '#ff6a7a', outlineW: 5 });
      else UI.text(r[3](r[2](p)), x + w - 28, yy, { size: 28, align: 'right' });
    });
  }

  function tooltip(g, item, x, y) {
    var w = 420, lines = UI.wrap(item.desc, w - 40, 24, 'body'), h = 80 + lines.length * 30;
    var tx = Math.min(W - w - 20, x), ty = y - h - 14;
    UI.panel(tx, ty, w, h, { r: 14, edge: 5, glow: D.RARITY_COL[item.rarity] });
    UI.text(item.name, tx + 20, ty + 32, { size: 28, maxW: w - 40 });
    lines.forEach(function (ln, k) { UI.text(ln, tx + 20, ty + 70 + k * 30, { size: 24, font: 'body', color: C.dim, outline: false }); });
  }

  /* ------------------------------------------------------------------ preview (story beat, then briefing) */
  SC.preview = function (app, g, dt) {
    var st = app.sim;
    backdrop(g, 0.86); scanlines(g, app.t);
    if (app.story && !app.settings.skipStory) {
      if (storyPanel(app, g, app.story, dt)) return;
      app.story = null; app.saveSettings(); IN.flush(); // the press that ended the story must not also deploy
    }
    var pv = MB.sim.previewLines(st), next = st.wave + 1, ct = ST.contract(next);
    UI.text('Contract Briefing', W / 2, 110, { size: 72, align: 'center' });
    UI.text(SC.actHead(next), W / 2, 168, { size: 26, font: 'body', align: 'center', color: C.dim, outline: false });
    var px = W / 2 - 640, py = 200, pw = 1280, ph = 700;
    UI.panel(px, py, pw, ph);
    UI.text('Contract ' + next + (ct ? ':  ' + ct.title : ''), px + 50, py + 60, { size: 44, color: ct && ct.boss ? '#ff6a7a' : C.text });
    // district thumbnail
    var tx = px + 50, ty = py + 110, tw = 480, th = 300;
    g.save(); UI.rr(tx - 5, ty - 5, tw + 10, th + 10, 22); g.fillStyle = C.edge; g.fill();
    UI.rr(tx, ty, tw, th, 18); g.clip();
    g.translate(tx, ty); g.scale(0.62, 0.62);
    g.fillStyle = g.createPattern(S.floor(pv.district), 'repeat'); g.fillRect(0, 0, tw / 0.62, th / 0.62);
    g.restore();
    UI.text(pv.district, tx + tw / 2, ty + th - 36, { size: 38, align: 'center' });
    // details
    var dx = px + 580, dy = py + 140;
    UI.text('District notes', dx, dy, { size: 24, color: P.yellow, outlineW: 5 });
    UI.text(pv.notes, dx, dy + 40, { size: 30, font: 'body', color: C.text, outline: false });
    UI.text('Likely hostiles', dx, dy + 110, { size: 24, color: P.yellow, outlineW: 5 });
    var boss = ct && ct.boss, foes = pv.boss ? pv.hostiles.slice(0, 2).concat(['overlord']) : pv.hostiles;
    foes.forEach(function (k, i) {
      var ex = dx + 60 + i * 200, ey = dy + 200, isBoss = k === 'overlord';
      S.draw(g, 'shadow', ex, ey + 36, { scale: isBoss ? 1.6 : 1.0 });
      S.draw(g, isBoss && boss ? 'boss:' + boss.art : 'enemy:' + k, ex + (isBoss ? 30 : 0), ey - (isBoss ? 14 : 0) - Math.abs(Math.sin(app.t * 5 + i)) * 6, { scale: isBoss ? 0.62 : 0.95 });
      UI.text(isBoss && boss ? boss.name : D.ENEMY_INFO[k].name, ex + (isBoss ? 30 : 0), ey + 70, { size: 26, align: 'center', color: isBoss ? '#ff6a7a' : C.text });
    });
    if (pv.boss) {
      var bp = 0.6 + 0.4 * Math.sin(app.t * 6);
      UI.text('BOSS INBOUND', px + pw - 50, py + 60, { size: 36, align: 'right', color: 'rgba(255,106,122,' + bp + ')' });
    }
    // the fixer's note (Afterburn: a random line from the pool, fixed for this briefing)
    var note = ct && ct.note ? ['LUCKY', ct.note] : null;
    if (!note && next > ST.last) { if (!app.briefNote || app.briefNote.wave !== next) app.briefNote = { wave: next, b: MB.fx.choice(ST.pools.afterburn) }; note = app.briefNote.b; }
    if (note) {
      var ny = py + 450;
      SC.portrait(g, app, note[0], px + 100, ny + 44, 44);
      UI.text(note[0], px + 170, ny + 4, { size: 24, color: ST.speakers[note[0]].color, outlineW: 5 });
      UI.wrap(note[1], pw - 240, 28, 'body').slice(0, 3).forEach(function (ln, k) {
        UI.text(ln, px + 170, ny + 40 + k * 34, { size: 28, font: 'body', color: C.text, outline: false });
      });
    }
    var p = st.players[app.slot], waiting = p.ready && st.players.some(function (o) { return !o.ready; });
    if (app.coop) crewStatus(app, st, W / 2, py + ph - 136);
    if (MB.net.isSpectator()) UI.text('Spectating', W / 2, py + ph - 66, { size: 40, align: 'center', color: P.cyan });
    else if (UI.button('pv:go', waiting ? 'Waiting…' : 'Deploy', W / 2 - 220, py + ph - 110, 440, 86, { tone: 'good', size: 44, disabled: waiting }) || (!waiting && (IN.pressed('Space') || IN.confirm()))) app.cmd({ t: 'deploy' });
  };

  /* ------------------------------------------------------------------ pause */
  var TABS = ['Resume', 'Options', 'Legend', 'Controls', 'Quit'];
  SC.pause = function (app, g) {
    UI.dim(0.62);
    var px = 160, py = 70, pw = W - 320, ph = H - 140;
    UI.panel(px, py, pw, ph);
    UI.text(app.coop ? 'Menu' : 'Paused', W / 2, py + 60, { size: 64, align: 'center' });
    if (app.coop) UI.text('The crew\'s run keeps going while this is open.', W / 2, py + 104, { size: 22, font: 'body', align: 'center', color: '#ff9a3c', outline: false });
    app.pauseTab = UI.tabs('pt', TABS, app.pauseTab, px + 60, py + 124, pw - 120, 64);
    var cx = px + 60, cy = py + 220, cw = pw - 120;
    var tab = TABS[app.pauseTab], st = app.sim, p = st.players[app.slot];
    if (tab === 'Resume') {
      S.draw(g, 'char:' + p.arch, W / 2, cy + 150 - Math.abs(Math.sin(app.t * 4)) * 8, { scale: 1.6 });
      UI.text(shortName(D.ARCHETYPES[p.arch]) + '  ·  ' + st.difficulty, W / 2, cy + 270, { size: 34, align: 'center' });
      UI.text('Wave ' + st.wave + '  ·  ' + st.biome + '  ·  ' + st.kills + ' kills  ·  ' + p.items.length + ' items', W / 2, cy + 320, { size: 26, font: 'body', align: 'center', color: C.dim, outline: false });
      if (UI.button('pz:resume', 'Resume', W / 2 - 200, cy + 390, 400, 90, { tone: 'primary', size: 44 })) app.go('play');
    } else if (tab === 'Options') {
      optionsPanel(app, cx + 20, cy - 10, cw - 40);
    } else if (tab === 'Legend') {
      D.ENEMY_KINDS.concat(['overlord']).forEach(function (k, i) {
        var col = i % 2, row = Math.floor(i / 2), x = cx + col * (cw / 2), y = cy + row * 140;
        if (k === 'overlord') { x = cx + cw / 4; }
        UI.rr(x + 10, y, cw / 2 - 20, 124, 16); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fill();
        var spr = S.get('enemy:' + k), fit = Math.min(1, 100 / Math.max(spr.w, spr.h));
        S.draw(g, 'enemy:' + k, x + 90, y + 62, { scale: fit });
        UI.text(D.ENEMY_INFO[k].name, x + 170, y + 44, { size: 34 });
        UI.text(D.ENEMY_INFO[k].blurb, x + 170, y + 86, { size: 24, font: 'body', color: C.dim, outline: false });
      });
    } else if (tab === 'Controls') {
      var rows = [['Move', 'WASD / Arrows / Left stick'], ['Dash', 'Space / Shift / Right mouse / A, LB'], ['Aim', 'Mouse / Right stick'],
        ['Fire', 'Automatic (or hold LMB / RT with Manual Fire)'], ['Pause', 'Esc / Start'], ['Shop lock', 'Click the padlock on a card']];
      if (app.debug) rows.push(['Debug', '8 skip contract  ·  9 +100 eddies']);
      rows.forEach(function (r, i) {
        var y = cy + 20 + i * 70;
        UI.text(r[0], cx + 240, y, { size: 34, align: 'right', color: P.yellow });
        UI.text(r[1], cx + 290, y, { size: 30, font: 'body', color: C.text, outline: false });
      });
    } else if (tab === 'Quit' && app.coop) {
      var hosting = MB.net.role() === 'host';
      UI.text('Leave the crew?', W / 2, cy + 160, { size: 48, align: 'center' });
      UI.text(hosting ? 'Another runner takes over as host and the run carries on without you.' : 'The autopilot plays your runner until you rejoin with the same name.',
        W / 2, cy + 220, { size: 26, font: 'body', align: 'center', color: C.dim, outline: false });
      if (UI.button('pz:quit', 'Leave', W / 2 - 220, cy + 300, 440, 90, { tone: 'danger', size: 40 })) app.toMenu();
    } else if (tab === 'Quit') {
      UI.text('Abandon this run?', W / 2, cy + 160, { size: 48, align: 'center' });
      UI.text('Progress in this run is lost.', W / 2, cy + 220, { size: 26, font: 'body', align: 'center', color: C.dim, outline: false });
      if (UI.button('pz:quit', 'Quit to Menu', W / 2 - 220, cy + 300, 440, 90, { tone: 'danger', size: 40 })) app.toMenu();
    }
    if (IN.back()) app.go('play');
  };

  /* ------------------------------------------------------------------ game over */
  SC.gameover = function (app, g) {
    var st = app.sim, p = st.players[app.slot];
    var k = Math.min(1, app.screenT / 0.5);
    if (!app.deathLine || app.deathLine.sim !== st) app.deathLine = { sim: st, b: MB.fx.choice(ST.gameover[ST.actIndex(st.wave)]) };
    var dl = app.deathLine.b;
    UI.dim(0.7 * k);
    g.save(); g.globalAlpha = k;
    title(g, 'GAME OVER', W / 2, 200, 150, app.t, 99);
    var ct = ST.contract(st.wave);
    UI.text('Contract ' + st.wave + (ct ? ':  ' + ct.title : st.wave > ST.last ? '  ·  Afterburn' : ''), W / 2, 318, { size: 44, align: 'center', color: '#ffc0c8' });
    // the cast reacts
    var lw = Math.min(1100, UI.measure(dl[1], 28, 'body') + 40), lx = W / 2 - (lw + 90) / 2 + 90;
    SC.portrait(g, app, dl[0], lx - 50, 400, 36);
    UI.text(dl[0], lx, 380, { size: 22, color: ST.speakers[dl[0]].color, outlineW: 5 });
    UI.wrap(dl[1], 1100, 28, 'body').slice(0, 2).forEach(function (ln, n) {
      UI.text(ln, lx, 414 + n * 32, { size: 28, font: 'body', color: C.text, outline: false });
    });
    UI.panel(W / 2 - 420, 490, 840, 290);
    S.draw(g, 'char:' + p.arch, W / 2 - 290, 640, { scale: 1.5, rot: 1.35, alpha: 0.9 });
    var lines = [['Character', shortName(D.ARCHETYPES[p.arch])], ['Difficulty', st.difficulty], ['Kills', String(st.kills)], ['Items', String(p.items.length)], ['District', st.biome]];
    lines.forEach(function (l, i) {
      UI.text(l[0], W / 2 - 140, 536 + i * 48, { size: 26, font: 'body', color: C.dim, outline: false });
      UI.text(l[1], W / 2 + 380, 536 + i * 48, { size: 30, align: 'right' });
    });
    g.restore();
    if (app.screenT > 0.6 && app.coop) {
      var role = MB.net.role();
      if (role === 'host') {
        if (UI.button('go:lobby', 'Back to Lobby', W / 2 - 430, 850, 410, 90, { tone: 'primary', size: 40 }) || IN.confirm()) MB.net.reset();
        if (UI.button('go:menu', 'Leave', W / 2 + 20, 850, 410, 90, { size: 44 }) || IN.back()) app.toMenu();
      } else {
        if (role === 'guest') UI.text('Waiting for the host to start another run…', W / 2, 820, { size: 28, font: 'body', align: 'center', color: C.dim, outline: false });
        if (UI.button('go:menu', role === 'guest' ? 'Leave' : 'Menu', W / 2 - 205, 850, 410, 90, { size: 44 }) || IN.back()) app.toMenu();
      }
    } else if (app.screenT > 0.6) {
      if (UI.button('go:retry', 'Retry', W / 2 - 430, 850, 410, 90, { tone: 'primary', size: 44 }) || IN.confirm()) app.startRun();
      if (UI.button('go:menu', 'Menu', W / 2 + 20, 850, 410, 90, { size: 44 }) || IN.back()) app.toMenu();
    }
  };
})();
