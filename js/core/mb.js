/*
 * MemoryBurn - js/core/mb.js
 *
 * The single global namespace `MB` and the foundation the other files build on.
 *
 *   MB.rng.make(seed) -> RNG    mulberry32. The RNG's only own field is `s` (uint32), so it serialises as {"s":n}.
 *                               Methods: next() [0,1), uniform(a,b), randint(a,b) inclusive, choice(arr), chance(p),
 *                               shuffle(arr), weighted(weights) -> index. Names follow Python's `random` so the
 *                               port reads like the original.
 *   MB.fx                       cosmetic RNG (particles, shake). Never touches sim state.
 *   MB.util                     clamp lerp dist dist2 len norm rotate hash32
 *
 * Headless safe: no DOM, no Date, no performance, no Math.random.
 */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  var MB = root.MB = root.MB || {};
  MB.VERSION = '2.0.0';
  MB.sim = MB.sim || {};
  MB.data = MB.data || {};
  MB.render = MB.render || {};
  MB.ui = MB.ui || {};

  var TAU = Math.PI * 2;

  function RNG(seed) { this.s = seed >>> 0; }
  RNG.prototype.next = function () {
    var t = (this.s = (this.s + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  RNG.prototype.random = RNG.prototype.next;
  RNG.prototype.uniform = function (a, b) { return a + (b - a) * this.next(); };
  RNG.prototype.randint = function (a, b) { return a + Math.floor(this.next() * (b - a + 1)); };
  RNG.prototype.choice = function (arr) { return arr[Math.floor(this.next() * arr.length)]; };
  RNG.prototype.chance = function (p) { return this.next() < p; };
  RNG.prototype.shuffle = function (arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(this.next() * (i + 1)); var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  };
  RNG.prototype.weighted = function (w) {
    var tot = 0, i;
    for (i = 0; i < w.length; i++) tot += Math.max(0, w[i]);
    var r = this.next() * tot;
    for (i = 0; i < w.length; i++) { r -= Math.max(0, w[i]); if (r < 0) return i; }
    return w.length - 1;
  };

  function hash32(str) {
    var h = 2166136261 >>> 0;
    str = String(str);
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }

  MB.rng = {
    make: function (seed) { return new RNG(typeof seed === 'string' ? hash32(seed) : seed); },
    restore: function (obj) { return new RNG(obj.s); },
    RNG: RNG
  };
  MB.fx = new RNG(0x9e3779b9);

  MB.util = {
    TAU: TAU,
    clamp: function (a, lo, hi) { return a < lo ? lo : a > hi ? hi : a; },
    lerp: function (a, b, t) { return a + (b - a) * t; },
    dist: function (ax, ay, bx, by) { var dx = bx - ax, dy = by - ay; return Math.sqrt(dx * dx + dy * dy); },
    dist2: function (ax, ay, bx, by) { var dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; },
    len: function (x, y) { return Math.sqrt(x * x + y * y); },
    hash32: hash32
  };
})();
