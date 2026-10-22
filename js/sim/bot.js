/*
 * MemoryBurn - js/sim/bot.js
 *
 * A simple autopilot used by the headless tests and the title-screen attract mode.
 *   MB.bot.input(state, slot) -> input object for MB.sim.step
 *   MB.bot.shop(state, slot)  -> list of commands to send during the shop phase (buys, then ready)
 * Pure function of state: deterministic, so bot runs are reproducible.
 */
(function () {
  'use strict';
  var D = MB.data, U = MB.util;
  var W = D.VIRTUAL_W, H = D.VIRTUAL_H;

  function input(state, slot) {
    var p = state.players[slot];
    if (!p || !p.alive) return {};
    var fx = 0, fy = 0, close = 0;
    state.enemies.forEach(function (e) { // repulsion from enemies, stronger when near
      var dx = p.x - e.x, dy = p.y - e.y, d2 = Math.max(400, dx * dx + dy * dy), w = (e.etype === 'overlord' ? 3 : 1) * 40000 / d2;
      fx += dx / Math.sqrt(d2) * w; fy += dy / Math.sqrt(d2) * w;
      if (d2 < 140 * 140) close++;
    });
    state.ebullets.forEach(function (b) {
      var dx = p.x - b.x, dy = p.y - b.y, d2 = Math.max(100, dx * dx + dy * dy);
      if (d2 < 220 * 220) { fx += dx / Math.sqrt(d2) * 30000 / d2; fy += dy / Math.sqrt(d2) * 30000 / d2; }
    });
    var best = null, bd = Infinity; // drift toward the nearest pickup
    state.pickups.forEach(function (q) { var d = U.dist2(p.x, p.y, q.x, q.y); if (d < bd) { bd = d; best = q; } });
    if (best) { var d = Math.sqrt(bd) || 1; fx += (best.x - p.x) / d * 0.6; fy += (best.y - p.y) / d * 0.6; }
    fx += (W / 2 - p.x) / W * 1.2; fy += (H / 2 - p.y) / H * 1.2; // stay off the walls
    return { mx: fx, my: fy, dash: close >= 2 && (state.tick % 30 === 0), aimX: p.aimX, aimY: p.aimY };
  }

  var PREF = { damage: 5, attack_speed: 5, bullets: 6, max_hp: 4, armor: 3, health_regen: 3, lifesteal: 3, pet: 4, speed: 2, crit_chance: 3, crit_mult: 2 };
  function score(item) {
    var s = item['+stat'] || (item.mods && item.mods[0].stat);
    return (PREF[s] || 1) * 100 - item.cost;
  }

  function shop(state, slot) {
    var p = state.players[slot], cmds = [], cash = p.cash;
    var order = p.shop.items.map(function (idx, i) { return { i: i, item: D.ITEM_POOL[idx] }; })
      .sort(function (a, b) { return score(b.item) - score(a.item); });
    order.forEach(function (o) { if (cash >= o.item.cost) { cmds.push({ t: 'buy', i: o.i }); cash -= o.item.cost; } });
    cmds.push({ t: 'ready' });
    return cmds;
  }

  MB.bot = { input: input, shop: shop };
})();
