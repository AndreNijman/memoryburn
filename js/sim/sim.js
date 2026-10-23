/*
 * MemoryBurn - js/sim/sim.js
 *
 * The game rules, ported from the original pygame build (reference/MemoryBurn.py: update_play, Player,
 * Enemy, spawn_enemy, Pickup, Pet, roll_items, apply_item, roll_shop, start_new_run).
 *
 * Built for multiplayer later:
 *   - state is plain JSON-serialisable data (RNG is {s}); items are referenced by ITEM_POOL index
 *   - fixed step (MB.data.STEP), seeded RNG, no DOM / Date / Math.random / wall clock
 *   - every player is a slot in state.players, driven only by an input object per step and by commands
 *   - enemies chase the nearest living player; shops and cash are per player
 *
 *   MB.sim.create({seed, difficulty, players:[{arch}], settings:{gameSpeed, dmgTaken}}) -> state
 *   MB.sim.step(state, inputs)   inputs[slot] = {mx, my, dash, aimX, aimY, fire, manual}
 *   MB.sim.command(state, slot, cmd)   cmd.t: buy|lock|reroll|ready|deploy|debugSkip|debugCash
 *   MB.sim.hash(state) -> uint32
 *
 * state.events is a transient list of {t, ...} for render/audio (hit, block, kill, crit, hurt, shoot,
 * portal, pickup, burst, dash, waveEnd, death). It is cleared at the start of every step and is not hashed.
 *
 * Deliberate differences from the original, each a bug fix:
 *   - a Suicide enemy dies after it bursts (the original set hp=0 but kept it alive, so it re-burst every frame)
 *   - Junk Saint's pickup_add is applied (the original never read it)
 *   - clicking a shop card's lock no longer also buys the card
 *   - a bought card leaves its slot empty (null) until the next wave's shop or a reroll, as in Brotato;
 *     the original refilled it at once, and kept a locked card buyable again and again
 *   - Aegis enemies walk toward the player at 70% speed (the original had no aegis movement, so they never left the edge)
 *   - pets orbit on sim time instead of the wall clock; lifesteal, enemy phase and pickup scatter use the sim RNG
 */
(function () {
  'use strict';
  var D = MB.data, U = MB.util;
  var W = D.VIRTUAL_W, H = D.VIRTUAL_H, TAU = Math.PI * 2;
  var clamp = U.clamp;

  function rngOf(state) { return MB.rng.restore(state.rng); }

  /* ------------------------------------------------------------------ players */
  function makePlayer(slot, archIdx, x, y) {
    var a = D.ARCHETYPES[archIdx];
    var p = {
      slot: slot, arch: archIdx, alive: true,
      x: x, y: y, vx: 0, vy: 0, aimX: x + 1, aimY: y, face: 1,
      speed: 430, max_hp: 110, hp: 110, armor: 0, damage: 14, attack_speed: 1.0, cooldown: 0,
      luck: 0, crit_chance: 0.2, crit_mult: 1.5,
      bullets: 1, bullet_speed: 900, bullet_spread: 0.1, lifesteal: 0.0, pickup_range: 170,
      health_regen: 0.0, iframe: 0.0,
      dash_cd_max: 1.2, dash_cd: 0.0, dashing: false, dash_t: 0.0, dash_time: 0.18, dash_speed: 1200,
      dash_dx: 1, dash_dy: 0, dash_prev: false,
      range_px: a.range_px != null ? a.range_px : 850,
      cash: D.STARTING_CASH, materials: 0,
      pets: [], items: [],
      shop: { items: [], locks: [false, false, false] }, ready: false
    };
    p.damage = Math.trunc(p.damage * (a.dmg_mul || 1.0)) + (a.dmg_add || 0);
    p.max_hp = Math.trunc(p.max_hp * (a.hp_mul || 1.0)) + (a.hp_add || 0); p.hp = p.max_hp;
    p.speed = Math.trunc(p.speed * (a.spd_mul || 1.0)) + (a.spd_add || 0);
    p.attack_speed *= (a.atkspd_mul || 1.0);
    if (a.bullets != null) p.bullets = a.bullets;
    p.bullet_speed += (a.bullet_speed_add || 0);
    if (a.spread != null) p.bullet_spread = a.spread;
    p.lifesteal += (a.lifesteal_add || 0.0);
    p.pickup_range += (a.pickup_add || 0); // fix: original never applied this
    return p;
  }

  function biomeOf(state) { return D.BIOMES[state.biome]; }

  function nearestPlayer(state, x, y) {
    var best = null, bd = Infinity;
    for (var i = 0; i < state.players.length; i++) {
      var p = state.players[i];
      if (!p.alive) continue;
      var d = U.dist2(x, y, p.x, p.y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  function updatePlayer(state, p, inp, dt) {
    var b = biomeOf(state);
    if (p.iframe > 0) p.iframe = Math.max(0.0, p.iframe - dt);
    if (p.health_regen > 0 && p.hp > 0) p.hp = clamp(p.hp + p.health_regen * dt, 0, p.max_hp);
    var dx = inp.mx || 0, dy = inp.my || 0, l = U.len(dx, dy);
    if (l > 0) { dx /= l; dy /= l; }
    var spd_mul = (b.player_spd_mul != null ? b.player_spd_mul : 1.0) * state.jungleSlow;
    var friction = b.friction != null ? b.friction : null;
    var tvx = dx * p.speed * spd_mul, tvy = dy * p.speed * spd_mul;
    var dashKey = !!inp.dash;
    if (p.dash_cd > 0) p.dash_cd = Math.max(0.0, p.dash_cd - dt);
    if (dashKey && !p.dash_prev && p.dash_cd <= 0.0) {
      if (l > 0) { p.dash_dx = dx; p.dash_dy = dy; }
      else {
        var ax = (inp.aimX != null ? inp.aimX : p.x + 1) - p.x, ay = (inp.aimY != null ? inp.aimY : p.y) - p.y, al = U.len(ax, ay);
        if (al > 0) { p.dash_dx = ax / al; p.dash_dy = ay / al; } else { p.dash_dx = 1; p.dash_dy = 0; }
      }
      p.dashing = true; p.dash_t = p.dash_time; p.dash_cd = p.dash_cd_max; p.iframe = Math.max(p.iframe, p.dash_time + 0.3);
      ev(state, { t: 'dash', slot: p.slot, x: p.x, y: p.y, dx: p.dash_dx, dy: p.dash_dy });
    }
    p.dash_prev = dashKey;
    if (p.dashing) {
      p.dash_t -= dt;
      tvx = p.dash_dx * p.dash_speed * spd_mul; tvy = p.dash_dy * p.dash_speed * spd_mul;
      if (p.dash_t <= 0) p.dashing = false;
    }
    if (friction != null) {
      var f = Math.pow(friction, dt * 60);
      p.vx = (p.vx + (tvx - p.vx) * 0.12) * f; p.vy = (p.vy + (tvy - p.vy) * 0.12) * f;
    } else { p.vx = tvx; p.vy = tvy; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.x = clamp(p.x, 18, W - 18); p.y = clamp(p.y, 18, H - 18);
    if (p.cooldown > 0) p.cooldown -= dt * p.attack_speed;
    if (inp.aimX != null) { p.aimX = inp.aimX; p.aimY = inp.aimY; }
  }

  function takeDamage(state, p, amount) {
    if (p.iframe > 0.0) return false;
    var reduced = Math.max(1, Math.trunc(amount * (100 / (100 + p.armor))));
    p.hp -= reduced;
    ev(state, { t: 'hurt', slot: p.slot, x: p.x, y: p.y, dmg: reduced });
    return true;
  }

  /* ------------------------------------------------------------------ firing */
  function addBullet(state, owner, x, y, vx, vy, dmg, life, pierce, color, radius, kind) {
    state.bullets.push({ id: state.nextId++, owner: owner, x: x, y: y, px: x, py: y, vx: vx, vy: vy, dmg: dmg,
      life: life, pierce: pierce || 0, color: color, r: radius, kind: kind });
  }

  function fireOnce(state, rng, p, angle) {
    var a = D.ARCHETYPES[p.arch];
    var name = a.name, mx = Math.cos(angle), my = Math.sin(angle), i, ang, spd;
    if (name === 'Netrunner (Deck)') {
      ang = angle + rng.uniform(-0.02, 0.02); spd = p.bullet_speed + 220;
      ev(state, { t: 'tracer', x0: p.x + mx * 28, y0: p.y + my * 28, x1: p.x + mx * 68, y1: p.y + my * 68 });
      addBullet(state, p.slot, p.x, p.y, Math.cos(ang) * spd, Math.sin(ang) * spd, Math.trunc(p.damage * 1.2), 2.2, 0, '#e6f0ff', 6, 'spike');
    } else if (name === 'Solo (Scattergun)') {
      for (i = 0; i < 6; i++) {
        ang = angle + rng.uniform(-0.22, 0.22); spd = p.bullet_speed * rng.uniform(0.6, 0.9);
        addBullet(state, p.slot, p.x, p.y, Math.cos(ang) * spd, Math.sin(ang) * spd, Math.trunc(p.damage * 0.6), 0.6, 0, '#ffe6a0', 7, 'pellet');
      }
    } else if (name === 'Courier (SMG)') {
      for (i = 0; i < 2; i++) {
        ang = angle + rng.uniform(-0.1, 0.1); spd = p.bullet_speed + 50;
        addBullet(state, p.slot, p.x, p.y, Math.cos(ang) * spd, Math.sin(ang) * spd, Math.trunc(p.damage * 0.7), 1.6, 0, '#c8e6ff', 5, 'smg');
      }
    } else if (name === 'Vamp (Ion Beam)') {
      spd = p.bullet_speed * 0.75;
      addBullet(state, p.slot, p.x, p.y, mx * spd, my * spd, Math.trunc(p.damage * 1.1), 2.5, 2, '#8cdcff', 8, 'ion');
    } else {
      addBullet(state, p.slot, p.x, p.y, mx * p.bullet_speed, my * p.bullet_speed, p.damage, 2.0, 0, a.color || '#f0f0ff', 6, 'shot');
    }
  }

  function firePattern(state, rng, p, tx, ty) {
    var bx = tx - p.x, by = ty - p.y;
    if (bx * bx + by * by < 1e-6) return;
    var base = Math.atan2(by, bx);
    var count = Math.max(1, Math.trunc(p.bullets)), spread = Math.max(0.06, p.bullet_spread);
    for (var i = 0; i < count; i++) fireOnce(state, rng, p, base + (i - (count - 1) / 2.0) * spread);
    ev(state, { t: 'shoot', slot: p.slot, x: p.x, y: p.y, ang: base, arch: p.arch });
  }

  function tryFire(state, rng, p, inp) {
    if (p.cooldown > 0) return;
    var tx, ty;
    if (inp.manual) {
      if (!inp.fire) return;
      tx = inp.aimX != null ? inp.aimX : p.x + 1; ty = inp.aimY != null ? inp.aimY : p.y;
    } else {
      if (state.enemies.length === 0) return;
      var best = null, bd = Infinity;
      for (var i = 0; i < state.enemies.length; i++) {
        var e = state.enemies[i], d = U.dist2(e.x, e.y, p.x, p.y);
        if (d < bd) { bd = d; best = e; }
      }
      if (Math.sqrt(bd) > p.range_px) return;
      tx = best.x; ty = best.y;
    }
    p.aimX = tx; p.aimY = ty;
    firePattern(state, rng, p, tx, ty);
    p.cooldown = D.ARCHETYPES[p.arch].base_cd != null ? D.ARCHETYPES[p.arch].base_cd : 0.5;
  }

  /* ------------------------------------------------------------------ pets */
  function updatePets(state, rng, p, dt) {
    var counts = {};
    p.pets.forEach(function (pet) { counts[pet.kind] = (counts[pet.kind] || 0) + 1; });
    var seen = {};
    for (var i = 0; i < p.pets.length; i++) {
      var pet = p.pets[i], k = seen[pet.kind] = (seen[pet.kind] || 0) + 1;
      var t = state.time;
      var radius = pet.kind === 'turret_buddy' ? 50 : 70;
      var ang = (pet.kind !== 'magnet_drone' ? t * 2.0 : t * 1.5) + (k - 1) * TAU / counts[pet.kind];
      pet.x = p.x + Math.cos(ang) * radius; pet.y = p.y + Math.sin(ang) * radius;
      if (pet.kind === 'turret_buddy') {
        pet.cd -= dt;
        if (pet.cd <= 0) {
          pet.cd = 0.6;
          var a = rng.uniform(0, 360) * Math.PI / 180;
          pet.ang = a;
          addBullet(state, p.slot, pet.x, pet.y, Math.cos(a) * 900, Math.sin(a) * 900, 8, 1.2, 0, '#ffe6b4', 5, 'pet');
        }
      } else if (pet.kind === 'magnet_drone') {
        p.pickup_range += 40 * dt; // original behaviour: grows for as long as the drone is out
      } else if (pet.kind === 'heal_bot') {
        pet.cd -= dt;
        if (pet.cd <= 0) { pet.cd = 2.8; p.hp = Math.min(p.max_hp, p.hp + 2); ev(state, { t: 'heal', slot: p.slot, x: p.x, y: p.y, amt: 2 }); }
      }
    }
  }

  /* ------------------------------------------------------------------ enemies */
  function spawnEnemy(state, rng, wave, kind) {
    if (kind == null) kind = D.ENEMY_KINDS[rng.weighted(D.ENEMY_WEIGHTS)];
    var base = 14 + wave * 2.4 + Math.pow(wave, 1.18) * 0.55 + rng.randint(0, 6);
    var hp = Math.trunc(base * (kind !== 'aegis' ? 1.0 : 1.8));
    var speed = clamp(120 + wave * 6 + Math.pow(wave, 1.06) * 1.0 + rng.randint(-20, 20), 90, 520);
    if (kind === 'sentry') speed = 40;
    if (kind === 'overlord') speed *= 0.7;
    var dmg = 7 + Math.floor(wave / 2) + ((kind === 'brute' || kind === 'suicide' || kind === 'overlord') ? 2 : 0);
    var size = kind !== 'overlord' ? 28 : 64;
    var margin = 40, edge = rng.randint(0, 3), x, y;
    if (edge === 0) { x = margin; y = rng.randint(margin, H - margin); }
    else if (edge === 1) { x = W - margin; y = rng.randint(margin, H - margin); }
    else if (edge === 2) { x = rng.randint(margin, W - margin); y = margin; }
    else { x = rng.randint(margin, W - margin); y = H - margin; }
    var e = { id: state.nextId++, etype: kind, x: x, y: y, size: size, hp: hp, max_hp: hp, speed: speed, dmg: dmg,
      hit_cool: 0, flash_t: 0, shoot_cd: 0, phase: rng.next() * TAU, shield_hp: kind === 'aegis' ? 80 : 0, age: 0, face: 1, dead: false };
    state.enemies.push(e);
    ev(state, { t: 'portal', x: x, y: y, kind: kind });
    return e;
  }

  function dropDead(list) { // in place, order kept
    for (var i = 0, n = 0; i < list.length; i++) if (!list[i].dead) list[n++] = list[i];
    list.length = n;
  }

  function addEnemyBullet(state, x, y, vx, vy, dmg) {
    state.ebullets.push({ id: state.nextId++, x: x, y: y, vx: vx, vy: vy, dmg: dmg, life: 3.5 });
  }

  function updateEnemy(state, rng, e, dt, diffMul) {
    e.age += dt;
    var p = nearestPlayer(state, e.x, e.y);
    var vx = 0, vy = 0, d = 0;
    if (p) { vx = p.x - e.x; vy = p.y - e.y; d = U.len(vx, vy); }
    var nx = d > 1 ? vx / d : 0, ny = d > 1 ? vy / d : 0, i, ang;
    if (nx) e.face = nx < 0 ? -1 : 1;
    var et = e.etype;
    if (et === 'scrap') { e.x += nx * e.speed * dt; e.y += ny * e.speed * dt; }
    else if (et === 'brute') { var m = d < 300 ? 1.8 : 1.0; e.x += nx * e.speed * m * dt; e.y += ny * e.speed * m * dt; e.charging = d < 300; }
    else if (et === 'skater') {
      var px = -ny, py = nx, wob = Math.sin(e.phase) * 0.6; e.phase += dt * 6.0;
      e.x += (nx * 0.9 + px * wob) * e.speed * dt; e.y += (ny * 0.9 + py * wob) * e.speed * dt;
    } else if (et === 'suicide') {
      e.x += nx * (e.speed * 0.75) * dt; e.y += ny * (e.speed * 0.75) * dt;
      if (p && d < 60) {
        for (i = 0; i < 8; i++) { ang = rng.uniform(0, TAU); addEnemyBullet(state, e.x, e.y, Math.cos(ang) * 420, Math.sin(ang) * 420, Math.trunc(e.dmg * 0.8)); }
        e.hp = 0; e.dead = true; // fix: the original kept the enemy alive here
        ev(state, { t: 'explode', x: e.x, y: e.y });
      }
    } else if (et === 'aegis') { // fix: the original had no aegis branch, so shield bots froze on the arena edge
      e.x += nx * (e.speed * 0.7) * dt; e.y += ny * (e.speed * 0.7) * dt;
    } else if (et === 'sentry') {
      e.shoot_cd -= dt;
      if (e.shoot_cd <= 0) {
        e.shoot_cd = 1.6 / diffMul;
        if (d > 0) { addEnemyBullet(state, e.x, e.y, nx * 420, ny * 420, Math.trunc(e.dmg)); ev(state, { t: 'eshoot', x: e.x, y: e.y }); }
      }
    } else if (et === 'overlord') {
      e.shoot_cd -= dt; e.x += nx * (e.speed * 0.8) * dt; e.y += ny * (e.speed * 0.8) * dt;
      if (e.shoot_cd <= 0) {
        e.shoot_cd = 1.0 / diffMul;
        for (i = 0; i < 8; i++) { ang = i * (TAU / 8.0); addEnemyBullet(state, e.x, e.y, Math.cos(ang) * 380, Math.sin(ang) * 380, Math.trunc(e.dmg * 0.9)); }
        ev(state, { t: 'eshoot', x: e.x, y: e.y, big: true });
      }
    }
    if (et === 'aegis' || et === 'sentry') e.aim = Math.atan2(ny, nx);
    if (e.hit_cool > 0) e.hit_cool -= dt;
    if (e.flash_t > 0) e.flash_t -= dt;
  }

  /* ------------------------------------------------------------------ items and shop */
  function rollItems(rng, n, wave, luck) {
    if (n == null) n = 3; if (wave == null) wave = 1; if (luck == null) luck = 0;
    var pool = D.ITEM_POOL.slice();
    var base = { common: 5, uncommon: 3, rare: 2, epic: 1 };
    var bias_cu = Math.max(0, Math.floor(wave / 3)), bias_ur = Math.max(0, Math.floor(wave / 5));
    luck = Math.max(0, Math.trunc(luck));
    var eff = Math.min(luck, 100);
    var m_rare = 1.0 + eff * 0.012, m_epic = 1.0 + eff * 0.018;
    var m_common = Math.max(0.35, 1.0 - eff * 0.007), m_unc = Math.max(0.45, 1.0 - eff * 0.0055);
    var weights = {};
    pool.forEach(function (it) {
      var r = it.rarity, w = base[r];
      if (r === 'common') { w = Math.max(1, w - bias_cu); w = Math.max(1, Math.trunc(w * m_common)); }
      if (r === 'uncommon') { w = Math.max(1, w - bias_ur); w = Math.max(1, Math.trunc(w * m_unc)); }
      if (r === 'rare') { w = w + Math.floor(wave / 7); w = Math.max(1, Math.trunc(w * m_rare)); }
      if (r === 'epic') { w = w + Math.floor(wave / 9); w = Math.max(1, Math.trunc(w * m_epic)); }
      weights[it.name] = w;
    });
    // Original behaviour: shuffle, then a stable sort by weight, so the shop shows the heaviest rarity band.
    rng.shuffle(pool);
    pool.sort(function (a, b) { return weights[b.name] - weights[a.name]; });
    return pool.slice(0, Math.min(n, pool.length)).map(function (it) { return it.idx; });
  }

  function applyItem(p, item) {
    var stat, amt;
    if ('+stat' in item) {
      stat = item['+stat']; amt = item['+amt'];
      if (stat === 'damage') p.damage = Math.trunc(p.damage * (1 + amt / 100.0));
      else if (stat === 'attack_speed') p.attack_speed += amt;
      else if (stat === 'speed') p.speed += amt;
      else if (stat === 'armor') p.armor += Math.trunc(amt);
      else if (stat === 'max_hp') { p.max_hp += Math.trunc(amt); p.hp += Math.trunc(Math.max(0, amt)); }
      else if (stat === 'pickup') p.pickup_range += amt;
      else if (stat === 'lifesteal') p.lifesteal += amt;
      else if (stat === 'bullet_speed') p.bullet_speed += amt;
      else if (stat === 'bullets') p.bullets = clamp(Math.trunc(p.bullets) + Math.trunc(amt), 1, 16);
      else if (stat === 'pet') p.pets.push({ kind: amt, cd: 0, x: p.x, y: p.y, ang: 0 });
      else if (stat === 'luck') p.luck += Math.trunc(amt);
      else if (stat === 'crit_chance') p.crit_chance = Math.max(0.0, Math.min(0.95, p.crit_chance + amt));
      else if (stat === 'crit_mult') p.crit_mult += amt;
      else if (stat === 'health_regen') p.health_regen += amt;
      return;
    }
    (item.mods || []).forEach(function (m) {
      var kind = m.kind || 'flat', pct = 1 + (m.amt || 0) / 100.0;
      stat = m.stat; amt = m.amt || 0;
      if (stat === 'luck') { if (kind === 'percent') p.luck = Math.trunc(p.luck * pct); else p.luck += Math.trunc(amt); }
      else if (stat === 'crit_chance') { if (kind === 'percent') p.crit_chance *= pct; else p.crit_chance += amt; p.crit_chance = Math.max(0.0, Math.min(0.95, p.crit_chance)); }
      else if (stat === 'crit_mult') { if (kind === 'percent') p.crit_mult *= pct; else p.crit_mult += amt; }
      else if (stat === 'damage') { if (kind === 'percent') p.damage = Math.trunc(Math.max(1, p.damage * pct)); else p.damage = Math.max(1, p.damage + Math.trunc(amt)); }
      else if (stat === 'attack_speed') { if (kind === 'percent') p.attack_speed *= pct; else p.attack_speed += amt; }
      else if (stat === 'speed') { if (kind === 'percent') p.speed *= pct; else p.speed += amt; }
      else if (stat === 'armor') { if (kind === 'percent') p.armor = Math.trunc(p.armor * pct); else p.armor += Math.trunc(amt); }
      else if (stat === 'max_hp') {
        if (kind === 'percent') { var delta = Math.trunc(p.max_hp * (amt / 100.0)); p.max_hp += delta; p.hp += Math.max(0, delta); }
        else { p.max_hp += Math.trunc(amt); p.hp += Math.max(0, Math.trunc(amt)); }
      }
      else if (stat === 'pickup') { if (kind === 'percent') p.pickup_range *= pct; else p.pickup_range += amt; }
      else if (stat === 'lifesteal') { if (kind === 'percent') p.lifesteal *= pct; else p.lifesteal += amt; }
      else if (stat === 'bullet_speed') { if (kind === 'percent') p.bullet_speed *= pct; else p.bullet_speed += amt; }
      else if (stat === 'bullets') { if (kind === 'percent') p.bullets = clamp(Math.trunc(p.bullets * pct), 1, 16); else p.bullets = clamp(Math.trunc(p.bullets) + Math.trunc(amt), 1, 16); }
      else if (stat === 'pet') {
        if (typeof amt === 'string') p.pets.push({ kind: amt, cd: 0, x: p.x, y: p.y, ang: 0 });
        else for (var k = 0; k < Math.trunc(amt); k++) p.pets.push({ kind: 'turret_buddy', cd: 0, x: p.x, y: p.y, ang: 0 });
      }
    });
  }

  function rollShop(state, rng, p) {
    var s = p.shop;
    if (!s.items.length || !s.locks.some(Boolean)) {
      s.items = rollItems(rng, 3, state.wave, p.luck); s.locks = [false, false, false]; return;
    }
    var fresh = rollItems(rng, 3); // original: rerolls with locks ignore wave and luck
    for (var i = 0; i < 3; i++) if (!s.locks[i]) s.items[i] = fresh[i];
  }

  /* ------------------------------------------------------------------ run flow */
  // Campaign contracts have a scheduled district; the roll still happens so the RNG stream is the same either way.
  function pickBiome(rng, wave) {
    var roll = rng.choice(D.BIOME_NAMES), c = D.STORY && D.STORY.contracts[wave];
    return c && c.district ? c.district : roll;
  }

  function pickQuest(state, rng) {
    var q = rng.choice(['NoHit', 'Collect', 'Kills']);
    state.quest = { kind: q, label: D.QUESTS[q].label, target: D.QUESTS[q].target, progress: 0, fail: false };
  }

  function difficultyMul(state) {
    var m = D.DIFF_MUL[state.difficulty];
    var b = biomeOf(state);
    if (b.spawn_mul) m *= b.spawn_mul;
    return m;
  }

  function create(opts) {
    opts = opts || {};
    var seed = opts.seed != null ? opts.seed >>> 0 : 1;
    var rng = MB.rng.make(seed);
    var state = {
      v: 1, seed: seed, rng: null, tick: 0, time: 0,
      phase: 'play', difficulty: opts.difficulty || 'Normal',
      settings: { gameSpeed: (opts.settings && opts.settings.gameSpeed) || 1.0, dmgTaken: (opts.settings && opts.settings.dmgTaken) || 1.0 },
      wave: 1, waveTime: D.WAVE_TIME, spawnTimer: 0, baseSpawnRate: 0.72,
      biome: 'Neon Grid', nextBiome: null, quest: null, lastQuest: null,
      wind: { x: 0, y: 0 }, windPhase: 0, pulseT: 0, jungleSlow: 1.0,
      players: [], enemies: [], bullets: [], ebullets: [], pickups: [],
      nextId: 1, kills: 0, events: []
    };
    var specs = opts.players && opts.players.length ? opts.players : [{ arch: 0 }];
    specs.forEach(function (sp, i) {
      var off = specs.length > 1 ? (i - (specs.length - 1) / 2) * 90 : 0;
      state.players.push(makePlayer(i, sp.arch || 0, W / 2 + off, H / 2));
    });
    state.biome = pickBiome(rng, 1);
    pickQuest(state, rng);
    state.rng = { s: rng.s };
    return state;
  }

  function ev(state, e) { state.events.push(e); }

  function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return Math.abs(ax - bx) * 2 < aw + bw && Math.abs(ay - by) * 2 < ah + bh;
  }

  var PLAYER_SIZE = 34;

  function biomeTick(state, dt) {
    var b = biomeOf(state);
    if (b.hp_drain) state.players.forEach(function (p) { if (p.alive) p.hp = Math.max(1, p.hp - b.hp_drain * dt); });
    state.jungleSlow = 1.0;
    if (b.pulse_slow) {
      state.pulseT += dt;
      var t = state.pulseT % 6.0;
      if (t >= 0.0 && t < 1.2) state.jungleSlow = b.pulse_slow;
    }
    if (b.wind) {
      state.windPhase += dt * 0.6;
      state.wind.x = Math.cos(state.windPhase) * 260; state.wind.y = Math.sin(state.windPhase * 0.7) * 140;
    } else { state.wind.x = 0; state.wind.y = 0; }
  }

  function dropLoot(state, rng, e) {
    function drop(kind, amount) {
      state.pickups.push({ id: state.nextId++, kind: kind, amount: amount, x: e.x, y: e.y,
        vx: rng.uniform(-60, 60), vy: rng.uniform(-60, 60), t: 0 });
    }
    if (rng.next() < 0.96) drop('mat', rng.randint(1, 4));
    if (rng.next() < 0.9) drop('xp', 1);
    if (rng.next() < 0.08) drop('heal', rng.randint(4, 8));
  }

  function step(state, inputs) {
    state.events.length = 0;
    if (state.phase !== 'play') return state;
    var rng = rngOf(state);
    var dt = D.STEP * state.settings.gameSpeed;
    var i, j, p, e, b;
    inputs = inputs || [];
    state.tick++; state.time += dt;

    biomeTick(state, dt);
    for (i = 0; i < state.players.length; i++) if (state.players[i].alive) updatePlayer(state, state.players[i], inputs[i] || {}, dt);

    // spawning
    state.spawnTimer -= dt;
    var wave = state.wave;
    var diff = (1.0 + wave * 0.16 + Math.pow(wave, 1.08) * 0.025) * difficultyMul(state);
    if (state.difficulty === 'Normal') {
      if (wave <= 12) diff *= 0.85;
      else if (wave <= 15) diff *= 0.85 + 0.15 * ((wave - 12) / 3.0);
    }
    if (state.spawnTimer <= 0) {
      if (wave % 5 === 0 && !state.enemies.some(function (x) { return x.etype === 'overlord'; })) spawnEnemy(state, rng, wave, 'overlord');
      for (i = 0; i < 1 + Math.trunc(wave / 6); i++) spawnEnemy(state, rng, wave);
      state.spawnTimer = Math.max(0.07, state.baseSpawnRate / diff);
    }

    // firing and pets
    for (i = 0; i < state.players.length; i++) {
      p = state.players[i];
      if (!p.alive) continue;
      tryFire(state, rng, p, inputs[i] || {});
      updatePets(state, rng, p, dt);
    }

    // bullets
    var bmul = biomeOf(state).bullet_spd_mul != null ? biomeOf(state).bullet_spd_mul : 1.0;
    var wx = state.wind.x, wy = state.wind.y, decay = Math.pow(bmul, dt);
    for (i = state.bullets.length - 1; i >= 0; i--) {
      b = state.bullets[i];
      b.vx *= decay; b.vy *= decay;
      if (wx || wy) { b.vx += wx * dt * 1.6; b.vy += wy * dt * 1.6; }
      b.px = b.x; b.py = b.y;
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (b.life <= 0 || b.x < -60 || b.x > W + 60 || b.y < -60 || b.y > H + 60) state.bullets.splice(i, 1);
    }
    for (i = state.ebullets.length - 1; i >= 0; i--) {
      b = state.ebullets[i];
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (b.life <= 0) state.ebullets.splice(i, 1);
    }

    // enemies and pickups
    var dmul = difficultyMul(state);
    for (i = 0; i < state.enemies.length; i++) updateEnemy(state, rng, state.enemies[i], dt, dmul);
    dropDead(state.enemies);
    var pmul = biomeOf(state).pickup_mul != null ? biomeOf(state).pickup_mul : 1.0;
    for (i = 0; i < state.pickups.length; i++) {
      var pk = state.pickups[i];
      pk.t += dt;
      var k = 1 - Math.min(1, dt * 2); pk.vx *= k; pk.vy *= k;
      p = nearestPlayer(state, pk.x, pk.y);
      if (p) {
        var tx = p.x - pk.x, ty = p.y - pk.y, td = U.len(tx, ty);
        if (td < p.pickup_range * pmul) {
          if (td > 1) { tx /= td; ty /= td; }
          pk.vx += tx * 700 * dt; pk.vy += ty * 700 * dt;
        }
      }
      pk.x += pk.vx * dt; pk.y += pk.vy * dt;
    }

    var dmgTaken = state.settings.dmgTaken;

    // bullet hits (enemies are AABBs of `size`, bullets AABBs of 2r, as in pygame's rect collision)
    var anyHit = false;
    for (i = state.bullets.length - 1; i >= 0; i--) {
      b = state.bullets[i];
      var hit = false;
      for (j = 0; j < state.enemies.length; j++) {
        e = state.enemies[j];
        if (e.dead || !rectsOverlap(b.x, b.y, b.r * 2, b.r * 2, e.x, e.y, e.size, e.size)) continue;
        hit = true;
        if (e.etype === 'aegis' && e.shield_hp > 0) {
          e.shield_hp -= b.dmg;
          ev(state, { t: 'block', x: b.x, y: b.y, id: e.id });
          continue;
        }
        var owner = state.players[b.owner] || state.players[0];
        var dmg = Math.trunc(b.dmg), crit = false;
        if (rng.next() < owner.crit_chance) { dmg = Math.trunc(dmg * owner.crit_mult); crit = true; }
        e.hp -= dmg; e.flash_t = 0.08;
        if (owner.lifesteal > 0 && rng.next() < owner.lifesteal) owner.hp = clamp(owner.hp + 1, 0, owner.max_hp);
        ev(state, { t: 'hit', x: b.x, y: b.y, dmg: dmg, crit: crit, id: e.id, slot: owner.slot });
        if (e.hp <= 0) {
          e.dead = true;
          ev(state, { t: 'kill', x: e.x, y: e.y, kind: e.etype, elite: e.etype === 'aegis' || e.etype === 'overlord', id: e.id });
          dropLoot(state, rng, e);
          state.kills++;
          if (state.quest && state.quest.kind === 'Kills') state.quest.progress += 1;
        }
      }
      if (hit) { anyHit = true; if (b.pierce > 0) b.pierce -= 1; else state.bullets.splice(i, 1); }
    }
    if (anyHit) dropDead(state.enemies); // dead enemies are skipped above, so one sweep matches filtering per hit

    // contact damage
    for (j = 0; j < state.enemies.length; j++) {
      e = state.enemies[j];
      if (e.hit_cool > 0) continue;
      for (i = 0; i < state.players.length; i++) {
        p = state.players[i];
        if (!p.alive || !rectsOverlap(e.x, e.y, e.size, e.size, p.x, p.y, PLAYER_SIZE, PLAYER_SIZE)) continue;
        if (takeDamage(state, p, Math.trunc(e.dmg * dmul * dmgTaken)) && state.quest && state.quest.kind === 'NoHit') state.quest.fail = true;
        e.hit_cool = 0.6;
        break;
      }
    }
    // enemy bullets: hit when the 10px bullet box contains the player's centre
    for (i = state.ebullets.length - 1; i >= 0; i--) {
      b = state.ebullets[i];
      for (j = 0; j < state.players.length; j++) {
        p = state.players[j];
        if (!p.alive || Math.abs(b.x - p.x) > 5 || Math.abs(b.y - p.y) > 5) continue;
        if (takeDamage(state, p, Math.trunc(b.dmg * dmul * dmgTaken)) && state.quest && state.quest.kind === 'NoHit') state.quest.fail = true;
        state.ebullets.splice(i, 1);
        break;
      }
    }
    // pickups
    for (i = state.pickups.length - 1; i >= 0; i--) {
      var q = state.pickups[i], sz = q.kind === 'mat' ? 12 : 16;
      for (j = 0; j < state.players.length; j++) {
        p = state.players[j];
        if (!p.alive || !rectsOverlap(q.x, q.y, sz, sz, p.x, p.y, PLAYER_SIZE, PLAYER_SIZE)) continue;
        if (q.kind === 'mat') { p.materials += q.amount; if (state.quest && state.quest.kind === 'Collect') state.quest.progress += q.amount; }
        else if (q.kind === 'heal') p.hp = Math.min(p.max_hp, p.hp + q.amount);
        ev(state, { t: 'pickup', kind: q.kind, x: q.x, y: q.y, amount: q.amount, slot: p.slot });
        state.pickups.splice(i, 1);
        break;
      }
    }

    if (state.quest && state.quest.kind === 'NoHit' && !state.quest.fail) state.quest.progress += dt;

    // death
    state.players.forEach(function (pl) {
      if (pl.alive && pl.hp <= 0) { pl.alive = false; ev(state, { t: 'death', slot: pl.slot, x: pl.x, y: pl.y }); }
    });

    state.waveTime -= dt;
    if (state.players.every(function (pl) { return !pl.alive; })) {
      state.phase = 'gameover';
    } else if (state.waveTime <= 0) {
      endWave(state, rng);
    }
    state.rng.s = rng.s;
    return state;
  }

  function endWave(state, rng) {
    state.enemies = []; state.bullets = []; state.ebullets = []; state.pickups = [];
    var q = state.quest, done = false;
    if (q) done = q.kind === 'NoHit' ? (!q.fail && q.progress >= q.target) : q.progress >= q.target;
    var reward = done ? 35 + Math.trunc(state.wave * 3) : 0;
    state.lastQuest = q ? { label: q.label, done: done, reward: reward } : null;
    state.players.forEach(function (p) {
      if (!p.alive) { p.alive = true; p.hp = Math.max(1, Math.trunc(p.max_hp * 0.3)); } // co-op: downed players return for the shop
      p.cash += p.materials + reward; p.lastHaul = p.materials; p.materials = 0; p.ready = false;
      rollShop(state, rng, p);
    });
    state.phase = 'shop';
    state.nextBiome = pickBiome(rng, state.wave + 1);
    ev(state, { t: 'waveEnd', wave: state.wave, questDone: done, reward: reward });
  }

  function allReady(state) { return state.players.every(function (p) { return p.ready; }); }

  function command(state, slot, cmd) {
    var p = state.players[slot];
    if (!p || !cmd) return false;
    var rng = rngOf(state), ok = false;
    state.events.length = 0;
    if (cmd.t === 'debugCash') { p.cash += 100; return true; }
    if (state.phase === 'shop') {
      var s = p.shop, i = cmd.i;
      if (cmd.t === 'lock' && i >= 0 && i < 3 && s.items[i] != null) { s.locks[i] = !s.locks[i]; ok = true; }
      else if (cmd.t === 'buy' && i >= 0 && i < s.items.length && s.items[i] != null) {
        var item = D.ITEM_POOL[s.items[i]];
        if (p.cash >= item.cost) {
          p.cash -= item.cost;
          applyItem(p, item); p.items.push(item.idx);
          p.hp = clamp(p.hp + 6, 0, p.max_hp);
          s.items[i] = null; s.locks[i] = false; // sold out until the next shop roll
          ev(state, { t: 'buy', slot: slot, item: item.idx });
          ok = true;
        }
      } else if (cmd.t === 'reroll') {
        if (p.cash >= 5) { p.cash -= 5; rollShop(state, rng, p); ok = true; ev(state, { t: 'reroll', slot: slot }); }
      } else if (cmd.t === 'ready') {
        p.ready = true; ok = true;
        if (allReady(state)) { state.phase = 'preview'; state.players.forEach(function (q) { q.ready = false; }); }
      }
    } else if (state.phase === 'preview' && cmd.t === 'deploy') {
      p.ready = true; ok = true;
      if (allReady(state)) startNextWave(state, rng);
    } else if (state.phase === 'play' && cmd.t === 'debugSkip') { state.waveTime = 0; ok = true; }
    state.rng.s = rng.s;
    return ok;
  }

  function startNextWave(state, rng) {
    state.wave += 1;
    state.waveTime = D.WAVE_TIME + Math.min(15, state.wave * 0.6);
    state.biome = state.nextBiome || pickBiome(rng, state.wave); state.nextBiome = null;
    pickQuest(state, rng);
    state.spawnTimer = 0; state.pulseT = 0;
    state.players.forEach(function (p) { p.ready = false; p.x = clamp(p.x, 18, W - 18); p.vx = 0; p.vy = 0; p.dashing = false; });
    state.phase = 'play';
  }

  // Original preview text (preview_text), with readable enemy names in place of its letter codes.
  function previewLines(state) {
    var next = state.wave + 1, biome = state.nextBiome || state.biome;
    var kinds = D.ENEMY_KINDS.slice(), weights = D.ENEMY_WEIGHTS.slice();
    if (next % 5 === 0) { kinds.push('overlord'); weights.push(1); }
    var top = kinds.map(function (k, i) { return [k, weights[i]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 3);
    return {
      title: 'Contract ' + next + ': Sitrep',
      district: biome, notes: D.BIOMES[biome].notes, boss: next % 5 === 0,
      hostiles: top.map(function (t) { return t[0]; }),
      side: 'Side-job next: random objective for bonus eddies.'
    };
  }

  function hash(state) {
    var h = 2166136261 >>> 0;
    function mix(n) { h ^= (Math.round(n * 1000) | 0); h = Math.imul(h, 16777619) >>> 0; }
    mix(state.tick); mix(state.wave); mix(state.rng.s); mix(state.waveTime);
    state.players.forEach(function (p) { mix(p.x); mix(p.y); mix(p.hp); mix(p.cash); mix(p.materials); mix(p.damage); });
    state.enemies.forEach(function (e) { mix(e.id); mix(e.x); mix(e.y); mix(e.hp); });
    state.bullets.forEach(function (b) { mix(b.x); mix(b.y); });
    state.ebullets.forEach(function (b) { mix(b.x); mix(b.y); });
    state.pickups.forEach(function (q) { mix(q.x); mix(q.y); });
    return h >>> 0;
  }

  MB.sim = {
    create: create, step: step, command: command, hash: hash,
    previewLines: previewLines, rollItems: rollItems, applyItem: applyItem, difficultyMul: difficultyMul,
    PLAYER_SIZE: PLAYER_SIZE
  };
})();
