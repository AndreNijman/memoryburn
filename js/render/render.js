/*
 * MemoryBurn - js/render/render.js
 *
 * Draws the arena from sim state in virtual coordinates (1920x1080). Reads state, never writes it.
 *
 *   MB.render.snapshot(state) -> prev     positions to interpolate from (call before each sim step)
 *   MB.render.world(g, state, prev, alpha, t, opts)
 *        alpha: 0..1 between prev and state; t: render clock in seconds; opts: {rangeRing, localSlot}
 */
(function () {
  'use strict';
  var R = MB.render, S = MB.sprites, P = S.palette, D = MB.data, TAU = Math.PI * 2;
  var W = D.VIRTUAL_W, H = D.VIRTUAL_H;

  // Sprite scale per enemy kind so the drawn body sits a little outside the sim hitbox, Brotato-style.
  var ESCALE = { scrap: 1.4, brute: 0.98, skater: 1.18, suicide: 1.25, aegis: 1.08, sentry: 1.12, overlord: 1.0 };
  var CHAR_SCALE = 1.2;
  var facing = {}; // render-only memory of which way each player last faced (never stored on sim state)

  R.snapshot = function (state) {
    var m = Object.create(null);
    state.enemies.forEach(function (e) { m['e' + e.id] = [e.x, e.y]; });
    state.bullets.forEach(function (b) { m['b' + b.id] = [b.x, b.y]; });
    state.ebullets.forEach(function (b) { m['q' + b.id] = [b.x, b.y]; });
    state.pickups.forEach(function (q) { m['k' + q.id] = [q.x, q.y]; });
    state.players.forEach(function (p) { m['p' + p.slot] = [p.x, p.y]; p.pets.forEach(function (pt, i) { m['t' + p.slot + '_' + i] = [pt.x, pt.y]; }); });
    return m;
  };
  function lerpPos(prev, key, x, y, a) {
    var o = prev && prev[key];
    if (!o) return [x, y];
    return [o[0] + (x - o[0]) * a, o[1] + (y - o[1]) * a];
  }

  var patterns = new WeakMap();
  function floorPattern(g, biome) {
    var m = patterns.get(g);
    if (!m) { m = {}; patterns.set(g, m); }
    if (!m[biome]) m[biome] = g.createPattern(S.floor(biome), 'repeat');
    return m[biome];
  }

  R.drawFloor = function (g, biome) {
    g.fillStyle = floorPattern(g, biome);
    g.fillRect(-40, -40, W + 80, H + 80); // overdraw so screen shake never reveals the letterbox
    // arena rim: darker edge band with an outlined inner border, like Brotato's walls
    var v = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 1.05);
    v.addColorStop(0, 'rgba(10,6,16,0)'); v.addColorStop(1, 'rgba(10,6,16,0.55)');
    g.fillStyle = v; g.fillRect(0, 0, W, H);
    g.lineWidth = 10; g.strokeStyle = 'rgba(28,22,34,0.85)'; g.strokeRect(5, 5, W - 10, H - 10);
    g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,0.08)'; g.strokeRect(12, 12, W - 24, H - 24);
  };

  function drawShadow(g, x, y, w) { S.draw(g, 'shadow', x, y, { sx: w / 56, sy: w / 56 }); }

  function drawEnemy(g, e, x, y, t) {
    var key = 'enemy:' + e.etype, sc = ESCALE[e.etype] || 1;
    var spr = S.get(key);
    var pop = Math.min(1, e.age / 0.22), popS = pop < 1 ? 0.3 + 0.7 * pop + Math.sin(pop * Math.PI) * 0.25 : 1;
    var bob = Math.sin(t * 9 + e.id * 1.7), sx = 1 + bob * 0.05, sy = 1 - bob * 0.05;
    if (e.etype === 'brute' && e.charging) { sx *= 1.06; sy *= 0.94; }
    if (e.etype === 'sentry') { sx = 1; sy = 1; }
    var hh = spr.h * sc;
    drawShadow(g, x, y + e.size * 0.5 + 4, e.size * (e.etype === 'overlord' ? 2.0 : 1.45));
    var face = e.face || 1;
    var flash = e.flash_t > 0 ? 1 : 0;
    var lift = e.etype === 'skater' ? Math.sin(t * 14 + e.id) * 2 : Math.max(0, bob) * 3;
    S.draw(g, key, x, y - hh * 0.08 - lift, { scale: sc * popS, sx: sx, sy: sy, flip: face < 0, flash: flash });
    if (e.etype === 'suicide' && Math.sin(t * 16 + e.id) > 0.3) { // blinking fuse light
      g.fillStyle = 'rgba(255,90,110,0.45)'; g.beginPath(); g.arc(x, y - hh * 0.24, 9, 0, TAU); g.fill();
    }
    // hp / shield bars once damaged
    if (e.hp < e.max_hp || (e.etype === 'aegis' && e.shield_hp < 80)) {
      var bw = e.etype === 'overlord' ? 130 : 46, bx = x - bw / 2, by = y - hh * 0.55 - 8;
      bar(g, bx, by, bw, 8, Math.max(0, e.hp / e.max_hp), '#ef4d5f');
      if (e.etype === 'aegis' && e.shield_hp > 0) bar(g, bx, by - 9, bw, 6, Math.max(0, e.shield_hp / 80), P.cyan);
    }
  }

  function bar(g, x, y, w, h, f, col) {
    g.fillStyle = P.OUT; roundRect(g, x - 2, y - 2, w + 4, h + 4, (h + 4) / 2); g.fill();
    g.fillStyle = '#3a3346'; roundRect(g, x, y, w, h, h / 2); g.fill();
    if (f > 0) { g.fillStyle = col; roundRect(g, x, y, Math.max(h, w * f), h, h / 2); g.fill(); }
  }
  function roundRect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  R.roundRect = roundRect; R.bar = bar;

  function drawPlayer(g, p, x, y, t, opts) {
    var moving = Math.abs(p.vx) + Math.abs(p.vy) > 20;
    var aimA = Math.atan2(p.aimY - p.y, p.aimX - p.x);
    var faceLeft = moving ? p.vx < -1 : Math.cos(aimA) < 0;
    if (moving || facing[p.slot] == null) facing[p.slot] = faceLeft; else faceLeft = facing[p.slot];
    var hop = moving ? Math.abs(Math.sin(t * 13)) : 0;
    var sx = 1 + (moving ? (1 - hop) * 0.06 : Math.sin(t * 3) * 0.02), sy = 1 - (moving ? (1 - hop) * 0.06 : Math.sin(t * 3) * 0.02);
    var blink = p.iframe > 0 && !p.dashing && Math.floor(t * 20) % 2 === 0;
    if (opts.rangeRing) {
      g.save(); g.setLineDash([10, 14]); g.lineWidth = 2; g.strokeStyle = 'rgba(150,200,255,0.16)';
      g.beginPath(); g.arc(x, y, p.range_px, 0, TAU); g.stroke(); g.restore();
    }
    drawShadow(g, x, y + 28, 60);
    if (p.dashing) {
      for (var k = 1; k <= 3; k++) S.draw(g, 'char:' + p.arch, x - p.dash_dx * k * 22, y - 8 - p.dash_dy * k * 22, { scale: CHAR_SCALE, flip: faceLeft, alpha: 0.25 / k });
    }
    var alpha = blink ? 0.35 : 1;
    // weapon behind when aiming up, in front otherwise
    var gx = x + Math.cos(aimA) * 26, gy = y + 6 + Math.sin(aimA) * 18;
    var gunOpts = { scale: 0.95, rot: aimA, sy: Math.cos(aimA) < 0 ? -1 : 1, alpha: alpha };
    var recoil = p.cooldown > 0 ? Math.max(0, p.cooldown - 0.75 * (D.ARCHETYPES[p.arch].base_cd || 0.5)) * 30 : 0;
    gx -= Math.cos(aimA) * recoil; gy -= Math.sin(aimA) * recoil;
    if (Math.sin(aimA) < -0.3) S.draw(g, 'gun:' + p.arch, gx, gy, gunOpts);
    S.draw(g, 'char:' + p.arch, x, y - 8 - hop * 6, { scale: CHAR_SCALE, sx: sx, sy: sy, flip: faceLeft, alpha: alpha, flash: opts.hurt ? 0.8 : 0 });
    if (Math.sin(aimA) >= -0.3) S.draw(g, 'gun:' + p.arch, gx, gy, gunOpts);
    if (opts.label) {
      g.font = '22px "Lilita One", system-ui'; g.textAlign = 'center'; g.lineWidth = 5; g.strokeStyle = P.OUT;
      g.strokeText(opts.label, x, y - 62); g.fillStyle = '#ffffff'; g.fillText(opts.label, x, y - 62);
    }
  }

  R.world = function (g, state, prev, a, t, opts) {
    opts = opts || {};
    var i, pos;
    R.drawFloor(g, state.biome);
    R.fx.drawGround(g);

    // pickups
    for (i = 0; i < state.pickups.length; i++) {
      var q = state.pickups[i];
      pos = lerpPos(prev, 'k' + q.id, q.x, q.y, a);
      var bob = Math.sin(t * 5 + q.id) * 3;
      drawShadow(g, pos[0], pos[1] + 9, 20);
      S.draw(g, 'pickup:' + q.kind, pos[0], pos[1] - 4 + bob, { scale: q.kind === 'mat' ? 0.95 : 0.9, rot: q.kind === 'xp' ? Math.sin(t * 3 + q.id) * 0.3 : 0 });
    }

    // y-sorted actors
    var actors = [];
    state.enemies.forEach(function (e) { var p2 = lerpPos(prev, 'e' + e.id, e.x, e.y, a); actors.push({ y: p2[1], k: 0, o: e, x: p2[0] }); });
    state.players.forEach(function (p) { if (!p.alive) return; var p2 = lerpPos(prev, 'p' + p.slot, p.x, p.y, a); actors.push({ y: p2[1], k: 1, o: p, x: p2[0] }); });
    actors.sort(function (u, v) { return u.y - v.y; });
    for (i = 0; i < actors.length; i++) {
      var ac = actors[i];
      if (ac.k === 0) drawEnemy(g, ac.o, ac.x, ac.y, t);
      else drawPlayer(g, ac.o, ac.x, ac.y, t, { rangeRing: opts.rangeRing && ac.o.slot === opts.localSlot, hurt: ac.o.slot === opts.localSlot && R.fx.hurtFlash > 0.25, label: state.players.length > 1 ? 'P' + (ac.o.slot + 1) : null });
    }

    // pets
    state.players.forEach(function (p) {
      if (!p.alive) return;
      p.pets.forEach(function (pt, k) {
        var pp = lerpPos(prev, 't' + p.slot + '_' + k, pt.x, pt.y, a);
        var hov = Math.sin(t * 4 + k) * 4;
        drawShadow(g, pp[0], pp[1] + 22, 24);
        S.draw(g, 'pet:' + pt.kind, pp[0], pp[1] - 10 + hov, { scale: 1.05, flip: pt.kind === 'turret_buddy' && Math.cos(pt.ang || 0) < 0 });
      });
    });

    // bullets
    for (i = 0; i < state.bullets.length; i++) {
      var b = state.bullets[i];
      pos = lerpPos(prev, 'b' + b.id, b.x, b.y, a);
      var ang = Math.atan2(b.vy, b.vx), s = b.r / 6;
      if (b.kind === 'ion') S.draw(g, 'bullet:' + b.color, pos[0], pos[1], { rot: ang, scale: s, sx: 2.0 });
      else S.draw(g, 'bullet:' + b.color, pos[0], pos[1], { rot: ang, scale: s, sx: b.kind === 'spike' ? 1.5 : 1 });
    }
    for (i = 0; i < state.ebullets.length; i++) {
      var eb = state.ebullets[i];
      pos = lerpPos(prev, 'q' + eb.id, eb.x, eb.y, a);
      S.draw(g, 'ebullet', pos[0], pos[1], { scale: 1 + Math.sin(t * 20 + eb.id) * 0.08 });
    }

    R.fx.drawTop(g);
    R.fx.drawWeather(g, state.biome, state);

    // district lighting
    var b0 = D.BIOMES[state.biome];
    if (b0.dim) {
      var lp = state.players.filter(function (p) { return p.alive; })[0];
      if (lp) {
        var pp0 = lerpPos(prev, 'p' + lp.slot, lp.x, lp.y, a);
        var gr = g.createRadialGradient(pp0[0], pp0[1], 120, pp0[0], pp0[1], 900);
        gr.addColorStop(0, 'rgba(6,4,14,0)'); gr.addColorStop(1, 'rgba(6,4,14,' + (b0.dim * 2.4) + ')');
        g.fillStyle = gr; g.fillRect(0, 0, W, H);
      }
    }
    if (b0.hp_drain) {
      var pulse = 0.12 + Math.sin(t * 2) * 0.05;
      var rg = g.createRadialGradient(W / 2, H / 2, H * 0.4, W / 2, H / 2, H);
      rg.addColorStop(0, 'rgba(255,60,40,0)'); rg.addColorStop(1, 'rgba(255,60,40,' + pulse + ')');
      g.fillStyle = rg; g.fillRect(0, 0, W, H);
    }
    if (state.jungleSlow < 1) { g.fillStyle = 'rgba(80,220,120,0.08)'; g.fillRect(0, 0, W, H); }
    if (R.fx.hurtFlash > 0) {
      var hg = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.9);
      hg.addColorStop(0, 'rgba(239,77,95,0)'); hg.addColorStop(1, 'rgba(239,77,95,' + (R.fx.hurtFlash * 1.2) + ')');
      g.fillStyle = hg; g.fillRect(0, 0, W, H);
    }
  };
})();
