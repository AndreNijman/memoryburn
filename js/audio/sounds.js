/*
 * MemoryBurn - js/audio/sounds.js
 *
 * The sound bank: every effect and drum hit as a js/audio/dsp.js recipe. Nothing here plays anything;
 * the engine renders each entry into a few variants on first use and picks one per play.
 *
 *   MB.sounds.list[id] = {bus, vol, pri, gap, vars, verb, make(r, j) -> {layers, post}}
 *     bus   'sfx' | 'ui' | 'voice' | 'music'      vol   playback gain (buffers are normalised)
 *     pri   0-3, who wins when voices run out     gap   seconds before the same id may play again
 *     vars  rendered variants                     verb  reverb send
 *     make  r is a seeded RNG for the variant, j a small pitch multiplier around 1
 *   MB.sounds.drum(kit, name) -> {layers, post}   MB.sounds.KITS   MB.sounds.voice[speaker]
 */
(function () {
  'use strict';
  var list = {};
  function def(id, o, make) { o.make = make; o.vars = o.vars || 3; list[id] = o; }
  function bell(f, t, d, g, ratio, idx) { return { w: 'sine', f: f, t: t || 0, d: d, g: g, fm: ratio || 3.5, fmi: idx || 2, fmi1: 0, p: 3 }; }
  function thump(f, f1, d, g, t) { return { w: 'sine', f: f, f1: f1, fd: d * 0.25, d: d, g: g, t: t || 0 }; }
  function click(g, hp, t) { return { w: 'noise', d: 0.012, g: g, hp: hp || 3000, t: t || 0 }; }

  /* ------------------------------------------------------------------ guns, one per archetype */
  def('gun0', { bus: 'sfx', vol: 0.3, pri: 1, gap: 0.045 }, function (r, j) { // Netrunner: data spikes
    return { layers: [
      { w: 'sq', f: 2300 * j, f1: 640 * j, fc: 0.6, d: 0.09, g: 0.45, pw: 0.3, lp: 7000, lp1: 1800 },
      { w: 'sine', f: 4600 * j, f1: 3000, d: 0.035, g: 0.18 },
      { w: 'noise', d: 0.025, g: 0.35, hp: 4500 },
      thump(150, 60, 0.06, 0.5)
    ], post: { srd: 2 } };
  });
  def('gun1', { bus: 'sfx', vol: 0.42, pri: 1, gap: 0.08, verb: 0.12 }, function (r, j) { // Solo: scattergun
    return { layers: [
      { w: 'noise', d: 0.3, g: 1, lp: 5200 * j, lp1: 260, p: 3, drive: 2.2 },
      thump(170 * j, 42, 0.2, 1, 0),
      { w: 'noise', d: 0.018, g: 0.7, hp: 2600 },
      { w: 'brown', d: 0.25, g: 0.5, lp: 400, p: 2 },
      { w: 'metal', f: 260, t: 0.12, d: 0.05, g: 0.05, hp: 4000 } // pump rack
    ], post: { echo: [0.065, 0.22] } };
  });
  def('gun2', { bus: 'sfx', vol: 0.24, pri: 1, gap: 0.04 }, function (r, j) { // Courier: SMG
    return { layers: [
      { w: 'noise', d: 0.05, g: 0.75, bp: 2400 * j, bp1: 1200, q: 1.3 },
      { w: 'sq', f: 760 * j, f1: 240, d: 0.04, g: 0.3, lp: 3200 },
      thump(190, 70, 0.045, 0.6),
      click(0.3, 6000)
    ] };
  });
  def('gun3', { bus: 'sfx', vol: 0.3, pri: 1, gap: 0.06, verb: 0.1 }, function (r, j) { // Vamp: ion beam
    return { layers: [
      { w: 'saw', f: 330 * j, f1: 290 * j, d: 0.17, g: 0.5, det: 18, lp: 2600, lp1: 800, q: 4, vib: [38, 0.6] },
      { w: 'sine', f: 980 * j, f1: 1300, d: 0.13, g: 0.28, fm: 1.5, fmi: 3, fmi1: 0 },
      { w: 'noise', d: 0.06, g: 0.22, bp: 5200, q: 2 },
      thump(120, 55, 0.07, 0.4)
    ] };
  });
  def('gun4', { bus: 'sfx', vol: 0.3, pri: 1, gap: 0.06, verb: 0.15 }, function (r, j) { // Techno Monk: struck chime
    return { layers: [
      bell(880 * j, 0, 0.22, 0.45, 3.5, 2.6),
      bell(1320 * j, 0.004, 0.16, 0.18, 1.4, 1.2),
      thump(230, 85, 0.1, 0.75),
      { w: 'noise', d: 0.025, g: 0.3, hp: 3200 }
    ] };
  });
  def('gun5', { bus: 'sfx', vol: 0.26, pri: 1, gap: 0.045 }, function (r, j) { // Riot Runner: snappy pistol
    return { layers: [
      { w: 'noise', d: 0.075, g: 0.8, bp: 3400 * j, bp1: 1400, q: 0.9 },
      { w: 'tri', f: 1250 * j, f1: 380, d: 0.05, g: 0.4 },
      thump(210, 62, 0.06, 0.6),
      click(0.35)
    ] };
  });
  def('gun6', { bus: 'sfx', vol: 0.4, pri: 2, gap: 0.12, verb: 0.3 }, function (r, j) { // Steel Witch: hex railgun
    return { layers: [
      { w: 'saw', f: 110 * j, f1: 52, d: 0.48, g: 0.55, det: 22, lp: 3400, lp1: 180, q: 3, drive: 2 },
      { w: 'sine', f: 1900 * j, f1: 280, fc: 0.4, d: 0.32, g: 0.4, fm: 2.01, fmi: 4, fmi1: 0.2 },
      { w: 'noise', d: 0.36, g: 0.38, bp: 2000, bp1: 380, q: 3 },
      thump(76, 34, 0.42, 0.8)
    ], post: { echo: [0.11, 0.25] } };
  });
  def('gun7', { bus: 'sfx', vol: 0.3, pri: 1, gap: 0.055 }, function (r, j) { // Junk Saint: nail gun
    return { layers: [
      { w: 'metal', f: 430 * j, d: 0.09, g: 0.5, hp: 1300, p: 3 },
      { w: 'noise', d: 0.06, g: 0.6, lp: 2800 },
      { w: 'sq', f: 250 * j, f1: 88, d: 0.07, g: 0.38, lp: 1900 },
      thump(140, 60, 0.06, 0.5)
    ], post: { srd: 3 } };
  });

  /* ------------------------------------------------------------------ impacts */
  def('hit', { bus: 'sfx', vol: 0.22, pri: 0, gap: 0.03, vars: 4 }, function (r, j) {
    return { layers: [
      { w: 'noise', d: 0.06, g: 0.7, bp: 1500 * j, bp1: 620, q: 1.4 },
      { w: 'sine', f: 360 * j, f1: 120, d: 0.07, g: 0.6 },
      click(0.2, 5000)
    ] };
  });
  def('crit', { bus: 'sfx', vol: 0.32, pri: 1, gap: 0.05 }, function (r, j) {
    return { layers: [
      { w: 'noise', d: 0.07, g: 0.8, bp: 1800 * j, bp1: 700, q: 1.4, drive: 1.5 },
      { w: 'sine', f: 420 * j, f1: 130, d: 0.08, g: 0.7 },
      bell(2500 * j, 0.004, 0.26, 0.4, 2.76, 2.2),
      { w: 'sq', f: 1700 * j, f1: 3400, d: 0.05, g: 0.12, lp: 6000 }
    ] };
  });
  def('block', { bus: 'sfx', vol: 0.28, pri: 0, gap: 0.06 }, function (r, j) {
    return { layers: [
      { w: 'metal', f: 620 * j, d: 0.2, g: 0.55, hp: 1600, p: 3 },
      bell(1750 * j, 0, 0.24, 0.32, 1.41, 5),
      click(0.4)
    ] };
  });

  /* ------------------------------------------------------------------ kills, per enemy */
  def('kill_scrap', { bus: 'sfx', vol: 0.32, pri: 1, gap: 0.035, vars: 4 }, function (r, j) {
    return { layers: [
      { w: 'sine', f: 720 * j, f1: 85, fc: 0.5, d: 0.17, g: 0.8 },
      { w: 'noise', d: 0.13, g: 0.5, lp: 2600, lp1: 280 },
      { w: 'sq', f: 190 * j, f1: 60, d: 0.1, g: 0.22, lp: 900 }
    ], post: { srd: 2 } };
  });
  def('kill_brute', { bus: 'sfx', vol: 0.45, pri: 2, gap: 0.05 }, function (r, j) {
    return { layers: [
      thump(155 * j, 36, 0.42, 1),
      { w: 'noise', d: 0.32, g: 0.7, lp: 1500, lp1: 140, drive: 3 },
      { w: 'metal', f: 240 * j, d: 0.14, g: 0.16, hp: 900 },
      { w: 'brown', d: 0.4, g: 0.5, lp: 300 }
    ] };
  });
  def('kill_skater', { bus: 'sfx', vol: 0.32, pri: 1, gap: 0.04 }, function (r, j) {
    return { layers: [
      { w: 'saw', f: 1550 * j, f1: 240, fc: 0.6, d: 0.15, g: 0.42, lp: 5200, lp1: 900, q: 5 },
      { w: 'noise', d: 0.08, g: 0.4, hp: 2200 },
      { w: 'sine', f: 520 * j, f1: 120, d: 0.1, g: 0.5 }
    ] };
  });
  def('kill_suicide', { bus: 'sfx', vol: 0.25, pri: 1, gap: 0.04 }, function (r, j) {
    return { layers: [{ w: 'sine', f: 920 * j, f1: 200, d: 0.06, g: 0.6 }, { w: 'noise', d: 0.05, g: 0.5, hp: 1500 }] };
  });
  def('kill_aegis', { bus: 'sfx', vol: 0.4, pri: 2, gap: 0.06, verb: 0.3 }, function (r, j) { // shield shatter
    var L = [{ w: 'noise', d: 0.55, g: 0.6, hp: 3600, p: 3 }, thump(210, 60, 0.22, 0.6)];
    for (var k = 0; k < 5; k++) L.push(bell(r.uniform(2600, 6200) * j, r.uniform(0, 0.12), 0.32, 0.18, 1.37, 1.5));
    return { layers: L };
  });
  def('kill_sentry', { bus: 'sfx', vol: 0.36, pri: 2, gap: 0.05 }, function (r, j) { // power-down
    return { layers: [
      { w: 'sq', f: 920 * j, f1: 48, fc: 0.7, d: 0.52, g: 0.34, lp: 3200, lp1: 260, pw: 0.25 },
      { w: 'noise', d: 0.18, g: 0.4, bp: 1300, q: 2 },
      thump(125, 40, 0.3, 0.6)
    ], post: { srd: 4 } };
  });
  def('elite', { bus: 'sfx', vol: 0.3, pri: 1, gap: 0.08, vars: 1, verb: 0.3 }, function () {
    return { layers: [{ w: 'sine', f: 1568, d: 0.14, g: 0.4, fm: 2, fmi: 1.5, fmi1: 0, rep: [4, 0.05, 1.26] }] };
  });

  /* ------------------------------------------------------------------ enemies and arena */
  def('explode', { bus: 'sfx', vol: 0.5, pri: 2, gap: 0.06, verb: 0.3 }, function (r, j) {
    return { layers: [
      { w: 'noise', d: 0.95, g: 1, lp: 3200 * j, lp1: 110, p: 2.5, drive: 2.5 },
      thump(115 * j, 28, 0.8, 1),
      { w: 'brown', d: 1.1, g: 0.6, lp: 520, p: 1.6 },
      click(0.6)
    ] };
  });
  def('portal', { bus: 'sfx', vol: 0.13, pri: 0, gap: 0.09, verb: 0.4 }, function (r, j) {
    return { layers: [
      { w: 'sine', f: 250 * j, f1: 1150 * j, fc: 1.6, d: 0.46, a: 0.26, g: 0.5, vib: [11, 0.5], p: 1.5 },
      { w: 'noise', d: 0.46, a: 0.3, g: 0.3, bp: 600, bp1: 3600, q: 4 }
    ] };
  });
  def('portalBoss', { bus: 'sfx', vol: 0.55, pri: 3, gap: 1, vars: 1, verb: 0.5 }, function () {
    return { layers: [
      { w: 'saw', f: 40, f1: 82, d: 1.45, a: 1.05, g: 0.42, det: 16, lp: 300, lp1: 1600, q: 6, drive: 2 },
      { w: 'noise', d: 1.45, a: 1.1, g: 0.3, bp: 200, bp1: 2600, q: 5 },
      thump(62, 28, 0.7, 1, 1.15)
    ] };
  });
  def('eshoot', { bus: 'sfx', vol: 0.16, pri: 0, gap: 0.05, vars: 4 }, function (r, j) {
    return { layers: [
      { w: 'sq', f: 1350 * j, f1: 420, fc: 0.5, d: 0.1, g: 0.45, lp: 4200, pw: 0.4 },
      { w: 'sine', f: 620 * j, f1: 200, d: 0.08, g: 0.3 }
    ] };
  });
  def('eshootBig', { bus: 'sfx', vol: 0.3, pri: 1, gap: 0.1 }, function (r, j) {
    return { layers: [
      { w: 'saw', f: 540 * j, f1: 105, d: 0.3, g: 0.6, lp: 2600, lp1: 300, q: 6, drive: 1.5 },
      { w: 'noise', d: 0.2, g: 0.4, bp: 900, q: 1.5 },
      thump(92, 38, 0.26, 0.7)
    ] };
  });
  def('riser', { bus: 'music', vol: 0.32, pri: 2, gap: 2, vars: 1 }, function () { // the last seconds of a contract
    return { layers: [
      { w: 'noise', d: 4.2, a: 4.0, p: 6, g: 0.5, bp: 260, bp1: 7000, q: 3, lc: 1.4 },
      { w: 'saw', f: 110, f1: 880, fc: 2.2, d: 4.2, a: 3.8, p: 6, g: 0.18, det: 25, lp: 600, lp1: 5000 }
    ] };
  });
  def('drip', { bus: 'sfx', vol: 0.08, pri: 0, gap: 0.05, vars: 6, verb: 0.5 }, function (r) { // Rain Alley drops
    var f = r.uniform(900, 2400);
    return { layers: [{ w: 'sine', f: f, f1: f * 1.9, fc: 0.4, d: 0.05, g: 0.6, p: 2 }] };
  });
  def('siren', { bus: 'sfx', vol: 0.05, pri: 0, gap: 8, vars: 2, verb: 0.8 }, function (r) { // Midnight District, far off
    var f = r.uniform(600, 760);
    return { layers: [{ w: 'tri', f: f, d: 3.2, a: 0.8, h: 1, g: 0.6, vib: [0.9, 3.2], lp: 1400 }] };
  });
  def('spark', { bus: 'sfx', vol: 0.06, pri: 0, gap: 0.08, vars: 4 }, function (r) { // Reactor Core arcing
    return { layers: [{ w: 'noise', d: 0.05, g: 0.8, hp: 3000, trem: [r.uniform(90, 180), 1] }, { w: 'sq', f: r.uniform(90, 140), d: 0.05, g: 0.2, lp: 800 }], post: { srd: 3 } };
  });

  /* ------------------------------------------------------------------ the player */
  def('hurt', { bus: 'sfx', vol: 0.5, pri: 3, gap: 0.12 }, function (r, j) {
    return { layers: [
      { w: 'noise', d: 0.23, g: 0.9, lp: 3600, lp1: 480, drive: 4 },
      { w: 'sq', f: 250 * j, f1: 88, d: 0.2, g: 0.5, lp: 1500, drive: 2 },
      thump(115, 48, 0.2, 0.7)
    ], post: { srd: 3, bits: 7 } };
  });
  def('death', { bus: 'sfx', vol: 0.7, pri: 3, gap: 1, vars: 1, verb: 0.5 }, function (r) {
    var L = [
      { w: 'saw', f: 440, f1: 28, fc: 0.6, d: 1.5, g: 0.55, det: 20, lp: 3200, lp1: 90, q: 5, drive: 2 },
      { w: 'noise', d: 1.7, g: 0.55, lp: 2200, lp1: 70, p: 1.5 },
      thump(84, 24, 1.5, 0.9)
    ];
    for (var k = 0; k < 6; k++) L.push({ w: 'sq', f: r.uniform(200, 900), t: 0.04 + k * 0.07, d: 0.04, g: 0.22, lp: 3000 });
    return { layers: L, post: { srd: 2 } };
  });
  def('dash', { bus: 'sfx', vol: 0.32, pri: 1, gap: 0.1 }, function (r, j) {
    return { layers: [
      { w: 'noise', d: 0.25, a: 0.03, g: 0.8, bp: 520 * j, bp1: 3400 * j, q: 2.5 },
      { w: 'sine', f: 210, f1: 520, d: 0.15, a: 0.02, g: 0.18 }
    ] };
  });
  def('heal', { bus: 'sfx', vol: 0.26, pri: 1, gap: 0.5, verb: 0.35 }, function (r, j) {
    return { layers: [
      { w: 'sine', f: 880 * j, d: 0.26, g: 0.5, fm: 2, fmi: 0.8, fmi1: 0, rep: [3, 0.06, 1.26] },
      { w: 'tri', f: 1760 * j, t: 0.12, d: 0.32, g: 0.18 }
    ] };
  });
  def('heart', { bus: 'sfx', vol: 0.5, pri: 2, gap: 0.3, vars: 1 }, function () { // low-HP heartbeat
    return { layers: [
      { w: 'sine', f: 64, f1: 44, d: 0.14, g: 1, lp: 260 },
      { w: 'sine', f: 56, f1: 40, t: 0.18, d: 0.17, g: 0.72, lp: 220 }
    ] };
  });
  def('pickup_mat', { bus: 'sfx', vol: 0.2, pri: 0, gap: 0.03, vars: 1 }, function () { // two-step coin
    return { layers: [
      { w: 'sq', f: 1318.5, d: 0.05, g: 0.4, pw: 0.25, lp: 6000 },
      { w: 'sq', f: 1760, t: 0.045, d: 0.12, g: 0.4, pw: 0.25, lp: 6000, p: 2.5 }
    ] };
  });
  def('pickup_xp', { bus: 'sfx', vol: 0.15, pri: 0, gap: 0.03, vars: 1 }, function () {
    return { layers: [{ w: 'sine', f: 900, f1: 1500, d: 0.07, g: 0.6 }, { w: 'tri', f: 1800, f1: 2600, d: 0.05, g: 0.2 }] };
  });
  def('pickup_heal', { bus: 'sfx', vol: 0.3, pri: 1, gap: 0.08, vars: 1, verb: 0.2 }, function () {
    return { layers: [{ w: 'sine', f: 660, d: 0.1, g: 0.5 }, { w: 'sine', f: 990, t: 0.07, d: 0.2, g: 0.5, fm: 2, fmi: 0.6, fmi1: 0 }] };
  });

  /* ------------------------------------------------------------------ contract flow */
  def('waveStart', { bus: 'sfx', vol: 0.45, pri: 3, gap: 1, vars: 1, verb: 0.45 }, function () {
    return { layers: [
      { w: 'noise', d: 0.9, a: 0.82, p: 4, g: 0.35, bp: 300, bp1: 5200, q: 3 },
      { w: 'saw', f: 220, t: 0.82, d: 1, g: 0.22, det: 16, lp: 4200, lp1: 500 },
      { w: 'saw', f: 277.2, t: 0.82, d: 1, g: 0.2, det: 16, lp: 4200, lp1: 500 },
      { w: 'saw', f: 329.6, t: 0.82, d: 1, g: 0.2, det: 16, lp: 4200, lp1: 500 },
      thump(120, 38, 0.55, 1, 0.82),
      { w: 'noise', t: 0.82, d: 0.6, g: 0.35, hp: 2400, p: 3 }
    ] };
  });
  def('waveClear', { bus: 'sfx', vol: 0.42, pri: 3, gap: 1, vars: 1, verb: 0.5 }, function () {
    var L = [], notes = [880, 1108.7, 1318.5, 1760];
    notes.forEach(function (f, k) { L.push(bell(f, k * 0.07, 0.9, 0.35, 3.5, 2)); });
    [440, 554.4, 659.3].forEach(function (f) { L.push({ w: 'saw', f: f, t: 0.21, d: 1.2, a: 0.05, g: 0.1, det: 14, lp: 3000, lp1: 700 }); });
    L.push(thump(110, 50, 0.4, 0.6, 0.21));
    return { layers: L };
  });
  def('questDone', { bus: 'sfx', vol: 0.4, pri: 2, gap: 1, vars: 1, verb: 0.3 }, function () {
    return { layers: [bell(1568, 0, 0.3, 0.4), bell(2093, 0.1, 0.5, 0.4), { w: 'sq', f: 1318.5, t: 0.2, d: 0.05, g: 0.2, pw: 0.25 }, { w: 'sq', f: 1760, t: 0.25, d: 0.15, g: 0.2, pw: 0.25 }] };
  });
  def('questFail', { bus: 'sfx', vol: 0.36, pri: 2, gap: 1, vars: 1 }, function () {
    return { layers: [
      { w: 'sq', f: 330, d: 0.18, g: 0.35, lp: 1500 },
      { w: 'sq', f: 247, t: 0.18, d: 0.38, g: 0.35, lp: 1200, vib: [6, 0.3] }
    ] };
  });
  def('tick', { bus: 'sfx', vol: 0.3, pri: 2, gap: 0.4, vars: 1 }, function () {
    return { layers: [bell(1000, 0, 0.09, 0.6, 1.5, 1), { w: 'noise', d: 0.01, g: 0.3, bp: 4000 }] };
  });
  def('tickLast', { bus: 'sfx', vol: 0.36, pri: 2, gap: 0.4, vars: 1 }, function () {
    return { layers: [bell(1500, 0, 0.16, 0.6, 1.5, 1.4), bell(750, 0, 0.16, 0.3, 1.5, 1), { w: 'noise', d: 0.01, g: 0.3, bp: 4000 }] };
  });
  def('bossEnter', { bus: 'sfx', vol: 0.62, pri: 3, gap: 2, vars: 1, verb: 0.6 }, function () { // the horn
    var L = [55, 82.4, 110].map(function (f) {
      return { w: 'saw', f: f, d: 2.6, a: 0.05, h: 0.7, p: 1.5, g: 0.42, det: 14, lp: 200, lp1: 2300, lc: 0.5, q: 2, drive: 2.5 };
    });
    L.push({ w: 'sine', f: 55, d: 2.4, g: 0.6, h: 0.8 }, { w: 'noise', d: 2, g: 0.22, bp: 420, bp1: 120, q: 1 });
    return { layers: L };
  });
  def('bossDown', { bus: 'sfx', vol: 0.7, pri: 3, gap: 2, vars: 1, verb: 0.6 }, function () {
    return { layers: [
      { w: 'noise', d: 2, g: 1, lp: 4200, lp1: 80, p: 2, drive: 2.5 },
      thump(100, 22, 1.8, 1),
      { w: 'brown', d: 2.2, g: 0.6, lp: 400, p: 1.4 },
      bell(880, 0.3, 2, 0.28, 2.76, 3), bell(1318.5, 0.45, 2, 0.26, 2.76, 3), bell(1760, 0.6, 2, 0.24, 2.76, 3)
    ] };
  });

  /* ------------------------------------------------------------------ shop and menus */
  def('buy', { bus: 'ui', vol: 0.42, pri: 2, gap: 0.05, vars: 2, verb: 0.2 }, function (r, j) {
    return { layers: [click(0.5, 2000), bell(2093 * j, 0.02, 0.25, 0.4, 3, 2.5), bell(2637 * j, 0.08, 0.36, 0.4, 3, 2.5), thump(125, 58, 0.1, 0.5)] };
  });
  def('reroll', { bus: 'ui', vol: 0.36, pri: 2, gap: 0.1, vars: 2 }, function (r, j) {
    return { layers: [
      { w: 'metal', f: 500 * j, d: 0.025, g: 0.4, hp: 1500, rep: [7, 0.035, 1.07] },
      { w: 'sine', f: 880 * j, f1: 1320, t: 0.26, d: 0.12, g: 0.3 }
    ] };
  });
  def('lock', { bus: 'ui', vol: 0.36, pri: 2, gap: 0.05, vars: 1 }, function () {
    return { layers: [{ w: 'noise', d: 0.02, g: 0.6, bp: 3000, q: 2 }, { w: 'sq', f: 320, d: 0.05, g: 0.3, lp: 2000 }, { w: 'metal', f: 700, t: 0.03, d: 0.06, g: 0.3, hp: 2000 }] };
  });
  def('unlock', { bus: 'ui', vol: 0.32, pri: 2, gap: 0.05, vars: 1 }, function () {
    return { layers: [{ w: 'noise', d: 0.02, g: 0.6, bp: 4000, q: 2 }, { w: 'sq', f: 480, d: 0.04, g: 0.3, lp: 2400 }, { w: 'metal', f: 900, t: 0.025, d: 0.05, g: 0.25, hp: 2500 }] };
  });
  def('deny', { bus: 'ui', vol: 0.3, pri: 2, gap: 0.2, vars: 1 }, function () {
    return { layers: [{ w: 'sq', f: 150, d: 0.09, g: 0.4, lp: 1200, rep: [2, 0.11, 1] }] };
  });
  def('uiHover', { bus: 'ui', vol: 0.1, pri: 0, gap: 0.04, vars: 3 }, function (r, j) {
    return { layers: [{ w: 'sine', f: 2200 * j, d: 0.025, g: 0.6, p: 3 }, { w: 'noise', d: 0.008, g: 0.2, hp: 5000 }] };
  });
  def('uiClick', { bus: 'ui', vol: 0.32, pri: 1, gap: 0.05, vars: 2 }, function (r, j) {
    return { layers: [{ w: 'sq', f: 880 * j, f1: 1320 * j, d: 0.04, g: 0.3, lp: 4000, pw: 0.3 }, { w: 'sine', f: 1760 * j, t: 0.03, d: 0.08, g: 0.4 }, click(0.4)] };
  });
  def('uiBack', { bus: 'ui', vol: 0.28, pri: 1, gap: 0.05, vars: 1 }, function () {
    return { layers: [{ w: 'sq', f: 880, f1: 520, d: 0.06, g: 0.3, lp: 3000 }, { w: 'sine', f: 660, t: 0.04, d: 0.08, g: 0.35 }] };
  });
  def('toggleOn', { bus: 'ui', vol: 0.26, pri: 1, gap: 0.05, vars: 1 }, function () {
    return { layers: [{ w: 'sine', f: 700, f1: 1400, d: 0.06, g: 0.5 }, click(0.3, 4000)] };
  });
  def('toggleOff', { bus: 'ui', vol: 0.26, pri: 1, gap: 0.05, vars: 1 }, function () {
    return { layers: [{ w: 'sine', f: 1100, f1: 550, d: 0.06, g: 0.5 }, click(0.3, 4000)] };
  });
  def('uiTick', { bus: 'ui', vol: 0.12, pri: 0, gap: 0.03, vars: 1 }, function () {
    return { layers: [{ w: 'sine', f: 1500, d: 0.02, g: 0.5 }] };
  });
  def('pageTurn', { bus: 'ui', vol: 0.22, pri: 1, gap: 0.1, vars: 2 }, function (r, j) {
    return { layers: [{ w: 'noise', d: 0.13, a: 0.02, g: 0.6, bp: 1400 * j, bp1: 4200, q: 1 }, { w: 'sine', f: 420 * j, f1: 640, d: 0.06, g: 0.15 }] };
  });
  def('plug', { bus: 'ui', vol: 0.5, pri: 3, gap: 1, vars: 1, verb: 0.7 }, function () { // the shard goes in
    var L = [{ w: 'noise', d: 1.8, a: 1.4, p: 3, g: 0.3, bp: 400, bp1: 6000, q: 2 }];
    [440, 554.4, 659.3, 880, 1108.7].forEach(function (f, k) { L.push(bell(f, 1.3 + k * 0.08, 1.8, 0.24, 2, 1.6)); });
    L.push(thump(90, 40, 0.6, 0.6, 1.3));
    return { layers: L };
  });
  def('smash', { bus: 'ui', vol: 0.55, pri: 3, gap: 1, vars: 1, verb: 0.5 }, function (r) { // the shard breaks
    var L = [{ w: 'noise', d: 0.8, g: 0.8, hp: 3000, p: 3 }, thump(110, 30, 0.9, 1), { w: 'noise', d: 0.5, g: 0.5, lp: 1200, lp1: 100, drive: 3 }];
    for (var k = 0; k < 8; k++) L.push(bell(r.uniform(2400, 7000), r.uniform(0.01, 0.25), 0.5, 0.16, 1.37, 1.5));
    return { layers: L };
  });

  /* ------------------------------------------------------------------ radio and dialogue */
  def('radioOn', { bus: 'voice', vol: 0.18, pri: 2, gap: 0.3, vars: 2 }, function (r) {
    return { layers: [
      { w: 'noise', d: 0.19, g: 0.8, bp: r.uniform(1500, 2200), q: 1.5, p: 1 },
      { w: 'sq', f: 1200, d: 0.02, g: 0.3 }, { w: 'sq', f: 820, t: 0.17, d: 0.02, g: 0.25 }
    ], post: { srd: 3, bits: 6 } };
  });
  def('radioOff', { bus: 'voice', vol: 0.14, pri: 2, gap: 0.3, vars: 1 }, function () {
    return { layers: [{ w: 'noise', d: 0.06, g: 0.6, bp: 2000, q: 2 }, { w: 'sq', f: 600, d: 0.02, g: 0.3 }], post: { srd: 3 } };
  });
  // Speech blips: each speaker gets a timbre and a pitch, and variants step through a scale so a line
  // sounds like talking rather than a buzzer.
  var STEPS = [1, 9 / 8, 5 / 4, 4 / 3, 3 / 2, 5 / 3];
  function blip(id, mk) {
    def(id, { bus: 'voice', vol: 0.16, pri: 0, gap: 0.035, vars: 6 }, function (r, j, v) { return { layers: mk(220 * STEPS[v % 6]) }; });
  }
  blip('blipSq', function (f) { return [{ w: 'sq', f: f, f1: f * 0.94, d: 0.05, g: 0.5, pw: 0.35, lp: 1900, p: 1.5 }]; });
  blip('blipSaw', function (f) { return [{ w: 'saw', f: f, f1: f * 0.9, d: 0.055, g: 0.5, bp: 1100, q: 2.5, p: 1.5 }]; });
  blip('blipFm', function (f) { return [{ w: 'sine', f: f * 2, d: 0.06, g: 0.5, fm: 1, fmi: 1.4, fmi1: 0.3, p: 1.4 }]; });
  blip('blipTri', function (f) { return [{ w: 'tri', f: f * 1.5, f1: f * 1.55, d: 0.06, g: 0.55, p: 1.3 }]; });
  var voice = {
    DOC: { snd: 'blipSq', rate: 1.05 }, LUCKY: { snd: 'blipSaw', rate: 0.82 }, LETHE: { snd: 'blipFm', rate: 1.18 },
    REN: { snd: 'blipTri', rate: 1.3 }, NINE: { snd: 'blipSq', rate: 0.74 }, FRAGMENT: { snd: 'blipTri', rate: 0.9, verb: 0.6 },
    APPRAISER: { snd: 'blipSaw', rate: 0.6 }, AUCTIONEER: { snd: 'blipSaw', rate: 0.68 }, ARCHIVIST: { snd: 'blipFm', rate: 0.62 }
  };

  /* ------------------------------------------------------------------ drum kits for the music */
  // A kit overrides the base drum parameters. post applies to every drum in the kit.
  var KITS = {
    neon: {},
    rain: { snare: { tone: 230, d: 0.17, hp: 1400 }, hat: { d: 0.035 } },
    dust: { kick: { f0: 140, d: 0.5, drive: 3.5 }, snare: { tone: 170, d: 0.28, drive: 2.5 }, post: { srd: 3 } },
    vine: { kick: { f0: 120, d: 0.32, click: 0.1 }, snare: { tone: 260, d: 0.1 }, hat: { d: 0.03, f: 260 } },
    jet: { kick: { f0: 170, f1: 48, d: 0.38, drive: 1.6, click: 0.45 }, ohat: { d: 0.22 } },
    core: { kick: { f0: 200, f1: 44, d: 0.34, drive: 4.5, click: 0.5 }, snare: { tone: 160, d: 0.2, drive: 3 }, perc: { f: 520 } },
    mid: { snare: { tone: 180, d: 0.42, h: 0.16, p: 7, hp: 700 }, kick: { d: 0.5 } }, // gated-reverb snare
    lofi: { kick: { f0: 110, d: 0.36, click: 0.05 }, snare: { tone: 200, d: 0.18, lp: 5000 }, hat: { d: 0.04, lp: 7000 }, post: { srd: 4, bits: 8 } },
    boss: { kick: { f0: 180, f1: 38, d: 0.55, drive: 2.8, click: 0.5 }, snare: { tone: 190, d: 0.3, drive: 2 } },
    soft: { kick: { f0: 90, f1: 40, d: 0.5, click: 0 }, snare: { tone: 220, d: 0.12, lp: 3500 }, hat: { d: 0.03, lp: 6000 } }
  };
  var DRUMS = {
    kick: function (k) {
      var body = thump(k.f0 || 160, k.f1 || 45, k.d || 0.42, 1);
      body.fd = 0.035; body.p = 1.6; if (k.drive) body.drive = k.drive;
      return [body, click(k.click == null ? 0.3 : k.click, 2500)];
    },
    snare: function (k) {
      return [{ w: 'tri', f: k.tone || 190, f1: (k.tone || 190) * 0.75, d: 0.12, g: 0.6, drive: k.drive || 0 },
        { w: 'noise', d: k.d || 0.22, h: k.h || 0, g: 0.85, hp: k.hp || 900, lp: k.lp || 9000, p: k.p || 2.5, drive: k.drive || 0 }];
    },
    clap: function () { return [{ w: 'noise', d: 0.012, g: 0.8, bp: 1200, q: 1.5, rep: [3, 0.011, 1] }, { w: 'noise', t: 0.033, d: 0.2, g: 0.8, bp: 1100, q: 1.2, p: 3 }]; },
    hat: function (k) { return [{ w: 'metal', f: k.f || 205, d: k.d || 0.05, g: 1, hp: 7000, lp: k.lp || 16000, p: 3 }]; },
    ohat: function (k) { return [{ w: 'metal', f: k.f || 205, d: k.d || 0.32, g: 1, hp: 6500, lp: k.lp || 16000, p: 1.6 }]; },
    rim: function () { return [{ w: 'tri', f: 1700, d: 0.03, g: 0.6 }, { w: 'noise', d: 0.02, g: 0.5, bp: 3000, q: 2 }]; },
    tom: function () { return [thump(190, 105, 0.3, 1), { w: 'noise', d: 0.05, g: 0.2, lp: 2000 }]; },
    shaker: function () { return [{ w: 'noise', d: 0.07, a: 0.018, g: 1, hp: 5200, p: 2 }]; },
    crash: function () { return [{ w: 'metal', f: 310, d: 1.7, g: 0.7, hp: 4000, p: 1.6 }, { w: 'noise', d: 1.5, g: 0.5, hp: 6000, p: 1.8 }]; },
    perc: function (k) { return [{ w: 'metal', f: k.f || 400, d: 0.12, g: 0.8, bp: 1900, q: 3, drive: 2 }, thump(300, 200, 0.06, 0.3)]; },
    wood: function () { return [bell(880, 0, 0.06, 0.8, 1.48, 0.8), click(0.2, 2500)]; },
    zap: function () { return [{ w: 'sq', f: 2000, f1: 200, fc: 0.5, d: 0.08, g: 0.5, lp: 5000 }]; }
  };
  function drum(kit, name) {
    var K = KITS[kit] || {}, k = K[name] || {};
    return { layers: DRUMS[name](k), post: K.post };
  }

  MB.sounds = { list: list, voice: voice, KITS: KITS, DRUMS: DRUMS, drum: drum };
})();
