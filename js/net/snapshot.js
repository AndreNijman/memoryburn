/*
 * MemoryBurn - js/net/snapshot.js   (env: any, so the headless tests can run it)
 *
 * The co-op wire format. The host runs the only sim; guests draw a "mirror": an object shaped like sim state
 * (MB.sim.create output) whose fields are overwritten from snapshots, so the renderer, HUD and every screen work
 * on a guest without knowing it. Pure data in, pure data out: no DOM, timers, Date or Math.random.
 *
 *   MB.snap.encode(state, events) -> {t:'snap', ...}   host, 20 Hz: run fields + rows of rounded ints
 *   MB.snap.decode(msg) -> frame                         guest: rows back into entity objects ({k, ents, run, events})
 *   MB.snap.applyFrame(mirror, frame)                    guest: make the mirror show this frame
 *   MB.snap.sheet(player) -> object                      host: the whole player minus pet positions (shop, stats, items)
 *   MB.snap.applySheet(mirror, slot, sheet)              guest
 *   MB.snap.newMirror(meta) -> state                     guest: a fresh mirror for the run in start metadata
 *   MB.snap.trimEvent(e) -> event                        host: a sim event with its numbers rounded for the wire
 *   MB.snap.chunk(str, size) / join(parts)               full-state backup chunks (host migration)
 *   MB.dataHash() -> string                              content fingerprint; host and guests must match
 *
 * Row layouts (all ints):
 *   P player  [slot, x, y, vx, vy, aimX, aimY, hp*10, max_hp, flags, dashDx*100, dashDy*100, iframe*100, cooldown*100,
 *              dashCd*100, materials, cash]            flags: 1 alive, 2 dashing, 4 ready
 *   T pet     [slot, kind, x, y, ang*100]
 *   E enemy   [id, kind, x, y, hp, max_hp, shield, flags, age*100 (capped at 30), aim*100]   flags: 1 face left, 2 flash, 4 charging
 *   B bullet  [id, x, y, vx/4, vy/4, kind, owner]
 *   Q enemy bullet [id, x, y]
 *   K pickup  [id, kind, x, y]
 */
(function () {
  'use strict';
  var D = MB.data;
  var PHASES = ['play', 'shop', 'preview', 'gameover'];
  var ENEMY = D.ENEMY_KINDS.concat(['overlord']);
  var PICKUP = ['mat', 'xp', 'heal'];
  var PETS = ['turret_buddy', 'magnet_drone', 'heal_bot'];
  // bullet kind -> [radius, colour]; 'shot' takes its colour from the owner's archetype, as in sim.fireOnce
  var BULLET = ['shot', 'spike', 'pellet', 'smg', 'ion', 'pet'];
  var BULLET_STYLE = { spike: [6, '#e6f0ff'], pellet: [7, '#ffe6a0'], smg: [5, '#c8e6ff'], ion: [8, '#8cdcff'], pet: [5, '#ffe6b4'], shot: [6, null] };
  var BIOMES = D.BIOME_NAMES;
  var MAX_E = 240, MAX_B = 520, HIT_CAP = 40, EV_CAP = 120;

  function r(v) { v = Math.round(+v); return v === v ? v : 0; }
  function idx(list, v) { var i = list.indexOf(v); return i < 0 ? 0 : i; }

  /* ------------------------------------------------------------------ host */
  function trimEvent(e) {
    var o = {}, k, v;
    for (k in e) {
      v = e[k];
      if (typeof v === 'number') o[k] = (k === 'ang' || k === 'dx' || k === 'dy') ? Math.round(v * 100) / 100 : r(v);
      else o[k] = v;
    }
    return o;
  }

  function encode(s, events) {
    var i, p, e, b, rows;
    var m = {
      t: 'snap', k: s.tick, tm: Math.round(s.time * 1000), ph: idx(PHASES, s.phase), wv: s.wave, wt: r(s.waveTime * 100),
      bi: idx(BIOMES, s.biome), nb: s.nextBiome ? idx(BIOMES, s.nextBiome) : -1, ki: s.kills, js: r(s.jungleSlow * 100),
      wd: [r(s.wind.x), r(s.wind.y)], q: s.quest, lq: s.lastQuest, gs: s.settings.gameSpeed, dt: s.settings.dmgTaken
    };
    rows = []; var pets = [];
    for (i = 0; i < s.players.length; i++) {
      p = s.players[i];
      rows.push([p.slot, r(p.x), r(p.y), r(p.vx), r(p.vy), r(p.aimX), r(p.aimY), r(p.hp * 10), r(p.max_hp),
        (p.alive ? 1 : 0) | (p.dashing ? 2 : 0) | (p.ready ? 4 : 0), r(p.dash_dx * 100), r(p.dash_dy * 100),
        r(p.iframe * 100), r(p.cooldown * 100), r(p.dash_cd * 100), p.materials, p.cash]);
      for (var j = 0; j < p.pets.length; j++) {
        var pt = p.pets[j];
        pets.push([p.slot, idx(PETS, pt.kind), r(pt.x), r(pt.y), r((pt.ang || 0) * 100)]);
      }
    }
    m.P = rows; m.T = pets;

    var list = s.enemies;
    if (list.length > MAX_E) { // keep the ones nearest the crew, and every overlord
      var cx = 0, cy = 0, n = 0;
      s.players.forEach(function (pl) { if (pl.alive) { cx += pl.x; cy += pl.y; n++; } });
      if (n) { cx /= n; cy /= n; }
      list = list.slice().sort(function (a, c) {
        var ab = a.etype === 'overlord' ? -1e12 : 0, cb = c.etype === 'overlord' ? -1e12 : 0;
        return ab + (a.x - cx) * (a.x - cx) + (a.y - cy) * (a.y - cy) - cb - (c.x - cx) * (c.x - cx) - (c.y - cy) * (c.y - cy);
      }).slice(0, MAX_E);
    }
    rows = [];
    for (i = 0; i < list.length; i++) {
      e = list[i];
      if (e.dead) continue;
      var row = [e.id, idx(ENEMY, e.etype), r(e.x), r(e.y), r(e.hp), r(e.max_hp), r(e.shield_hp),
        (e.face < 0 ? 1 : 0) | (e.flash_t > 0 ? 2 : 0) | (e.charging ? 4 : 0), Math.min(30, r(e.age * 100))];
      if (e.aim != null) row.push(r(e.aim * 100));
      rows.push(row);
    }
    m.E = rows;
    rows = [];
    for (i = s.bullets.length - 1; i >= 0 && rows.length < MAX_B; i--) { // newest first, so a cap drops the oldest
      b = s.bullets[i];
      rows.push([b.id, r(b.x), r(b.y), r(b.vx / 4), r(b.vy / 4), idx(BULLET, b.kind), b.owner]);
    }
    m.B = rows;
    rows = [];
    for (i = 0; i < s.ebullets.length; i++) { b = s.ebullets[i]; rows.push([b.id, r(b.x), r(b.y)]); }
    m.Q = rows;
    rows = [];
    for (i = 0; i < s.pickups.length; i++) { b = s.pickups[i]; rows.push([b.id, idx(PICKUP, b.kind), r(b.x), r(b.y)]); }
    m.K = rows;

    // events: hits are capped (a scattergun crowd makes hundreds); everything else goes through
    var out = [], hits = 0;
    for (i = 0; i < (events || []).length; i++) {
      if (events[i].t === 'hit' && ++hits > HIT_CAP) continue;
      out.push(events[i]);
    }
    if (out.length > EV_CAP) out = out.slice(out.length - EV_CAP);
    m.ev = out;
    return m;
  }

  // Everything about a player that the shop, stats panel and HUD read. Pets keep their kind and cooldown only;
  // their positions ride the snapshot.
  function sheet(p) {
    var o = {}, k;
    for (k in p) if (k !== 'pets') o[k] = p[k];
    o.pets = p.pets.map(function (pt) { return { kind: pt.kind, cd: 0, x: 0, y: 0, ang: 0 }; });
    return JSON.parse(JSON.stringify(o));
  }

  /* ------------------------------------------------------------------ guest */
  function decode(m) {
    var f = { k: m.k | 0, run: m, P: m.P || [], T: m.T || [], events: Array.isArray(m.ev) ? m.ev : [] };
    var i, row, list;
    list = [];
    for (i = 0; i < (m.E || []).length; i++) {
      row = m.E[i];
      var kind = ENEMY[row[1]] || 'scrap';
      var e = { id: row[0], etype: kind, x: row[2], y: row[3], size: kind === 'overlord' ? 64 : 28, hp: row[4], max_hp: row[5] || 1,
        shield_hp: row[6], face: row[7] & 1 ? -1 : 1, flash_t: row[7] & 2 ? 0.08 : 0, charging: !!(row[7] & 4), age: row[8] / 100, dead: false };
      if (row.length > 9) e.aim = row[9] / 100;
      list.push(e);
    }
    f.enemies = list;
    list = [];
    for (i = 0; i < (m.B || []).length; i++) {
      row = m.B[i];
      var bk = BULLET[row[5]] || 'shot', st = BULLET_STYLE[bk];
      list.push({ id: row[0], x: row[1], y: row[2], px: row[1], py: row[2], vx: row[3] * 4, vy: row[4] * 4, kind: bk, r: st[0], color: st[1], owner: row[6] | 0 });
    }
    list.reverse();
    f.bullets = list;
    f.ebullets = (m.Q || []).map(function (q) { return { id: q[0], x: q[1], y: q[2] }; });
    f.pickups = (m.K || []).map(function (q) { return { id: q[0], kind: PICKUP[q[1]] || 'mat', x: q[2], y: q[3] }; });
    return f;
  }

  function playerBySlot(s, slot) {
    for (var i = 0; i < s.players.length; i++) if (s.players[i].slot === slot) return s.players[i];
    return null;
  }

  function applyFrame(s, f) {
    var m = f.run, i, row, p;
    s.tick = f.k; s.time = (m.tm | 0) / 1000; s.phase = PHASES[m.ph] || 'play'; s.wave = m.wv | 0;
    s.waveTime = (m.wt | 0) / 100; s.biome = BIOMES[m.bi] || BIOMES[0]; s.nextBiome = m.nb >= 0 ? BIOMES[m.nb] : null;
    s.kills = m.ki | 0; s.jungleSlow = (m.js | 0) / 100; s.wind.x = m.wd ? m.wd[0] : 0; s.wind.y = m.wd ? m.wd[1] : 0;
    s.quest = m.q || null; s.lastQuest = m.lq || null;
    if (m.gs) s.settings.gameSpeed = m.gs;
    if (m.dt) s.settings.dmgTaken = m.dt;
    for (i = 0; i < f.P.length; i++) {
      row = f.P[i]; p = playerBySlot(s, row[0]);
      if (!p) continue;
      p.x = row[1]; p.y = row[2]; p.vx = row[3]; p.vy = row[4]; p.aimX = row[5]; p.aimY = row[6];
      p.hp = row[7] / 10; p.max_hp = row[8]; p.alive = !!(row[9] & 1); p.dashing = !!(row[9] & 2); p.ready = !!(row[9] & 4);
      p.dash_dx = row[10] / 100; p.dash_dy = row[11] / 100; p.iframe = row[12] / 100; p.cooldown = row[13] / 100;
      p.dash_cd = row[14] / 100; p.materials = row[15]; p.cash = row[16];
    }
    var seen = {};
    for (i = 0; i < f.T.length; i++) {
      row = f.T[i]; p = playerBySlot(s, row[0]);
      if (!p) continue;
      var k = seen[row[0]] = (seen[row[0]] || 0), pet = p.pets[k];
      if (!pet) pet = p.pets[k] = { kind: PETS[row[1]], cd: 0 };
      pet.kind = PETS[row[1]] || pet.kind; pet.x = row[2]; pet.y = row[3]; pet.ang = row[4] / 100;
      seen[row[0]]++;
    }
    s.players.forEach(function (pl) { if (pl.pets.length > (seen[pl.slot] || 0)) pl.pets.length = seen[pl.slot] || 0; });
    // 'shot' bullets take the owner's archetype colour
    for (i = 0; i < f.bullets.length; i++) {
      var b = f.bullets[i];
      if (b.color == null) { var o = playerBySlot(s, b.owner); b.color = (o && D.ARCHETYPES[o.arch].color) || '#f0f0ff'; }
    }
    s.enemies = f.enemies; s.bullets = f.bullets; s.ebullets = f.ebullets; s.pickups = f.pickups;
  }

  function applySheet(s, slot, sh) {
    var p = playerBySlot(s, slot);
    if (!p || !sh || typeof sh !== 'object') return;
    var pets = p.pets, k;
    for (k in sh) if (k !== 'pets' && k !== 'slot') p[k] = sh[k];
    if (Array.isArray(sh.pets)) { // keep positions already known from snapshots
      p.pets = sh.pets.map(function (pt, i) { var old = pets[i]; return { kind: pt.kind, cd: 0, x: old ? old.x : p.x, y: old ? old.y : p.y, ang: old ? old.ang : 0 }; });
    }
  }

  // meta: {seed, difficulty, players:[{arch}], settings}
  function newMirror(meta) {
    var s = MB.sim.create({ seed: meta.seed, difficulty: meta.difficulty, players: meta.players, settings: meta.settings });
    s.remote = true;
    return s;
  }

  function chunk(str, size) {
    size = size || 48000;
    var out = [];
    for (var i = 0; i < str.length; i += size) out.push(str.slice(i, i + size));
    return out.length ? out : [''];
  }

  var hashCache = null;
  MB.dataHash = function () {
    if (hashCache) return hashCache;
    var str = JSON.stringify([MB.VERSION, D.ITEM_POOL, D.ARCHETYPES, D.ENEMY_KINDS, D.BIOME_NAMES, D.WAVE_TIME]), h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return (hashCache = h.toString(36));
  };

  MB.snap = {
    PHASES: PHASES, encode: encode, decode: decode, applyFrame: applyFrame, sheet: sheet, applySheet: applySheet,
    newMirror: newMirror, trimEvent: trimEvent, chunk: chunk, join: function (parts) { return parts.join(''); },
    playerBySlot: playerBySlot
  };
})();
