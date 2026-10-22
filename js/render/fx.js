/*
 * MemoryBurn - js/render/fx.js
 *
 * Cosmetic effects driven by sim events: particles, ground splats, floating damage numbers, tracers,
 * screen shake and district weather. Uses MB.fx (cosmetic RNG) only; never touches sim state.
 *
 *   MB.render.fx.reset()
 *   MB.render.fx.consume(events, settings)   settings: {shake, tracers, dmgNums, reducedFlashes, vfx}
 *   MB.render.fx.update(dt, biome)
 *   MB.render.fx.drawGround(ctx) / drawTop(ctx) / drawWeather(ctx, biome)
 *   MB.render.fx.shake() -> [ox, oy]
 */
(function () {
  'use strict';
  var R = MB.render = MB.render || {}, S = MB.sprites, P = S.palette, rnd = MB.fx, TAU = Math.PI * 2;
  var W = MB.data.VIRTUAL_W, H = MB.data.VIRTUAL_H;

  var parts = [], decals = [], texts = [], tracers = [], rings = [], weather = [];
  var shakeT = 0, shakeMag = 0;
  var MAX_PARTS = 900, MAX_DECALS = 140;

  var ENEMY_COL = { scrap: '#c96a3a', brute: '#a8344a', skater: '#2fb5a3', suicide: '#3b3448', aegis: '#4a74d8', sentry: '#8d97ad', overlord: '#9b4fe0' };
  var SPLAT_COL = { scrap: '#7a3e22', brute: '#5e1a2a', skater: '#17655b', suicide: '#1f1a28', aegis: '#253f80', sentry: '#4b5266', overlord: '#57217f' };

  function part(x, y, vx, vy, life, col, r, o) {
    if (parts.length >= MAX_PARTS) parts.shift();
    o = o || {};
    parts.push({ x: x, y: y, vx: vx, vy: vy, life: life, max: life, col: col, r: r, grow: o.grow || 0, drag: o.drag != null ? o.drag : 0.9,
      grav: o.grav || 0, shape: o.shape || 'dot', rot: rnd.uniform(0, TAU), spin: rnd.uniform(-8, 8), outline: !!o.outline });
  }
  function burst(x, y, n, col, spd, life, r, o) {
    for (var i = 0; i < n; i++) {
      var a = rnd.uniform(0, TAU), s = rnd.uniform(spd * 0.35, spd);
      part(x, y, Math.cos(a) * s, Math.sin(a) * s, rnd.uniform(life * 0.6, life), col, rnd.uniform(r * 0.6, r), o);
    }
  }
  function addShake(mag, dur) { shakeT = Math.max(shakeT, dur); shakeMag = Math.max(shakeMag, mag); }
  function text(x, y, str, col, size, o) {
    texts.push({ x: x + rnd.uniform(-10, 10), y: y - 10, vy: -110, str: str, col: col, size: size, life: (o && o.life) || 0.75, max: (o && o.life) || 0.75, pop: 0 });
    if (texts.length > 80) texts.shift();
  }

  var fx = R.fx = {};
  fx.reset = function () { parts.length = 0; decals.length = 0; texts.length = 0; tracers.length = 0; rings.length = 0; weather.length = 0; shakeT = 0; shakeMag = 0; };

  fx.consume = function (events, set) {
    var vfx = set.vfx != null ? set.vfx : 1;
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      switch (e.t) {
        case 'hit':
          if (!set.reducedFlashes) burst(e.x, e.y, Math.round(4 * vfx), '#fff4d6', 260, 0.18, 4);
          if (set.dmgNums) text(e.x, e.y, String(e.dmg), e.crit ? '#ffd35a' : '#ffffff', e.crit ? 40 : 30);
          break;
        case 'block':
          rings.push({ x: e.x, y: e.y, r: 6, max: 30, life: 0.18, mx: 0.18, col: P.cyan });
          if (set.dmgNums) text(e.x, e.y, 'BLOCK', '#8cdcff', 24);
          break;
        case 'kill':
          var col = ENEMY_COL[e.kind] || '#c96a3a';
          burst(e.x, e.y, Math.round((e.elite ? 22 : 14) * vfx), col, 380, 0.45, e.elite ? 9 : 7, { outline: true, drag: 0.86 });
          burst(e.x, e.y, Math.round(6 * vfx), '#3a3346', 200, 0.5, 5, { shape: 'chunk', outline: true, drag: 0.85 });
          rings.push({ x: e.x, y: e.y, r: 10, max: e.elite ? 110 : 60, life: 0.25, mx: 0.25, col: '#ffffff' });
          if (decals.length >= MAX_DECALS) decals.shift();
          decals.push({ x: e.x, y: e.y, r: e.kind === 'overlord' ? 70 : 26, col: SPLAT_COL[e.kind] || '#3a2a30', seed: rnd.next() * 1000, life: 14, max: 14 });
          if (e.elite) addShake(set.shake ? 8 : 0, 0.18);
          break;
        case 'explode':
          burst(e.x, e.y, Math.round(26 * vfx), P.orange, 420, 0.5, 9, { outline: true });
          rings.push({ x: e.x, y: e.y, r: 10, max: 90, life: 0.3, mx: 0.3, col: P.red });
          if (set.shake) addShake(7, 0.2);
          break;
        case 'portal':
          rings.push({ x: e.x, y: e.y, r: 4, max: e.kind === 'overlord' ? 120 : 46, life: 0.4, mx: 0.4, col: P.purple, fill: true });
          burst(e.x, e.y, Math.round(8 * vfx), '#a08cff', 200, 0.45, 5, { grow: 1.2 });
          break;
        case 'hurt':
          burst(e.x, e.y, Math.round(10 * vfx), P.red, 300, 0.35, 6, { outline: true });
          if (set.dmgNums) text(e.x, e.y - 30, '-' + e.dmg, '#ff6a7a', 34);
          if (set.localSlot != null && e.slot !== set.localSlot) break; // shake + flash only for the local player
          if (set.shake) addShake(6, 0.2);
          fx.hurtFlash = set.reducedFlashes ? 0 : 0.35;
          break;
        case 'pickup':
          burst(e.x, e.y, 4, e.kind === 'mat' ? P.green : e.kind === 'heal' ? P.red : P.blue, 140, 0.25, 4);
          if (e.kind === 'heal' && set.dmgNums) text(e.x, e.y - 20, '+' + e.amount, P.green, 30);
          break;
        case 'heal':
          if (set.dmgNums) text(e.x, e.y - 34, '+' + e.amt, P.green, 26);
          break;
        case 'dash':
          for (var k = 0; k < 8; k++) part(e.x - e.dx * k * 10, e.y - e.dy * k * 10 + 20, -e.dx * 60, -e.dy * 60, 0.35, '#e8e0f0', 9 - k * 0.6, { grow: 0.8 });
          break;
        case 'tracer':
          if (set.tracers) tracers.push({ x0: e.x0, y0: e.y0, x1: e.x1, y1: e.y1, life: 0.08, max: 0.08 });
          break;
        case 'shoot':
          if (!set.reducedFlashes) part(e.x + Math.cos(e.ang) * 40, e.y + Math.sin(e.ang) * 40 - 6, 0, 0, 0.07, '#fff6c8', 9, { grow: 0.6 });
          break;
        case 'eshoot':
          rings.push({ x: e.x, y: e.y, r: 4, max: e.big ? 60 : 24, life: 0.15, mx: 0.15, col: '#ff6a8a' });
          break;
        case 'death':
          burst(e.x, e.y, 40, P.red, 500, 0.9, 10, { outline: true });
          if (set.shake) addShake(14, 0.4);
          break;
      }
    }
  };

  fx.update = function (dt, biome) {
    var i, p;
    shakeT = Math.max(0, shakeT - dt); if (shakeT <= 0) shakeMag = 0;
    if (fx.hurtFlash > 0) fx.hurtFlash = Math.max(0, fx.hurtFlash - dt);
    var n = 0, k60 = dt * 60, tk = Math.pow(0.88, k60);
    for (i = 0; i < parts.length; i++) {
      p = parts[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      var k = Math.pow(p.drag, k60);
      p.vx *= k; p.vy = p.vy * k + p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.spin * dt;
      parts[n++] = p;
    }
    parts.length = n;
    for (i = 0, n = 0; i < texts.length; i++) {
      var t = texts[i];
      t.life -= dt; t.pop += dt;
      if (t.life <= 0) continue;
      t.y += t.vy * dt; t.vy *= tk;
      texts[n++] = t;
    }
    texts.length = n;
    age(tracers, dt); age(rings, dt); age(decals, dt);
    updateWeather(dt, biome);
  };

  function age(list, dt) { // drop expired entries in place, keeping order
    for (var i = 0, n = 0; i < list.length; i++) { list[i].life -= dt; if (list[i].life > 0) list[n++] = list[i]; }
    list.length = n;
  }

  fx.shake = function () {
    if (shakeT <= 0 || shakeMag <= 0) return [0, 0];
    var a = rnd.uniform(0, TAU), m = shakeMag * Math.min(1, shakeT / 0.15);
    return [Math.cos(a) * m, Math.sin(a) * m];
  };

  // Ground layer: splats under everything else.
  fx.drawGround = function (g) {
    for (var i = 0; i < decals.length; i++) {
      var d = decals[i], a = Math.min(1, d.life / 3) * 0.55;
      g.save(); g.globalAlpha = a; g.fillStyle = d.col; g.translate(d.x, d.y);
      g.beginPath(); g.ellipse(0, 0, d.r, d.r * 0.6, 0, 0, TAU); g.fill();
      for (var k = 0; k < 5; k++) {
        var ang = (d.seed + k * 2.3) % TAU, dist = d.r * (0.9 + ((d.seed * (k + 1)) % 7) / 10);
        g.beginPath(); g.arc(Math.cos(ang) * dist, Math.sin(ang) * dist * 0.6, d.r * 0.18, 0, TAU); g.fill();
      }
      g.restore();
    }
  };

  /* Particles and damage numbers are blitted from small cached images instead of being filled and stroked
   * as paths each frame; a busy wave has several hundred of them. */
  var dotImgs = Object.create(null), chunkImgs = Object.create(null), textImgs = Object.create(null), textN = 0, fontOk = false;
  var DOT_R = 8, IMG_RES = 2; // dots are baked at radius 8 and scaled; the 2px outline scales with them
  function dotImg(col, outline) {
    var key = col + (outline ? '+' : ''), c = dotImgs[key];
    if (c) return c;
    var e = (DOT_R + 2) * IMG_RES;
    c = S.mkCanvas(e * 2, e * 2); var cg = c.getContext('2d');
    cg.scale(IMG_RES, IMG_RES); cg.beginPath(); cg.arc(DOT_R + 2, DOT_R + 2, DOT_R, 0, TAU); cg.fillStyle = col; cg.fill();
    if (outline) { cg.lineWidth = 2; cg.strokeStyle = P.OUT; cg.stroke(); }
    return (dotImgs[key] = c);
  }
  function chunkImg(col) {
    var c = chunkImgs[col];
    if (c) return c;
    var e = (DOT_R + 2) * IMG_RES;
    c = S.mkCanvas(e * 2, e * 2); var cg = c.getContext('2d');
    cg.scale(IMG_RES, IMG_RES); cg.translate(DOT_R + 2, DOT_R + 2);
    cg.fillStyle = col; cg.fillRect(-DOT_R, -DOT_R * 0.7, DOT_R * 2, DOT_R * 1.4);
    cg.lineWidth = 2; cg.strokeStyle = P.OUT; cg.strokeRect(-DOT_R, -DOT_R * 0.7, DOT_R * 2, DOT_R * 1.4);
    return (chunkImgs[col] = c);
  }
  function textFont(size) { return size + 'px "Lilita One", system-ui, sans-serif'; }
  // Outlined text baked at k device px per virtual px; null until the display font has loaded, so a
  // fallback face never gets cached.
  function textImg(str, col, size, k) {
    if (!fontOk) { if (typeof document === 'undefined' || !document.fonts || !document.fonts.check(textFont(size))) return null; fontOk = true; }
    var key = str + '|' + col + '|' + size + '|' + k, c = textImgs[key];
    if (c) return c;
    if (++textN > 400) { textImgs = Object.create(null); textN = 1; }
    c = S.mkCanvas(1, 1); var cg = c.getContext('2d');
    cg.font = textFont(size);
    var w = Math.ceil(cg.measureText(str).width) + 12, h = Math.ceil(size * 1.3) + 12;
    c.width = Math.ceil(w * k); c.height = Math.ceil(h * k);
    cg.scale(k, k); cg.font = textFont(size); cg.textAlign = 'center'; cg.textBaseline = 'middle'; cg.lineJoin = 'round';
    cg.lineWidth = 6; cg.strokeStyle = P.OUT; cg.strokeText(str, w / 2, h / 2);
    cg.fillStyle = col; cg.fillText(str, w / 2, h / 2);
    c.vw = w; c.vh = h;
    return (textImgs[key] = c);
  }

  // Top layer: particles, rings, tracers, damage numbers.
  fx.drawTop = function (g) {
    var i;
    for (i = 0; i < rings.length; i++) {
      var r = rings[i], t = 1 - r.life / r.mx, rad = r.r + (r.max - r.r) * t;
      g.save(); g.globalAlpha = 1 - t;
      if (r.fill) { g.fillStyle = S.rgba(r.col, 0.25); g.beginPath(); g.arc(r.x, r.y, rad, 0, TAU); g.fill(); }
      g.lineWidth = 5 * (1 - t) + 1; g.strokeStyle = r.col; g.beginPath(); g.arc(r.x, r.y, rad, 0, TAU); g.stroke();
      g.restore();
    }
    var m = g.getTransform(), ma = m.a, mb = m.b, mc = m.c, md = m.d, me = m.e, mf = m.f, E = DOT_R + 2;
    for (i = 0; i < parts.length; i++) {
      var p = parts[i], f = p.life / p.max, rr = p.r * (1 + p.grow * (1 - f)), q = rr / DOT_R;
      g.globalAlpha = Math.min(1, f * 1.6);
      if (p.shape === 'chunk') { // rotate about the particle: base * translate(x,y) * rotate(rot) * scale(q)
        var cs = Math.cos(p.rot) * q, sn = Math.sin(p.rot) * q;
        g.setTransform(ma * cs + mc * sn, mb * cs + md * sn, mc * cs - ma * sn, md * cs - mb * sn, ma * p.x + mc * p.y + me, mb * p.x + md * p.y + mf);
        g.drawImage(chunkImg(p.col), -E, -E, E * 2, E * 2);
      } else {
        g.setTransform(ma, mb, mc, md, me, mf);
        g.drawImage(dotImg(p.col, p.outline), p.x - E * q, p.y - E * q, E * 2 * q, E * 2 * q);
      }
    }
    g.setTransform(ma, mb, mc, md, me, mf);
    g.globalAlpha = 1;
    g.lineCap = 'round';
    for (i = 0; i < tracers.length; i++) {
      var tr = tracers[i];
      g.globalAlpha = tr.life / tr.max; g.strokeStyle = '#ffffff'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(tr.x0, tr.y0); g.lineTo(tr.x1, tr.y1); g.stroke();
    }
    g.globalAlpha = 1;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    var tk = Math.ceil(S.zoom * 1.2 * 2) / 2; // bake at the largest pop scale so it never upscales
    for (i = 0; i < texts.length; i++) {
      var tx = texts[i], sc = tx.pop < 0.08 ? 0.6 + tx.pop / 0.08 * 0.6 : Math.max(1, 1.2 - (tx.pop - 0.08) * 2);
      g.globalAlpha = Math.min(1, tx.life / tx.max * 2.5);
      var ti = textImg(tx.str, tx.col, tx.size, tk);
      if (ti) { g.drawImage(ti, tx.x - ti.vw * sc / 2, tx.y - ti.vh * sc / 2, ti.vw * sc, ti.vh * sc); continue; }
      g.save(); g.translate(tx.x, tx.y); g.scale(sc, sc);
      g.font = textFont(tx.size);
      g.lineWidth = 6; g.strokeStyle = P.OUT; g.strokeText(tx.str, 0, 0);
      g.fillStyle = tx.col; g.fillText(tx.str, 0, 0);
      g.restore();
    }
    g.globalAlpha = 1;
  };

  /* ------------------------------------------------------------------ weather (cosmetic) */
  function updateWeather(dt, biome) {
    var b = MB.data.BIOMES[biome] || {}, i;
    if (b.snow) for (i = 0; i < 3; i++) weather.push({ k: 'rain', x: rnd.uniform(-200, W), y: -20, vx: 220, vy: rnd.uniform(1300, 1600), life: 1.2 });
    if (b.dust && rnd.next() < 0.5) weather.push({ k: 'dust', x: rnd.uniform(0, W), y: rnd.uniform(0, H), vx: rnd.uniform(30, 70), vy: rnd.uniform(-10, 10), life: rnd.uniform(2, 3.5), max: 3.5, r: rnd.uniform(2, 5) });
    if (b.embers && rnd.next() < 0.6) weather.push({ k: 'ember', x: rnd.uniform(0, W), y: H + 10, vx: rnd.uniform(-20, 20), vy: rnd.uniform(-60, -140), life: rnd.uniform(3, 6), max: 6, r: rnd.uniform(2, 4.5) });
    if (b.wind && rnd.next() < 0.35) weather.push({ k: 'wind', x: rnd.uniform(-100, W), y: rnd.uniform(0, H), vx: 0, vy: 0, life: 0.9, max: 0.9, len: rnd.uniform(80, 200) });
    if (b.pulse_slow && rnd.next() < 0.15) weather.push({ k: 'spore', x: rnd.uniform(0, W), y: rnd.uniform(0, H), vx: rnd.uniform(-10, 10), vy: rnd.uniform(-20, -5), life: 3, max: 3, r: rnd.uniform(2, 4) });
    for (i = weather.length - 1; i >= 0; i--) {
      var w = weather[i];
      w.life -= dt; w.x += w.vx * dt; w.y += w.vy * dt;
      if (w.life <= 0 || w.y > H + 40) weather.splice(i, 1);
    }
    if (weather.length > 700) weather.splice(0, weather.length - 700);
  }

  fx.drawWeather = function (g, biome, state) {
    var i, w;
    g.lineCap = 'round';
    for (i = 0; i < weather.length; i++) {
      w = weather[i];
      if (w.k === 'rain') { g.strokeStyle = 'rgba(190,215,255,0.35)'; g.lineWidth = 2; g.beginPath(); g.moveTo(w.x, w.y); g.lineTo(w.x - 4, w.y - 26); g.stroke(); }
      else if (w.k === 'dust') { g.fillStyle = 'rgba(230,200,140,' + (0.35 * w.life / w.max) + ')'; g.beginPath(); g.arc(w.x, w.y, w.r, 0, TAU); g.fill(); }
      else if (w.k === 'ember') { g.fillStyle = 'rgba(255,' + (140 + Math.round(60 * w.life / w.max)) + ',80,' + (0.9 * w.life / w.max) + ')'; g.beginPath(); g.arc(w.x, w.y, w.r, 0, TAU); g.fill(); }
      else if (w.k === 'spore') { g.fillStyle = 'rgba(160,255,170,' + (0.5 * w.life / w.max) + ')'; g.beginPath(); g.arc(w.x, w.y, w.r, 0, TAU); g.fill(); }
      else if (w.k === 'wind' && state) {
        var wl = Math.hypot(state.wind.x, state.wind.y) || 1, ux = state.wind.x / wl, uy = state.wind.y / wl, t = 1 - w.life / w.max;
        g.strokeStyle = 'rgba(230,240,255,' + (0.35 * Math.sin(t * Math.PI)) + ')'; g.lineWidth = 3;
        var x = w.x + ux * t * 300, y = w.y + uy * t * 300;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x - ux * w.len, y - uy * w.len); g.stroke();
      }
    }
  };
})();
