/*
 * MemoryBurn - js/ui/radio.js
 *
 * In-wave comms: short story lines that play over the fight without pausing it. Driven by the campaign
 * script (two lines per contract), boss entrances and kills, low HP and side-job results. Reads sim
 * state and events only; picks from line pools with the cosmetic RNG, so the sim never sees it.
 *
 *   MB.radio.reset()                    new run
 *   MB.radio.events(app, events)        after each sim step
 *   MB.radio.update(app, dt)            once per frame while playing
 *   MB.radio.draw(app, g, viewW, viewH) from the HUD (already scaled)
 */
(function () {
  'use strict';
  var D = MB.data, UI = MB.ui, SC = MB.screens, ST = D.STORY;
  var queue = [], cur = null, wave = -1, said = {}, questWas = '';

  function say(who, line, urgent) {
    var m = { who: who, line: line, t: 0, dur: 3.4 + line.length / 24 };
    if (urgent) { queue.unshift(m); if (cur) cur.t = Math.max(cur.t, cur.dur - 0.25); } else queue.push(m);
    if (queue.length > 3) queue.length = 3; // stale chatter is worse than none
  }
  function once(key, fn) { if (!said[key]) { said[key] = true; fn(); } }
  function pick(pool) { var b = MB.fx.choice(pool); say(b[0], b[1]); }

  function reset() { queue = []; cur = null; wave = -1; said = {}; questWas = ''; }

  function events(app, evs) {
    var ct = ST.contract(app.sim.wave);
    for (var i = 0; i < evs.length; i++) {
      var e = evs[i];
      if (e.t === 'kill' && e.kind === 'overlord' && ct && ct.boss) once('bossDown', function () { say(ct.boss.speaker, ct.boss.down, true); });
    }
  }

  function update(app, dt) {
    var s = app.sim;
    if (!s || s.phase !== 'play') { if (cur) cur.t += dt; return; }
    if (s.wave !== wave) { wave = s.wave; said = {}; questWas = ''; queue = []; cur = null; } // last contract's chatter is stale
    var ct = ST.contract(s.wave), p = s.players[app.slot];
    var total = D.WAVE_TIME + Math.min(15, s.wave * 0.6), el = total - s.waveTime;
    if (ct) {
      if (el > 2.6 && ct.radio[0]) once('r0', function () { say(ct.radio[0][0], ct.radio[0][1]); });
      if (el > total * 0.5 && ct.radio[1]) once('r1', function () { say(ct.radio[1][0], ct.radio[1][1]); });
      if (ct.boss && s.enemies.some(function (e) { return e.etype === 'overlord'; })) once('bossIn', function () { say(ct.boss.speaker, ct.boss.enter, true); });
    } else if (s.wave > ST.last && el > 2.6 && s.wave % 2 === 0) once('ab', function () { pick(ST.pools.afterburn); });
    if (p.alive && p.hp / p.max_hp < 0.3 && el > 1) once('lowHp', function () { pick(ST.pools.lowHp); });
    var q = s.quest, qs = !q ? '' : q.fail ? 'fail' : (q.kind === 'NoHit' ? false : q.progress >= q.target) ? 'done' : '';
    if (qs && qs !== questWas) pick(qs === 'done' ? ST.pools.questDone : ST.pools.questFail);
    questWas = qs;

    if (cur) {
      var was = Math.floor(cur.t * 60);
      cur.t += dt;
      if (app.settings.radio) { // a blip every few letters as the line types out (draw shows t * 60 chars)
        for (var c = was + 1; c <= Math.min(cur.line.length, Math.floor(cur.t * 60)); c++) if (c % 4 === 1) MB.audio.blip(cur.who, cur.line[c - 1]);
      }
      if (cur.t >= cur.dur) { cur = null; if (app.settings.radio) MB.audio.ui('radioOff'); }
    }
    if (!cur && queue.length) { cur = queue.shift(); if (app.settings.radio) MB.audio.ui('radioOn'); }
  }

  function draw(app, g, vw, vh) {
    if (!cur || !app.settings.radio) return;
    var sp = ST.speakers[cur.who] || {}, col = sp.color || UI.C.text;
    var inA = Math.min(1, cur.t / 0.2), outA = Math.min(1, (cur.dur - cur.t) / 0.3), a = Math.max(0, Math.min(inA, outA));
    var w = 660, h = 142, x = 26 - (1 - inA) * 60, y = vh - h - 58;
    g.save(); g.globalAlpha = a;
    UI.panel(x, y, w, h, { r: 18, edge: 6, alpha: 0.94, glow: MB.sprites.rgba(col, 0.45) });
    SC.portrait(g, app, cur.who, x + 66, y + h / 2, 46);
    var label = sp.tag ? cur.who + ' · ' + sp.tag : cur.who;
    UI.text(label, x + 130, y + 26, { size: 22, color: col, outlineW: 5 });
    var shown = cur.line.slice(0, Math.floor(cur.t * 60));
    UI.wrap(shown, w - 150, 23, 'body').slice(0, 3).forEach(function (ln, k) {
      UI.text(ln, x + 130, y + 58 + k * 28, { size: 23, font: 'body', color: UI.C.text, outline: false });
    });
    g.restore();
  }

  MB.radio = { reset: reset, events: events, update: update, draw: draw, say: say, current: function () { return cur; } };
})();
