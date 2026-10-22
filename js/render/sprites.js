/*
 * MemoryBurn - js/render/sprites.js
 *
 * Procedural sprites in a Brotato-style look: chunky round bodies, thick dark outline, flat fill with one
 * highlight and one shade, big readable eyes. Everything is drawn with canvas paths and baked once into
 * offscreen canvases at RES x the logical size, then blitted.
 *
 *   MB.sprites.get(key) -> {c, w, h}      baked canvas; w,h are logical size, art is centred on (w/2, h/2)
 *   MB.sprites.draw(ctx, key, x, y, o)    o: {scale, sx, sy, rot, alpha, flash (0..1 white hit flash), flip}
 *   MB.sprites.has(key)
 *   MB.sprites.floor(biome) -> canvas     tileable arena floor for a biome id
 *   MB.sprites.palette                    shared colours (OUT outline etc)
 *
 * Keys: char:<0..7>, gun:<0..7>, enemy:<kind>, pickup:<mat|xp|heal>, pet:<kind>, bullet:<hex>, ebullet,
 *       portal, spawnmark, shadow, crate, icon:<stat>
 * Browser only (needs a canvas). No sim state.
 */
(function () {
  'use strict';
  var MB = window.MB;
  var S = MB.sprites = {};
  var TAU = Math.PI * 2;
  var RES = 2;
  var cache = Object.create(null);

  var OUT = '#1c1622';
  var P = S.palette = {
    OUT: OUT,
    skin: '#e3b071', skinHi: '#f3cf94', skinLo: '#bf8650',
    white: '#fbf6ec', pupil: '#1c1622', mouth: '#5a2730', tongue: '#e0606a',
    cyan: '#4ff0d8', cyanLo: '#1fa596', red: '#ef4d5f', redLo: '#b02b40', yellow: '#ffd35a', yellowLo: '#d49a22',
    green: '#79e36a', greenLo: '#3fa84a', blue: '#5fb3ff', blueLo: '#2f6fd0', purple: '#b770ff', purpleLo: '#7a3fc4',
    steel: '#a9b3c7', steelLo: '#6c768d', dark: '#3a3346', darkLo: '#262130', orange: '#ff9a3c', orangeLo: '#c9601c'
  };

  function mk(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
    return c;
  }
  S.mkCanvas = mk;

  function bake(key, w, h, fn) {
    var c = mk(w * RES, h * RES);
    var g = c.getContext('2d');
    g.scale(RES, RES);
    g.translate(w / 2, h / 2);
    g.lineJoin = 'round'; g.lineCap = 'round';
    fn(g);
    var s = { c: c, w: w, h: h, flash: null };
    cache[key] = s;
    return s;
  }

  /* ------------------------------------------------------------------ colour helpers */
  function hexToRgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
  }
  function rgbToHex(r) {
    return '#' + r.map(function (v) { v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? '0' : '') + v.toString(16); }).join('');
  }
  function shade(hex, t) { // t -1..1, negative darkens toward OUT-ish, positive lightens toward white
    var c = hexToRgb(hex);
    var to = t < 0 ? [28, 22, 34] : [255, 250, 240];
    var k = Math.abs(t);
    return rgbToHex([c[0] + (to[0] - c[0]) * k, c[1] + (to[1] - c[1]) * k, c[2] + (to[2] - c[2]) * k]);
  }
  function rgba(hex, a) { var c = hexToRgb(hex); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  S.shade = shade; S.rgba = rgba;
  S.toHex = function (rgb) { return rgbToHex(rgb); };

  /* ------------------------------------------------------------------ drawing primitives */
  // Fill a path, shade it (highlight top-left, shade bottom-right, clipped to the shape), then outline it.
  function body(g, path, fill, lw, o) {
    o = o || {};
    g.save();
    g.beginPath(); path(g);
    g.fillStyle = fill; g.fill();
    if (o.shade !== false) {
      g.clip();
      var bb = o.bb || 30;
      g.fillStyle = o.lo || shade(fill, -0.28);
      g.beginPath(); g.ellipse(bb * 0.35, bb * 0.55, bb * 1.25, bb * 0.95, 0, 0, TAU); g.rect(-bb * 3, -bb * 3, bb * 6, bb * 6);
      g.fill('evenodd');
      g.fillStyle = o.hi || shade(fill, 0.32);
      g.beginPath(); g.ellipse(-bb * 0.38, -bb * 0.5, bb * 0.32, bb * 0.2, -0.6, 0, TAU); g.fill();
    }
    g.restore();
    g.beginPath(); path(g);
    g.lineWidth = lw; g.strokeStyle = OUT; g.stroke();
  }
  function flat(g, path, fill, lw) {
    g.beginPath(); path(g);
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (lw) { g.lineWidth = lw; g.strokeStyle = OUT; g.stroke(); }
  }
  function ell(x, y, rx, ry, rot) { return function (g) { g.ellipse(x, y, rx, ry, rot || 0, 0, TAU); }; }
  function circ(x, y, r) { return function (g) { g.moveTo(x + r, y); g.arc(x, y, r, 0, TAU); }; }
  function rrect(x, y, w, h, r) {
    return function (g) {
      r = Math.min(r, w / 2, h / 2);
      g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
      g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
    };
  }
  function poly(pts) {
    return function (g) { g.moveTo(pts[0], pts[1]); for (var i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); g.closePath(); };
  }
  // Smooth irregular closed blob (potato-ish). seed gives a stable shape.
  function blob(rx, ry, wob, seed, n) {
    n = n || 10;
    var pts = [];
    var s = seed * 9301 + 49297;
    for (var i = 0; i < n; i++) {
      s = (s * 9301 + 49297) % 233280;
      var j = 1 + (s / 233280 - 0.5) * 2 * wob;
      var a = (i / n) * TAU - Math.PI / 2;
      pts.push([Math.cos(a) * rx * j, Math.sin(a) * ry * j]);
    }
    return function (g) {
      for (var i = 0; i <= n; i++) {
        var p0 = pts[i % n], p1 = pts[(i + 1) % n];
        var mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
        if (i === 0) g.moveTo(mx, my); else g.quadraticCurveTo(p0[0], p0[1], mx, my);
      }
      g.closePath();
    };
  }
  S.prim = { body: body, flat: flat, ell: ell, circ: circ, rrect: rrect, poly: poly, blob: blob };

  /* ------------------------------------------------------------------ faces */
  function eye(g, x, y, r, o) {
    o = o || {};
    if (o.closed) { // calm closed eye: a downward arc
      g.beginPath(); g.arc(x, y - r * 0.2, r * 0.8, 0.15 * Math.PI, 0.85 * Math.PI);
      g.lineWidth = r * 0.42; g.strokeStyle = OUT; g.stroke(); return;
    }
    flat(g, ell(x, y, r * 0.86, r, 0), o.white || P.white, r * 0.36);
    var px = x + (o.lx || 0.18) * r, py = y + (o.ly || 0.12) * r;
    flat(g, circ(px, py, r * (o.pr || 0.5)), o.pupil || P.pupil);
    flat(g, circ(px - r * 0.18, py - r * 0.2, r * 0.17), '#ffffff');
  }
  function brow(g, x, y, w, ang, lw) {
    g.save(); g.translate(x, y); g.rotate(ang);
    g.beginPath(); g.moveTo(-w / 2, 0); g.lineTo(w / 2, 0);
    g.lineWidth = lw; g.strokeStyle = OUT; g.stroke(); g.restore();
  }
  function smile(g, x, y, w, open, lw) {
    if (open) {
      g.beginPath(); g.moveTo(x - w / 2, y); g.quadraticCurveTo(x, y + w * 0.9, x + w / 2, y); g.closePath();
      g.fillStyle = P.mouth; g.fill();
      g.save(); g.clip(); flat(g, ell(x, y + w * 0.55, w * 0.3, w * 0.22), P.tongue); g.restore();
      g.lineWidth = lw; g.strokeStyle = OUT; g.stroke();
    } else {
      g.beginPath(); g.moveTo(x - w / 2, y); g.quadraticCurveTo(x, y + w * 0.45, x + w / 2, y);
      g.lineWidth = lw; g.strokeStyle = OUT; g.stroke();
    }
  }

  /* ------------------------------------------------------------------ characters (8 archetypes)
   * Bean-shaped heroes ~ 44x50 logical units, centred. Gear sits on top of the shared body. */
  var CHAR = [
    { skin: '#e3b071', seed: 3 },  // 0 Netrunner
    { skin: '#c98d5a', seed: 7 },  // 1 Solo
    { skin: '#efc187', seed: 11 }, // 2 Courier
    { skin: '#d9c6e8', seed: 5 },  // 3 Vamp
    { skin: '#e0a865', seed: 13 }, // 4 Techno Monk
    { skin: '#e8b57a', seed: 2 },  // 5 Riot Runner
    { skin: '#b9c4d6', seed: 17 }, // 6 Steel Witch
    { skin: '#d6a16a', seed: 19 }  // 7 Junk Saint
  ];
  var LW = 3.4;

  function potatoBody(g, def) {
    var path = blob(21, 24, 0.07, def.seed, 11);
    body(g, path, def.skin, LW, { bb: 24 });
    // potato spots
    g.save(); g.beginPath(); path(g); g.clip();
    g.fillStyle = shade(def.skin, -0.18);
    [[-12, 10, 2.4], [9, 14, 1.8], [13, -4, 1.5], [-15, -2, 1.3]].forEach(function (s) {
      g.beginPath(); g.arc(s[0], s[1], s[2], 0, TAU); g.fill();
    });
    g.restore();
  }

  var GEAR = [
    function netrunner(g) {
      // cable from the back of the head
      g.beginPath(); g.moveTo(-14, -14); g.bezierCurveTo(-30, -18, -30, 4, -22, 10);
      g.lineWidth = 6.5; g.strokeStyle = OUT; g.stroke();
      g.lineWidth = 3; g.strokeStyle = P.cyanLo; g.stroke();
      flat(g, circ(-22, 10, 3), P.cyan, 2.4);
      // visor band
      body(g, rrect(-17, -12, 34, 11, 5), P.dark, LW, { bb: 10, hi: '#5a5170' });
      flat(g, rrect(-12, -9.5, 24, 6, 3), P.cyan);
      flat(g, rrect(-10, -9, 8, 2, 1), '#c9fff6');
      smile(g, 2, 6, 9, false, 2.6);
    },
    function solo(g) {
      // headband with tails
      g.beginPath(); g.moveTo(-17, -10); g.quadraticCurveTo(-27, -12, -29, -4); g.lineTo(-23, -8); g.closePath();
      flat(g, function (q) { q.moveTo(-17, -12); q.quadraticCurveTo(-29, -16, -30, -6); q.quadraticCurveTo(-25, -9, -18, -6); q.closePath(); }, P.red, LW);
      body(g, function (q) { q.moveTo(-19, -15); q.quadraticCurveTo(0, -21, 19, -15); q.lineTo(20, -9); q.quadraticCurveTo(0, -15, -20, -9); q.closePath(); }, P.red, LW, { bb: 10 });
      eye(g, -7, -2, 4.4, { lx: 0.25 }); eye(g, 7, -2, 4.4, { lx: 0.25 });
      brow(g, -7, -8.5, 9, 0.28, 3); brow(g, 7, -8.5, 9, -0.28, 3);
      // scar + stubble grin
      g.beginPath(); g.moveTo(10, -10); g.lineTo(14, 2); g.lineWidth = 1.6; g.strokeStyle = shade(P.red, -0.4); g.stroke();
      g.beginPath(); g.moveTo(-5, 9); g.lineTo(6, 8); g.lineWidth = 2.6; g.strokeStyle = OUT; g.stroke();
    },
    function courier(g) {
      // backpack peeking out
      body(g, rrect(-26, -2, 10, 18, 3), P.green, LW, { bb: 8 });
      eye(g, -6, -1, 4.6); eye(g, 8, -1, 4.6);
      smile(g, 2, 7, 10, true, 2.6);
      // backwards cap
      body(g, function (q) { q.moveTo(-18, -9); q.quadraticCurveTo(-16, -26, 2, -26); q.quadraticCurveTo(18, -25, 18, -9); q.closePath(); }, P.yellow, LW, { bb: 14 });
      flat(g, rrect(-27, -12, 13, 5, 2.5), P.yellowLo, LW);
      flat(g, circ(1, -25, 2.2), P.yellowLo, 2);
    },
    function vamp(g) {
      // high collar cape behind the head
      flat(g, function (q) { q.moveTo(-22, 2); q.lineTo(-28, 22); q.lineTo(-12, 16); q.lineTo(0, 24); q.lineTo(12, 16); q.lineTo(28, 22); q.lineTo(22, 2); q.quadraticCurveTo(0, 12, -22, 2); q.closePath(); }, P.redLo, LW);
      // slick hair with widow's peak
      body(g, function (q) { q.moveTo(-20, -6); q.quadraticCurveTo(-20, -26, 0, -25); q.quadraticCurveTo(20, -26, 20, -6); q.quadraticCurveTo(10, -14, 0, -6); q.quadraticCurveTo(-10, -14, -20, -6); q.closePath(); }, P.darkLo, LW, { bb: 12, hi: '#4a4060' });
      eye(g, -7, 0, 4.2, { white: '#ffe2e6', pupil: P.redLo, pr: 0.55 }); eye(g, 7, 0, 4.2, { white: '#ffe2e6', pupil: P.redLo, pr: 0.55 });
      smile(g, 0, 8, 10, false, 2.6);
      flat(g, poly([-3.5, 9.5, -2, 13.5, -0.5, 9.8]), '#ffffff', 1.4); flat(g, poly([3.5, 9.5, 2, 13.5, 0.5, 9.8]), '#ffffff', 1.4);
    },
    function monk(g) {
      // floating halo ring
      g.beginPath(); g.ellipse(0, -30, 13, 4, 0, 0, TAU); g.lineWidth = 7; g.strokeStyle = OUT; g.stroke();
      g.lineWidth = 3.5; g.strokeStyle = P.cyan; g.stroke();
      // hood framing the face
      body(g, function (q) { q.moveTo(-23, 14); q.quadraticCurveTo(-27, -24, 0, -25); q.quadraticCurveTo(27, -24, 23, 14); q.quadraticCurveTo(15, 2, 14, -6); q.quadraticCurveTo(0, -16, -14, -6); q.quadraticCurveTo(-15, 2, -23, 14); q.closePath(); }, P.orange, LW, { bb: 18 });
      eye(g, -6, -1, 4, { closed: true }); eye(g, 6, -1, 4, { closed: true });
      smile(g, 0, 7, 7, false, 2.4);
      flat(g, circ(0, -8, 1.8), P.cyan, 1.2); // third-eye dot
    },
    function riot(g) {
      eye(g, -6, 2, 4.4, { lx: 0.35 }); eye(g, 8, 2, 4.4, { lx: 0.35 });
      smile(g, 3, 10, 9, true, 2.6);
      // helmet
      body(g, function (q) { q.moveTo(-22, -4); q.quadraticCurveTo(-22, -27, 0, -27); q.quadraticCurveTo(22, -27, 22, -4); q.closePath(); }, P.blue, LW, { bb: 16 });
      flat(g, rrect(-4, -27, 8, 21, 3), '#ffffff'); flat(g, rrect(-2, -26, 4, 19, 2), P.red);
      // goggles pushed up
      flat(g, circ(-9, -10, 5), P.yellow, LW); flat(g, circ(9, -10, 5), P.yellow, LW);
      flat(g, circ(-10, -11, 1.8), '#fff7c9'); flat(g, circ(8, -11, 1.8), '#fff7c9');
    },
    function witch(g) {
      eye(g, -7, 2, 4.4, { pupil: P.purpleLo }); eye(g, 7, 2, 4.4, { pupil: P.purpleLo });
      smile(g, 0, 10, 8, false, 2.4);
      // riveted metal witch hat, slightly bent tip
      body(g, function (q) { q.moveTo(-14, -12); q.lineTo(-2, -40); q.quadraticCurveTo(4, -44, 12, -38); q.lineTo(6, -36); q.lineTo(14, -12); q.closePath(); }, P.steel, LW, { bb: 16, lo: P.steelLo });
      body(g, ell(0, -11, 25, 6), P.steelLo, LW, { bb: 10 });
      flat(g, rrect(-12, -18, 24, 5, 2), P.purple, 2.2);
      [-8, 0, 8].forEach(function (x) { flat(g, circ(x, -11, 1.3), '#e7ecf6'); });
    },
    function saint(g) {
      // bolt-ring halo
      g.beginPath(); g.ellipse(0, -31, 12, 3.6, 0, 0, TAU); g.lineWidth = 6.5; g.strokeStyle = OUT; g.stroke();
      g.lineWidth = 3; g.strokeStyle = P.yellow; g.stroke();
      [-9, 0, 9].forEach(function (x) { flat(g, rrect(x - 2, -34, 4, 4, 1), P.steel, 1.6); });
      eye(g, -7, -1, 4.6); eye(g, 7, -1, 4.6, { closed: true });
      smile(g, 0, 8, 10, true, 2.6);
      // bandage across the head and a scrap shoulder plate
      flat(g, function (q) { q.moveTo(-18, -16); q.lineTo(-4, -22); q.lineTo(-2, -17); q.lineTo(-16, -11); q.closePath(); }, '#f3ead8', 2.4);
      body(g, function (q) { q.moveTo(8, 12); q.lineTo(24, 6); q.lineTo(25, 18); q.lineTo(12, 22); q.closePath(); }, P.steelLo, LW, { bb: 10 });
      flat(g, circ(17, 14, 1.4), P.steel);
    }
  ];

  function bakeChar(i) {
    return bake('char:' + i, 72, 92, function (g) {
      g.translate(0, 8);
      potatoBody(g, CHAR[i]);
      GEAR[i](g);
    });
  }

  /* ------------------------------------------------------------------ weapons (point right, grip at origin) */
  var GUN = [
    function deck(g) { // data-spike pistol with a little screen
      body(g, rrect(-4, -6, 24, 11, 3), P.dark, 3, { bb: 10 });
      flat(g, rrect(1, -4, 10, 6, 1.5), P.cyan);
      flat(g, rrect(20, -3.5, 8, 5, 1.5), P.cyanLo, 2.4);
      flat(g, rrect(-2, 3, 7, 10, 2), P.darkLo, 2.6);
    },
    function scattergun(g) {
      flat(g, rrect(-8, -2, 14, 9, 3), '#8a5a35', 3);
      body(g, rrect(4, -7, 30, 6, 2), P.steel, 3, { bb: 8, lo: P.steelLo });
      body(g, rrect(4, -2, 30, 6, 2), P.steelLo, 3, { bb: 8 });
      flat(g, rrect(12, 4, 12, 5, 2), '#8a5a35', 2.6);
    },
    function smg(g) {
      body(g, rrect(-4, -6, 26, 10, 3), P.steelLo, 3, { bb: 10 });
      flat(g, rrect(20, -3.5, 10, 4, 1.5), P.dark, 2.4);
      flat(g, rrect(6, 3, 6, 13, 2), P.dark, 2.6);
      flat(g, rrect(-2, 3, 6, 9, 2), P.dark, 2.6);
      flat(g, rrect(2, -4, 10, 2.5, 1), P.yellow);
    },
    function ion(g) {
      body(g, rrect(-6, -6, 36, 11, 4), '#5a4a72', 3, { bb: 12 });
      [6, 13, 20].forEach(function (x) { flat(g, rrect(x, -8, 4, 15, 2), P.purple, 2.2); });
      flat(g, circ(33, -0.5, 4.5), '#f2d9ff', 2.6);
      flat(g, rrect(-4, 4, 7, 9, 2), P.darkLo, 2.6);
    },
    function monkRod(g) { // focus rod: short staff with a floating bead
      flat(g, rrect(-8, -3, 34, 6, 3), '#9a6a3a', 3);
      flat(g, rrect(22, -5, 6, 10, 2), P.yellow, 2.4);
      flat(g, circ(35, 0, 5), P.cyan, 2.8);
      flat(g, circ(33.5, -1.5, 1.6), '#e6fffb');
    },
    function riotPistol(g) {
      body(g, rrect(-2, -6, 22, 9, 3), P.blue, 3, { bb: 9 });
      flat(g, rrect(18, -4.5, 7, 5, 1.5), P.dark, 2.4);
      flat(g, rrect(-1, 2, 7, 11, 2), P.darkLo, 2.6);
      flat(g, rrect(3, -4, 8, 2.2, 1), '#ffffff');
    },
    function wand(g) {
      flat(g, rrect(-8, -2.5, 30, 5, 2.5), P.steelLo, 3);
      flat(g, poly([22, 0, 28, -8, 38, 0, 28, 8]), P.purple, 3);
      flat(g, poly([26, -1, 29, -5, 33, -1]), '#f0dcff');
    },
    function pipeCannon(g) {
      body(g, rrect(-6, -8, 32, 15, 5), '#7a8a5a', 3, { bb: 12 });
      flat(g, rrect(24, -9.5, 8, 18, 3), P.steelLo, 3);
      flat(g, rrect(4, -10, 5, 19, 1.5), P.orange, 2.2);
      flat(g, rrect(-3, 5, 8, 9, 2), P.darkLo, 2.6);
    }
  ];
  function bakeGun(i) { return bake('gun:' + i, 84, 40, function (g) { g.translate(-14, 0); GUN[i](g); }); }

  /* ------------------------------------------------------------------ enemies
   * Original kinds: scrap brute skater suicide aegis sentry overlord. Sized ~ 2x their sim radius at scale 1. */
  var ENEMY = {
    scrap: { w: 56, h: 56, draw: function (g) { // little rust blob with one big eye and an antenna
      g.beginPath(); g.moveTo(4, -16); g.quadraticCurveTo(8, -24, 14, -24); g.lineWidth = 5.5; g.strokeStyle = OUT; g.stroke();
      g.lineWidth = 2.4; g.strokeStyle = P.steel; g.stroke();
      flat(g, circ(14, -24, 3.6), P.red, 2.4);
      body(g, blob(18, 16, 0.12, 4, 9), '#c96a3a', 3.4, { bb: 18 });
      flat(g, circ(-9, 8, 2.2), shade('#c96a3a', -0.25)); flat(g, circ(10, 9, 1.6), shade('#c96a3a', -0.25));
      eye(g, 0, -2, 7.2, { lx: 0.2, ly: 0.2 });
      g.beginPath(); g.moveTo(-6, 10); g.lineTo(-2, 8); g.lineTo(2, 10); g.lineTo(6, 8);
      g.lineWidth = 2.4; g.strokeStyle = OUT; g.stroke();
    } },
    brute: { w: 96, h: 92, draw: function (g) { // hulking maroon bruiser with a metal jaw
      body(g, circ(-30, 14, 10), '#8f2d3f', 3.6, { bb: 10 });
      body(g, circ(30, 14, 10), '#8f2d3f', 3.6, { bb: 10 });
      body(g, blob(32, 30, 0.08, 9, 12), '#a8344a', 3.8, { bb: 32 });
      eye(g, -10, -8, 5.6, { white: '#ffe3a8', pr: 0.55 }); eye(g, 10, -8, 5.6, { white: '#ffe3a8', pr: 0.55 });
      brow(g, -10, -16, 13, 0.4, 4); brow(g, 10, -16, 13, -0.4, 4);
      body(g, rrect(-16, 4, 32, 14, 4), P.steelLo, 3.4, { bb: 10, lo: '#4c556a' });
      [-8, 0, 8].forEach(function (x) { g.beginPath(); g.moveTo(x, 5); g.lineTo(x, 17); g.lineWidth = 2; g.strokeStyle = OUT; g.stroke(); });
      flat(g, poly([-14, 4, -11, -4, -8, 4]), '#fff4dc', 2.2); flat(g, poly([14, 4, 11, -4, 8, 4]), '#fff4dc', 2.2);
    } },
    skater: { w: 70, h: 56, draw: function (g) { // sleek teal teardrop on a wheel with speed fins
      g.lineWidth = 3; g.strokeStyle = rgba(P.cyan, 0.7);
      [-6, 2, 10].forEach(function (y, k) { g.beginPath(); g.moveTo(-34 + k * 3, y); g.lineTo(-24 + k * 3, y); g.stroke(); });
      flat(g, circ(0, 18, 6.5), P.dark, 3); flat(g, circ(0, 18, 2.4), P.steel);
      body(g, function (q) { q.moveTo(24, 0); q.quadraticCurveTo(14, -20, -10, -16); q.quadraticCurveTo(-24, -12, -22, 2); q.quadraticCurveTo(-18, 16, 2, 14); q.quadraticCurveTo(18, 12, 24, 0); q.closePath(); }, '#2fb5a3', 3.4, { bb: 20 });
      flat(g, poly([-14, -14, -24, -24, -6, -15]), '#1f8a7d', 2.8);
      eye(g, 8, -3, 5, { lx: 0.4, pr: 0.45 });
      brow(g, 8, -9.5, 9, -0.35, 3);
    } },
    suicide: { w: 62, h: 66, draw: function (g) { // black bomb, fuse, red blinking light
      g.beginPath(); g.moveTo(4, -18); g.quadraticCurveTo(10, -30, 18, -27);
      g.lineWidth = 5; g.strokeStyle = OUT; g.stroke(); g.lineWidth = 2.4; g.strokeStyle = '#c9a36a'; g.stroke();
      flat(g, poly([18, -34, 20, -29, 26, -29, 21, -26, 23, -20, 18, -24, 13, -20, 15, -26, 10, -29, 16, -29]), P.yellow, 1.8);
      body(g, rrect(-5, -22, 12, 8, 2), P.steelLo, 3, { bb: 6 });
      body(g, circ(0, 2, 20), '#3b3448', 3.6, { bb: 20, hi: '#6d6380' });
      flat(g, circ(0, -8, 3.4), P.red, 2); flat(g, circ(-1, -9, 1.1), '#ffd0d6');
      eye(g, -7, 4, 4.4, { white: '#ffd9a0', pupil: P.redLo }); eye(g, 7, 4, 4.4, { white: '#ffd9a0', pupil: P.redLo });
      brow(g, -7, -1, 9, 0.5, 3.2); brow(g, 7, -1, 9, -0.5, 3.2);
      g.beginPath(); g.moveTo(-5, 14); g.quadraticCurveTo(0, 10, 5, 14); g.lineWidth = 2.4; g.strokeStyle = OUT; g.stroke();
    } },
    aegis: { w: 80, h: 76, draw: function (g) { // blue shield-bearer: hex plate in front (faces +x)
      body(g, blob(23, 25, 0.06, 21, 10), '#4a74d8', 3.6, { bb: 25 });
      eye(g, -4, -6, 5, { lx: 0.35 }); eye(g, 10, -6, 5, { lx: 0.35 });
      g.beginPath(); g.moveTo(-2, 8); g.lineTo(10, 8); g.lineWidth = 2.6; g.strokeStyle = OUT; g.stroke();
      var hex = []; for (var k = 0; k < 6; k++) { var a = k / 6 * TAU; hex.push(26 + Math.cos(a) * 9, Math.sin(a) * 26); }
      body(g, poly(hex), P.cyan, 3.6, { bb: 18, lo: P.cyanLo });
      g.beginPath(); g.moveTo(26, -18); g.lineTo(26, 18); g.lineWidth = 2; g.strokeStyle = rgba('#ffffff', 0.7); g.stroke();
    } },
    sentry: { w: 78, h: 78, draw: function (g) { // tripod turret with a red lens and barrel (faces +x)
      g.lineWidth = 7; g.strokeStyle = OUT;
      [[-20, 26], [0, 30], [20, 26]].forEach(function (p) { g.beginPath(); g.moveTo(0, 8); g.lineTo(p[0], p[1]); g.stroke(); });
      g.lineWidth = 3.5; g.strokeStyle = P.steelLo;
      [[-20, 26], [0, 30], [20, 26]].forEach(function (p) { g.beginPath(); g.moveTo(0, 8); g.lineTo(p[0], p[1]); g.stroke(); });
      body(g, rrect(10, -6, 26, 10, 3), P.dark, 3.2, { bb: 8 });
      body(g, circ(0, -2, 19), '#8d97ad', 3.6, { bb: 19, lo: '#5c657c' });
      flat(g, circ(3, -3, 9), P.darkLo, 3);
      flat(g, circ(4, -3, 5.5), P.red); flat(g, circ(2.5, -5, 1.8), '#ffd6dc');
    } },
    overlord: { w: 180, h: 170, draw: function (g) { // boss: big violet blob, spiked crown, three eyes, tentacle feet
      for (var k = -2; k <= 2; k++) body(g, ell(k * 22, 50, 12, 18, k * 0.2), '#7a3fc4', 4.2, { bb: 14 });
      body(g, blob(66, 58, 0.06, 31, 14), '#9b4fe0', 4.6, { bb: 60 });
      flat(g, poly([-44, -40, -36, -78, -22, -50, -6, -88, 8, -52, 24, -80, 38, -46, 48, -70, 50, -36]), P.yellow, 4.2);
      flat(g, circ(-6, -60, 5), P.red, 2.6); flat(g, circ(24, -58, 4), P.cyan, 2.4);
      eye(g, -26, -8, 11, { white: '#fff0b8', pr: 0.5 }); eye(g, 26, -8, 11, { white: '#fff0b8', pr: 0.5 }); eye(g, 0, -26, 8, { white: '#fff0b8', pr: 0.5 });
      brow(g, -26, -24, 22, 0.35, 5.5); brow(g, 26, -24, 22, -0.35, 5.5);
      g.beginPath(); g.moveTo(-28, 22); g.quadraticCurveTo(0, 6, 28, 22); g.quadraticCurveTo(0, 42, -28, 22); g.closePath();
      g.fillStyle = P.mouth; g.fill(); g.lineWidth = 4; g.strokeStyle = OUT; g.stroke();
      for (var t = -3; t <= 3; t++) flat(g, poly([t * 7 - 3, 17 + Math.abs(t) * 0.6, t * 7, 25, t * 7 + 3, 17 + Math.abs(t) * 0.6]), '#ffffff', 1.6);
    } }
  };

  /* ------------------------------------------------------------------ pickups, pets, bullets, misc */
  var MISC = {
    'pickup:mat': [30, 30, function (g) { // green scrap chip (Brotato's materials are green)
      body(g, poly([-9, -10, 9, -10, 11, 0, 9, 10, -9, 10, -11, 0]), P.green, 3, { bb: 11, lo: P.greenLo });
      flat(g, rrect(-4, -4, 8, 8, 1.5), '#2a6a35'); flat(g, rrect(-2, -2, 3, 3, 0.8), '#c8ffb8');
    }],
    'pickup:xp': [30, 34, function (g) { // blue data shard
      body(g, poly([0, -14, 9, 0, 0, 14, -9, 0]), P.blue, 3, { bb: 12, lo: P.blueLo });
      flat(g, poly([0, -9, 4, 0, 0, 2, -4, 0]), '#d6ecff');
    }],
    'pickup:heal': [34, 34, function (g) { // pink health fruit-cell with a leaf
      flat(g, ell(5, -11, 5, 3, -0.5), P.green, 2.4);
      body(g, circ(0, 2, 11), P.red, 3, { bb: 11 });
      flat(g, rrect(-1.6, -3, 3.2, 10, 1), '#ffffff'); flat(g, rrect(-5, 0.4, 10, 3.2, 1), '#ffffff');
    }],
    'pet:turret_buddy': [44, 44, function (g) {
      flat(g, ell(0, 14, 10, 3), 'rgba(0,0,0,0.25)');
      body(g, rrect(4, -4, 16, 7, 2), P.dark, 3, { bb: 6 });
      body(g, circ(0, 0, 11), P.orange, 3.2, { bb: 11, lo: P.orangeLo });
      flat(g, circ(2, -1, 4.5), P.darkLo, 2.4); flat(g, circ(3, -1.5, 2), P.cyan);
      g.beginPath(); g.moveTo(-6, -9); g.lineTo(-10, -15); g.lineWidth = 2.6; g.strokeStyle = OUT; g.stroke();
      flat(g, circ(-10, -15, 2.2), P.red);
    }],
    'pet:magnet_drone': [44, 44, function (g) {
      flat(g, ell(-9, -11, 7, 2.5), rgba(P.steel, 0.9), 2); flat(g, ell(9, -11, 7, 2.5), rgba(P.steel, 0.9), 2);
      body(g, circ(0, 0, 10), P.steel, 3.2, { bb: 10, lo: P.steelLo });
      g.beginPath(); g.arc(0, 3, 6, 0, Math.PI); g.lineWidth = 8; g.strokeStyle = OUT; g.stroke();
      g.lineWidth = 4.4; g.strokeStyle = P.red; g.stroke();
      flat(g, rrect(-8.2, 1, 4.4, 3, 0.5), '#ffffff'); flat(g, rrect(3.8, 1, 4.4, 3, 0.5), '#ffffff');
      flat(g, circ(0, -3, 2.4), P.blue);
    }],
    'pet:heal_bot': [44, 44, function (g) {
      flat(g, ell(0, 14, 10, 3), 'rgba(0,0,0,0.25)');
      body(g, rrect(-11, -10, 22, 20, 7), '#f3ead8', 3.2, { bb: 12 });
      flat(g, rrect(-2.2, -6.5, 4.4, 13, 1), P.red); flat(g, rrect(-6.5, -2.2, 13, 4.4, 1), P.red);
      g.beginPath(); g.moveTo(0, -10); g.lineTo(0, -16); g.lineWidth = 2.6; g.strokeStyle = OUT; g.stroke();
      flat(g, circ(0, -17, 2.4), P.green, 1.6);
    }],
    'ebullet': [26, 26, function (g) {
      flat(g, circ(0, 0, 9), rgba(P.red, 0.35));
      flat(g, circ(0, 0, 6.5), '#ff6a8a', 2.8); flat(g, circ(-2, -2, 2.2), '#ffe1e8');
    }],
    'portal': [120, 120, function (g) {
      for (var k = 0; k < 4; k++) {
        g.beginPath(); g.ellipse(0, 0, 50 - k * 11, 50 - k * 11, 0, k * 0.7, k * 0.7 + Math.PI * 1.4);
        g.lineWidth = 9; g.strokeStyle = OUT; g.stroke();
        g.lineWidth = 5; g.strokeStyle = [P.purple, P.cyan, P.purple, '#f0dcff'][k]; g.stroke();
      }
      flat(g, circ(0, 0, 9), '#f0dcff', 3);
    }],
    'spawnmark': [40, 40, function (g) { // Brotato-style red X telegraph
      g.lineWidth = 9; g.strokeStyle = OUT;
      g.beginPath(); g.moveTo(-12, -12); g.lineTo(12, 12); g.moveTo(12, -12); g.lineTo(-12, 12); g.stroke();
      g.lineWidth = 5; g.strokeStyle = P.red; g.stroke();
    }],
    'shadow': [64, 20, function (g) { flat(g, ell(0, 0, 28, 8), 'rgba(10,6,16,0.32)'); }]
  };

  // Player bullets take any colour: bullet:#rrggbb (elongated capsule pointing +x)
  function bakeBullet(key) {
    var col = key.slice(7) || '#ffe9a8';
    return bake(key, 34, 18, function (g) {
      flat(g, rrect(-14, -6, 28, 12, 6), rgba(col, 0.28));
      flat(g, rrect(-10, -4, 20, 8, 4), col, 2.6);
      flat(g, rrect(-4, -2, 10, 3, 1.5), shade(col, 0.6));
    });
  }

  function build(key) {
    var m;
    if ((m = /^char:(\d)$/.exec(key))) return bakeChar(+m[1]);
    if ((m = /^gun:(\d)$/.exec(key))) return bakeGun(+m[1]);
    if ((m = /^enemy:(\w+)$/.exec(key)) && ENEMY[m[1]]) { var e = ENEMY[m[1]]; return bake(key, e.w, e.h, e.draw); }
    if (key.indexOf('bullet:') === 0) return bakeBullet(key);
    if (MISC[key]) { var d = MISC[key]; return bake(key, d[0], d[1], d[2]); }
    return null;
  }

  S.get = function (key) { return cache[key] || build(key); };
  S.has = function (key) { return !!S.get(key); };

  function flashOf(s) {
    if (s.flash) return s.flash;
    var c = mk(s.c.width, s.c.height), g = c.getContext('2d');
    g.drawImage(s.c, 0, 0);
    g.globalCompositeOperation = 'source-atop'; g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
    return (s.flash = c);
  }

  S.draw = function (ctx, key, x, y, o) {
    var s = S.get(key);
    if (!s) return;
    o = o || {};
    var sc = o.scale || 1, sx = (o.sx || 1) * sc * (o.flip ? -1 : 1), sy = (o.sy || 1) * sc;
    ctx.save();
    ctx.translate(x, y);
    if (o.rot) ctx.rotate(o.rot);
    ctx.scale(sx, sy);
    if (o.alpha != null) ctx.globalAlpha *= o.alpha;
    ctx.drawImage(s.c, -s.w / 2, -s.h / 2, s.w, s.h);
    if (o.flash > 0) { ctx.globalAlpha *= Math.min(1, o.flash); ctx.drawImage(flashOf(s), -s.w / 2, -s.h / 2, s.w, s.h); }
    ctx.restore();
  };

  /* ------------------------------------------------------------------ arena floors
   * Tileable 512px floor per biome, Brotato-style: soft mottled ground, scattered pebbles and tufts,
   * plus biome-specific debris. Built with a fixed-seed cosmetic RNG so it never touches sim state. */
  var FLOOR_DEF = {
    _default: { base: '#5b4a5e', blot: ['#54445a', '#625166', '#4d3f53'], dots: '#6e5c72', deco: 'cables' }
  };
  S.floorDefs = FLOOR_DEF;
  var floors = Object.create(null);

  S.floor = function (biome) {
    if (floors[biome]) return floors[biome];
    var d = FLOOR_DEF[biome] || FLOOR_DEF._default;
    var N = 512, c = mk(N, N), g = c.getContext('2d');
    var r = MB.rng.make('floor:' + biome);
    g.fillStyle = d.base; g.fillRect(0, 0, N, N);
    function wrap(fn) { for (var ox = -N; ox <= N; ox += N) for (var oy = -N; oy <= N; oy += N) { g.save(); g.translate(ox, oy); fn(); g.restore(); } }
    var i;
    for (i = 0; i < 70; i++) {
      var bx = r.uniform(0, N), by = r.uniform(0, N), br = r.uniform(20, 70), col = r.choice(d.blot);
      wrap(function () { g.fillStyle = col; g.beginPath(); g.ellipse(bx, by, br, br * r.uniform(0.5, 0.9), r.uniform(0, 3), 0, TAU); g.fill(); });
    }
    for (i = 0; i < 160; i++) {
      var x = r.uniform(0, N), y = r.uniform(0, N), rr = r.uniform(1.2, 3.2);
      wrap(function () { g.fillStyle = d.dots; g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill(); });
    }
    for (i = 0; i < 22; i++) { // pebbles with outline, Brotato-like
      var px = r.uniform(0, N), py = r.uniform(0, N), pr = r.uniform(3, 7);
      wrap(function () {
        g.fillStyle = shade(d.base, -0.35); g.beginPath(); g.ellipse(px + 1, py + 2, pr, pr * 0.7, 0, 0, TAU); g.fill();
        g.fillStyle = shade(d.base, 0.18); g.beginPath(); g.ellipse(px, py, pr, pr * 0.7, 0, 0, TAU); g.fill();
      });
    }
    if (d.deco === 'tufts' || d.deco === 'cables') {
      for (i = 0; i < 18; i++) {
        var tx = r.uniform(0, N), ty = r.uniform(0, N), tc = d.tuft || shade(d.base, 0.25);
        wrap(function () {
          g.strokeStyle = tc; g.lineWidth = 2.4; g.lineCap = 'round';
          for (var k = -1; k <= 1; k++) { g.beginPath(); g.moveTo(tx + k * 3, ty); g.lineTo(tx + k * 5, ty - 7 - (k === 0 ? 3 : 0)); g.stroke(); }
        });
      }
    }
    if (d.deco === 'cables') {
      for (i = 0; i < 5; i++) {
        var cx0 = r.uniform(0, N), cy0 = r.uniform(0, N), cx1 = cx0 + r.uniform(-140, 140), cy1 = cy0 + r.uniform(-140, 140);
        var mx = (cx0 + cx1) / 2 + r.uniform(-50, 50), my = (cy0 + cy1) / 2 + r.uniform(-50, 50);
        wrap(function () {
          g.lineCap = 'round';
          g.strokeStyle = shade(d.base, -0.4); g.lineWidth = 6; g.beginPath(); g.moveTo(cx0, cy0); g.quadraticCurveTo(mx, my, cx1, cy1); g.stroke();
          g.strokeStyle = d.cable || shade(d.base, 0.1); g.lineWidth = 2.5; g.stroke();
        });
      }
    }
    if (d.deco === 'cracks') {
      for (i = 0; i < 10; i++) {
        var kx = r.uniform(0, N), ky = r.uniform(0, N), pts = [[kx, ky]];
        for (var s = 0; s < 4; s++) { var last = pts[pts.length - 1]; pts.push([last[0] + r.uniform(-22, 22), last[1] + r.uniform(-22, 22)]); }
        wrap(function () {
          g.strokeStyle = shade(d.base, -0.35); g.lineWidth = 2; g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
          for (var q = 1; q < pts.length; q++) g.lineTo(pts[q][0], pts[q][1]); g.stroke();
        });
      }
    }
    return (floors[biome] = c);
  };

  S.CHAR_COUNT = CHAR.length;
  S.ENEMY_KINDS = Object.keys(ENEMY);
})();
