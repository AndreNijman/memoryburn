/*
 * MemoryBurn - js/audio/dsp.js
 *
 * Offline synthesis into a Float32Array. Every sound effect and drum hit is a list of layers rendered
 * here once, then played back as an AudioBuffer (js/audio/engine.js). Pure maths with its own seeded
 * noise, so the same recipe always gives the same samples and node can render the whole bank
 * (tools/headless.mjs audio).
 *
 *   MB.dsp.render(layers, sr, seed, post) -> Float32Array (mono, peak-normalised to post.peak or 0.9)
 *
 * Layer fields (all optional except d):
 *   w     'sine' 'tri' 'saw' 'sq' 'noise' 'pink' 'brown' 'metal' (six detuned squares, 808 cymbal ratios)
 *   f f1  start and end pitch in Hz; fc bends the sweep (<1 drops early); fd = exponential pitch decay time
 *   t d   start time and duration in seconds
 *   a h p attack, hold, then (1 - x)^p decay to silence over the rest of d
 *   g     gain       pw pulse width for 'sq'       det unison detune in cents (two voices)
 *   lp lp1 / hp hp1 / bp bp1   filter cutoff sweeps (state-variable, q = resonance)
 *   fm fmi fmi1  FM: modulator ratio, index at start and end (carrier is a sine)
 *   vib [rate, semitones]   trem [rate, depth]   drive tanh saturation   rep [n, gap, pitchMul]
 * Post: {echo: [seconds, feedback], srd: sample-hold factor, bits, peak, loop (skip the end fade)}
 */
(function () {
  'use strict';
  var TAU = Math.PI * 2, sin = Math.sin, pow = Math.pow, exp = Math.exp, tanh = Math.tanh, abs = Math.abs;
  var WAVES = { sine: 0, noise: 1, pink: 2, brown: 3, metal: 4, tri: 5, saw: 6, sq: 7 };
  var METAL = [1, 1.4827, 1.8003, 2.5461, 2.6303, 3.8967]; // 205.3 304.4 369.6 522.7 540 800 Hz over 205.3

  function noiseGen(seed) {
    var s = (seed >>> 0) || 0x1234567;
    return function () { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 2147483648 - 1; };
  }
  function blep(t, dt) {
    if (t < dt) { t /= dt; return t + t - t * t - 1; }
    if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
    return 0;
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // Topology-preserving state-variable filter (Zavalishin). mode 0 low, 1 band, 2 high.
  function SVF(mode, q) { this.m = mode; this.k = 1 / (q || 0.707); this.a1 = 0; this.a2 = 0; this.a3 = 0; this.s1 = 0; this.s2 = 0; }
  SVF.prototype.set = function (fc, sr) {
    var g = Math.tan(Math.PI * clamp(fc, 20, sr * 0.45) / sr);
    this.a1 = 1 / (1 + g * (g + this.k)); this.a2 = g * this.a1; this.a3 = g * this.a2;
  };
  SVF.prototype.run = function (x) {
    var v3 = x - this.s2, v1 = this.a1 * this.s1 + this.a2 * v3, v2 = this.s2 + this.a2 * this.s1 + this.a3 * v3;
    this.s1 = 2 * v1 - this.s1; this.s2 = 2 * v2 - this.s2;
    return this.m === 0 ? v2 : this.m === 1 ? v1 : x - this.k * v1 - v2;
  };

  function sweep(a, b, x, curve) { // exponential between two positive values
    if (b == null || b === a) return a;
    if (curve != null && curve !== 1) x = pow(x, curve);
    return a * pow(b / a, x);
  }

  function expand(layers) {
    var out = [];
    layers.forEach(function (L) {
      if (!L) return;
      if (!L.rep) { out.push(L); return; }
      for (var i = 0; i < L.rep[0]; i++) {
        var c = {}, k;
        for (k in L) c[k] = L[k];
        delete c.rep;
        var m = pow(L.rep[2] || 1, i);
        c.t = (L.t || 0) + i * L.rep[1];
        if (c.f) c.f *= m;
        if (c.f1) c.f1 *= m;
        c.g = (L.g == null ? 1 : L.g) * pow(L.rep[3] || 1, i);
        out.push(c);
      }
    });
    return out;
  }

  function renderLayer(out, L, sr, rnd) {
    var t0 = Math.round((L.t || 0) * sr), n = Math.max(1, Math.round(L.d * sr));
    if (t0 + n > out.length) n = out.length - t0;
    var w = L.w || 'sine', f0 = L.f || 220, f1 = L.f1 == null ? f0 : L.f1, gain = L.g == null ? 1 : L.g;
    var a = Math.max(0.0005, L.a == null ? 0.002 : L.a), h = L.h || 0, p = L.p == null ? 2 : L.p;
    var dec = Math.max(1e-4, L.d - a - h), pw = L.pw || 0.5;
    var lp = L.lp ? new SVF(0, L.q || 0.8) : null, hp = L.hp ? new SVF(2, L.q || 0.8) : null, bp = L.bp ? new SVF(1, L.q || 1.2) : null;
    var drive = L.drive || 0, dn = drive ? tanh(drive) : 1;
    var voices = L.det ? [pow(2, -L.det / 2400), pow(2, L.det / 2400)] : [0], ph = [], pm = 0, b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
    var mph = [0, 0, 0, 0, 0, 0];
    for (var v = 0; v < voices.length; v++) ph.push(rnd() * 0.5 + 0.5);
    var vib = L.vib, trem = L.trem;
    var fm = L.fm || 0, fmi = L.fmi || 0, fmi1 = L.fmi1 == null ? fmi : L.fmi1, fd = L.fd || 0, lc = L.lc;
    var lp0 = L.lp, lp1 = L.lp1, hp0 = L.hp, hp1 = L.hp1, bp0 = L.bp, bp1 = L.bp1, fc = L.fc;
    var W = WAVES[w] || 0, nv = voices.length, inv = 1 / sr;
    var f = f0, e = 0, idx = fmi, KR = 8; // pitch, envelope and filter cutoffs run at control rate
    for (var i = 0; i < n; i++) {
      if (i % KR === 0) {
        var tt = i / sr, x = i / n;
        if (lp) lp.set(sweep(lp0, lp1, x, lc), sr);
        if (hp) hp.set(sweep(hp0, hp1, x, lc), sr);
        if (bp) bp.set(sweep(bp0, bp1, x, lc), sr);
        f = fd ? f1 + (f0 - f1) * exp(-tt / fd) : sweep(f0, f1, x, fc);
        if (vib) f *= pow(2, sin(TAU * vib[0] * tt) * vib[1] / 12);
        e = tt < a ? tt / a : tt < a + h ? 1 : pow(Math.max(0, 1 - (tt - a - h) / dec), p);
        if (trem) e *= 1 - trem[1] * (0.5 + 0.5 * sin(TAU * trem[0] * tt));
        e *= gain;
        idx = fmi + (fmi1 - fmi) * x;
      }
      var s = 0;
      if (W === 1) s = rnd();
      else if (W === 2) {
        var wn = rnd();
        b0 = 0.99886 * b0 + wn * 0.0555179; b1 = 0.99332 * b1 + wn * 0.0750759; b2 = 0.969 * b2 + wn * 0.153852;
        b3 = 0.8665 * b3 + wn * 0.3104856; b4 = 0.55 * b4 + wn * 0.5329522; b5 = -0.7616 * b5 - wn * 0.016898;
        s = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + wn * 0.5362) * 0.11; b6 = wn * 0.115926;
      } else if (W === 3) { br = (br + 0.02 * rnd()) / 1.02; s = br * 3.5; }
      else if (W === 4) {
        for (var m = 0; m < 6; m++) { mph[m] += f * METAL[m] * inv; if (mph[m] >= 1) mph[m] -= 1; s += mph[m] < 0.5 ? 1 : -1; }
        s /= 6;
      } else if (fm) {
        pm += f * fm * inv; if (pm >= 1) pm -= 1;
        ph[0] += f * inv; if (ph[0] >= 1) ph[0] -= 1;
        s = sin(TAU * ph[0] + idx * sin(TAU * pm));
      } else {
        for (v = 0; v < nv; v++) {
          var dt = (voices[v] ? f * voices[v] : f) * inv;
          ph[v] += dt; if (ph[v] >= 1) ph[v] -= 1;
          var q = ph[v];
          if (W === 0) s += sin(TAU * q);
          else if (W === 5) s += 1 - 4 * abs(q - 0.5);
          else if (W === 6) s += 2 * q - 1 - blep(q, dt);
          else s += (q < pw ? 1 : -1) + blep(q, dt) - blep((q + 1 - pw) % 1, dt);
        }
        if (nv > 1) s *= 0.5;
      }
      if (hp) s = hp.run(s);
      if (bp) s = bp.run(s);
      if (lp) s = lp.run(s);
      if (drive) s = tanh(s * drive) / dn;
      out[t0 + i] += s * e;
    }
  }

  function render(layers, sr, seed, post) {
    post = post || {};
    layers = expand(layers);
    var len = 0;
    layers.forEach(function (L) { len = Math.max(len, (L.t || 0) + L.d); });
    var echo = post.echo;
    if (echo) len += echo[0] * Math.ceil(Math.log(0.02) / Math.log(echo[1]));
    var out = new Float32Array(Math.ceil(len * sr) + 1), rnd = noiseGen(seed * 2654435761 + 97);
    layers.forEach(function (L) { renderLayer(out, L, sr, rnd); });
    var i, n = out.length;
    if (echo) { var ds = Math.round(echo[0] * sr); for (i = ds; i < n; i++) out[i] += out[i - ds] * echo[1]; }
    if (post.srd > 1 || post.bits) { // sample-hold and bit reduction for the digital-grit sounds
      var hold = post.srd || 1, lv = post.bits ? pow(2, post.bits - 1) : 0, last = 0;
      for (i = 0; i < n; i++) {
        if (i % hold === 0) last = lv ? Math.round(out[i] * lv) / lv : out[i];
        out[i] = last;
      }
    }
    var peak = 0;
    for (i = 0; i < n; i++) { var v = abs(out[i]); if (v > peak) peak = v; }
    var k = peak > 0 ? (post.peak || 0.9) / peak : 0, fade = Math.min(n, Math.round(sr * 0.004));
    for (i = 0; i < n; i++) out[i] *= k;
    if (!post.loop) for (i = 0; i < fade; i++) out[n - 1 - i] *= i / fade;
    return out;
  }

  // Loudness summary used by the tests and the mixer: peak, RMS, and whether any sample is not finite.
  function measure(buf) {
    var peak = 0, sum = 0, bad = false;
    for (var i = 0; i < buf.length; i++) {
      var v = buf[i];
      if (!isFinite(v)) { bad = true; continue; }
      var a = abs(v); if (a > peak) peak = a; sum += v * v;
    }
    return { peak: peak, rms: Math.sqrt(sum / Math.max(1, buf.length)), bad: bad, n: buf.length };
  }

  MB.dsp = { render: render, measure: measure, noise: noiseGen };
})();
