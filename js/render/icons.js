/*
 * MemoryBurn - js/render/icons.js
 *
 * Shop/stat icons (sprite keys icon:<stat>), drawn as little objects in the same outlined style.
 * Registered into MB.sprites; 64x64 logical, centred.
 */
(function () {
  'use strict';
  var S = MB.sprites, P = S.palette, OUT = P.OUT, TAU = Math.PI * 2;
  var body = S.prim.body, flat = S.prim.flat, circ = S.prim.circ, ell = S.prim.ell, rrect = S.prim.rrect, poly = S.prim.poly;
  var LW = 3.6;

  function reg(stat, fn) { S.register('icon:' + stat, 64, 64, fn); }

  reg('damage', function (g) { // cartridge
    g.rotate(-0.6);
    body(g, rrect(-9, -6, 18, 26, 3), '#d9a441', LW, { bb: 16 });
    flat(g, rrect(-10, 16, 20, 6, 2), '#b07d2a', 3);
    body(g, function (q) { q.moveTo(-9, -6); q.quadraticCurveTo(-9, -24, 0, -27); q.quadraticCurveTo(9, -24, 9, -6); q.closePath(); }, P.red, LW, { bb: 14 });
  });
  reg('attack_speed', function (g) {
    body(g, poly([4, -26, -14, 4, -1, 4, -6, 26, 14, -6, 1, -6]), P.yellow, LW, { bb: 20, lo: P.yellowLo });
  });
  reg('speed', function (g) { // winged boot
    flat(g, function (q) { q.moveTo(-6, -10); q.quadraticCurveTo(-24, -22, -26, -6); q.quadraticCurveTo(-18, -8, -8, -2); q.closePath(); }, '#ffffff', 3);
    body(g, function (q) { q.moveTo(-8, -18); q.lineTo(6, -18); q.lineTo(6, 4); q.lineTo(20, 8); q.quadraticCurveTo(24, 18, 16, 18); q.lineTo(-10, 18); q.closePath(); }, P.blue, LW, { bb: 18, lo: P.blueLo });
    flat(g, rrect(-12, 15, 34, 6, 3), P.dark, 3);
  });
  reg('armor', function (g) {
    body(g, function (q) { q.moveTo(0, -24); q.lineTo(20, -16); q.quadraticCurveTo(20, 12, 0, 24); q.quadraticCurveTo(-20, 12, -20, -16); q.closePath(); }, P.steel, LW, { bb: 22, lo: P.steelLo });
    flat(g, function (q) { q.moveTo(0, -16); q.lineTo(12, -11); q.quadraticCurveTo(12, 8, 0, 15); q.closePath(); }, 'rgba(255,255,255,0.35)');
  });
  reg('max_hp', function (g) {
    body(g, function (q) { q.moveTo(0, 20); q.bezierCurveTo(-30, 0, -18, -26, 0, -12); q.bezierCurveTo(18, -26, 30, 0, 0, 20); q.closePath(); }, P.red, LW, { bb: 20, lo: P.redLo });
  });
  reg('pickup', function (g) { // magnet
    g.beginPath(); g.arc(0, -2, 14, Math.PI, 0); g.lineTo(14, 16); g.moveTo(-14, -2); g.lineTo(-14, 16);
    g.lineWidth = 15; g.strokeStyle = OUT; g.stroke(); g.lineWidth = 9; g.strokeStyle = P.red; g.stroke();
    flat(g, rrect(-19, 10, 10, 9, 1), '#f3f3f3', 3); flat(g, rrect(9, 10, 10, 9, 1), '#f3f3f3', 3);
  });
  reg('lifesteal', function (g) {
    body(g, function (q) { q.moveTo(0, -24); q.quadraticCurveTo(18, 0, 16, 10); q.quadraticCurveTo(12, 24, 0, 24); q.quadraticCurveTo(-12, 24, -16, 10); q.quadraticCurveTo(-18, 0, 0, -24); q.closePath(); }, '#d93a5a', LW, { bb: 20 });
    flat(g, poly([-7, 2, -4, 12, -1, 2]), '#ffffff', 2); flat(g, poly([1, 2, 4, 12, 7, 2]), '#ffffff', 2);
  });
  reg('bullet_speed', function (g) { // streaking bolt
    g.lineWidth = 4; g.strokeStyle = P.cyan;
    [-10, 0, 10].forEach(function (y) { g.beginPath(); g.moveTo(-26, y); g.lineTo(-10, y); g.stroke(); });
    body(g, function (q) { q.moveTo(-8, -9); q.lineTo(12, -9); q.quadraticCurveTo(26, 0, 12, 9); q.lineTo(-8, 9); q.closePath(); }, P.steel, LW, { bb: 14 });
  });
  reg('bullets', function (g) { // three diverging rounds
    [-0.5, 0, 0.5].forEach(function (a) {
      g.save(); g.rotate(a); g.translate(0, -12);
      body(g, rrect(-5, -12, 10, 20, 5), P.yellow, 3, { bb: 10, lo: P.yellowLo });
      g.restore();
    });
    flat(g, circ(0, 14, 7), P.dark, 3);
  });
  reg('luck', function (g) { // four-leaf clover
    for (var k = 0; k < 4; k++) { g.save(); g.rotate(k * TAU / 4 + 0.785); body(g, circ(0, -11, 9), P.green, 3.2, { bb: 9, lo: P.greenLo }); g.restore(); }
    g.beginPath(); g.moveTo(2, 4); g.quadraticCurveTo(8, 16, 4, 24); g.lineWidth = 7; g.strokeStyle = OUT; g.stroke(); g.lineWidth = 3; g.strokeStyle = P.greenLo; g.stroke();
    flat(g, circ(0, 0, 4), P.yellow, 2.4);
  });
  reg('crit_chance', function (g) {
    g.beginPath(); g.arc(0, 0, 18, 0, TAU); g.lineWidth = 10; g.strokeStyle = OUT; g.stroke(); g.lineWidth = 5; g.strokeStyle = P.red; g.stroke();
    g.lineWidth = 9; g.strokeStyle = OUT; g.beginPath(); g.moveTo(-26, 0); g.lineTo(-8, 0); g.moveTo(8, 0); g.lineTo(26, 0); g.moveTo(0, -26); g.lineTo(0, -8); g.moveTo(0, 8); g.lineTo(0, 26); g.stroke();
    g.lineWidth = 4; g.strokeStyle = '#ffffff'; g.stroke();
    flat(g, circ(0, 0, 4), P.red, 2.4);
  });
  reg('crit_mult', function (g) {
    var pts = [];
    for (var k = 0; k < 16; k++) { var a = k / 16 * TAU, rr = k % 2 ? 11 : 25; pts.push(Math.cos(a) * rr, Math.sin(a) * rr); }
    body(g, poly(pts), P.orange, LW, { bb: 20, lo: P.orangeLo });
    flat(g, poly([-4, -9, 4, -9, 2, 4, -2, 4]), '#ffffff', 2); flat(g, circ(0, 9, 2.6), '#ffffff', 2);
  });
  reg('health_regen', function (g) { // green med capsule
    g.rotate(-0.7);
    body(g, function (q) { q.moveTo(-10, 0); q.lineTo(-10, -14); q.arc(0, -14, 10, Math.PI, 0); q.lineTo(10, 0); q.closePath(); }, '#f3ead8', LW, { bb: 14 });
    body(g, function (q) { q.moveTo(-10, 0); q.lineTo(10, 0); q.lineTo(10, 14); q.arc(0, 14, 10, 0, Math.PI); q.closePath(); }, P.green, LW, { bb: 14, lo: P.greenLo });
    flat(g, rrect(-2, -20, 4, 12, 1), P.green); flat(g, rrect(-6, -16, 12, 4, 1), P.green);
  });
  // small HUD glyphs
  S.register('hud:mat', 40, 40, function (g) { g.scale(1.25, 1.25); body(g, poly([-9, -10, 9, -10, 11, 0, 9, 10, -9, 10, -11, 0]), P.green, 3, { bb: 11, lo: P.greenLo }); flat(g, rrect(-4, -4, 8, 8, 1.5), '#2a6a35'); });
  S.register('hud:coin', 40, 40, function (g) {
    body(g, circ(0, 0, 13), P.yellow, 3.2, { bb: 13, lo: P.yellowLo });
    g.font = '900 16px "Lilita One", system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = P.yellowLo; g.fillText('₵', 0, 1);
  });
  S.register('hud:lock', 40, 40, function (g) {
    g.beginPath(); g.arc(0, -4, 8, Math.PI, 0); g.lineWidth = 8; g.strokeStyle = OUT; g.stroke(); g.lineWidth = 4; g.strokeStyle = P.steel; g.stroke();
    body(g, rrect(-12, -4, 24, 18, 4), P.yellow, 3.2, { bb: 12, lo: P.yellowLo });
    flat(g, circ(0, 4, 2.6), OUT);
  });
  S.register('hud:unlock', 40, 40, function (g) {
    g.beginPath(); g.arc(8, -6, 8, Math.PI, 0); g.lineWidth = 8; g.strokeStyle = OUT; g.stroke(); g.lineWidth = 4; g.strokeStyle = P.steel; g.stroke();
    body(g, rrect(-14, -2, 22, 16, 4), P.steelLo, 3.2, { bb: 12 });
  });
})();
