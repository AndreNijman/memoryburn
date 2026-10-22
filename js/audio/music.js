/*
 * MemoryBurn - js/audio/music.js
 *
 * Plays the songs in js/audio/songs.js. A 25 ms timer schedules every 16th step a little ahead of the
 * audio clock, so timing never depends on the frame rate or on Game Speed. Each song runs in a Player
 * with its own output, a tempo-synced echo, and a sidechain bus that ducks on the kick. Layers switch
 * on and off at bar lines as the intensity moves; song changes during a fight wait for the next bar.
 *
 *   MB.music.init(ctx, bus, verbIn)       called by the engine once the AudioContext exists
 *   MB.music.play(id, {transpose, sync})  id null = fade out; sync = start on the current song's next bar
 *   MB.music.intensity(0..1)              drives which layers play
 *   MB.music.current() -> {id, bar, sec, I, on}
 *   MB.music.renderOffline(id, {bars, I}) -> Promise of loudness stats (tools/audiocheck.mjs)
 */
(function () {
  'use strict';
  var SG = MB.songs, DSP = MB.dsp, SND = MB.sounds, PATCH = SG.PATCH, DG = SG.DRUM_GAIN;
  var CT = [0, 2, 4, 7, 9, 11, 14, 6]; // chord tones as scale steps above the chord root (digit in a pattern)
  var PAN = { hat: 0.22, ohat: 0.18, shaker: -0.3, rim: -0.2, perc: 0.3, wood: -0.25, zap: 0.35, tom: -0.12 };
  var LOOK = 0.16;
  var M = MB.music = {}, ctx = null, bus = null, verbIn = null, players = [], cur = null, want = 0.4;

  function deg(sc, d) { var n = sc.length, o = Math.floor(d / n); return sc[d - o * n] + 12 * o; }
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  var bars = Object.create(null);
  function parseBar(str) { // 'deg:len ...' -> [{s, d, n}] with d null for rests
    if (bars[str]) return bars[str];
    var out = [], s = 0;
    str.split(' ').forEach(function (tk) {
      var p = tk.split(':'), n = +p[1];
      out.push({ s: s, d: p[0] === '.' ? null : +p[0], n: n }); s += n;
    });
    return (bars[str] = out);
  }
  M.parseBar = parseBar;

  var drumCache = Object.create(null);
  function drumBuf(ac, kit, name) {
    var key = ac.sampleRate + ':' + kit + ':' + name;
    if (drumCache[key]) return drumCache[key];
    var r = SND.drum(kit, name), data = DSP.render(r.layers, ac.sampleRate, 7, r.post);
    var b = ac.createBuffer(1, data.length, ac.sampleRate);
    b.getChannelData(0).set(data);
    return (drumCache[key] = b);
  }

  /* ------------------------------------------------------------------ a playing song */
  function Player(ac, dest, vIn, id, o) {
    var S = SG.list[id];
    this.ac = ac; this.id = id; this.S = S; this.sc = SG.SCALES[S.scale];
    this.root = S.root + (o.transpose || 0);
    this.sd = 60 / S.bpm / 4; this.step = 0; this.t0 = o.t0; this.next = o.t0; this.stopAt = Infinity;
    this.want = o.intensity == null ? 0.5 : o.intensity;
    this.I = S.fixed != null ? S.fixed : S.ramp ? S.ramp[0] : this.want;
    this.on = {}; this.chord = 0; this.bar = 0; this.sec = 'A'; this.voicing = null; this.lastLead = 0;
    this.rng = MB.rng.make(id + ':' + (o.seed || 1));
    var out = this.out = ac.createGain();
    out.gain.setValueAtTime(0, o.t0);
    out.gain.linearRampToValueAtTime(S.gain || 1, o.t0 + Math.max(0.01, o.fade == null ? 0.4 : o.fade));
    out.connect(dest);
    this.pump = ac.createGain(); this.pump.connect(out);
    var dl = this.dl = ac.createDelay(2), fb = ac.createGain(), dlp = ac.createBiquadFilter();
    dl.delayTime.value = Math.min(1.9, 60 / S.bpm * (S.echo || 0.75));
    fb.gain.value = S.fb || 0.35; dlp.type = 'lowpass'; dlp.frequency.value = 3000;
    dl.connect(dlp); dlp.connect(fb); fb.connect(dl); dlp.connect(out);
    this.echoIn = ac.createGain(); this.echoIn.connect(dl);
    this.verb = ac.createGain(); if (vIn) this.verb.connect(vIn);
    this.verbLvl = S.gain || 1; this.verb.gain.value = 0;
    this.verb.gain.setValueAtTime(0, o.t0); this.verb.gain.linearRampToValueAtTime(this.verbLvl, o.t0 + 0.4);
    this.sends = {}; this.pans = {};
    this.keep = [out, this.pump, dl, fb, dlp, this.echoIn, this.verb];
  }
  var P = Player.prototype;

  P.send = function (kind, amt) { // shared send gains, one per (target, level)
    var k = kind + amt;
    if (!this.sends[k]) {
      var g = this.ac.createGain(); g.gain.value = amt; g.connect(kind === 'e' ? this.echoIn : this.verb);
      this.sends[k] = g; this.keep.push(g);
    }
    return this.sends[k];
  };
  P.route = function (node, patch) {
    node.connect(patch.pump && this.S.pump ? this.pump : this.out);
    if (patch.echo) node.connect(this.send('e', patch.echo));
    if (patch.verb) node.connect(this.send('v', patch.verb));
  };

  P.run = function (until) {
    while (this.next < until && this.next < this.stopAt) {
      this.tick(this.next);
      this.step++;
      this.next = this.t0 + this.step * this.sd;
    }
  };
  P.nextBar = function () { return this.t0 + Math.ceil(this.step / 16) * 16 * this.sd; };

  P.barStart = function (b, t) {
    var S = this.S, form = S.form || 'A';
    this.bar = b; this.sec = form[Math.floor(b / 4) % form.length];
    var prog = S.prog[this.sec] || S.prog.A;
    this.chord = prog[b % prog.length];
    if (S.ramp) this.I = Math.min(S.ramp[2], S.ramp[0] + b * S.ramp[1]);
    else if (S.fixed == null) this.I = this.want;
    var I = this.I, on = this.on;
    function gate(key, min) { on[key] = on[key] ? I >= min - 0.06 : I >= min; } // hysteresis stops bar-to-bar flicker
    (S.drums || []).forEach(function (d, i) { gate('d' + i, d[2] || 0); });
    if (S.bass) gate('bass', S.bass.min || 0);
    if (S.pad) gate('pad', S.pad.min || 0);
    if (S.arp) gate('arp', S.arp.min || 0);
    (S.mel || []).forEach(function (m, i) { gate('m' + i, m.min || 0); });
    this.fillOn = !!S.fill && b % 4 === 3 && I >= (S.fill[2] || 0.55);
    if (S.crash && b > 0 && b % 4 === 0 && I >= S.crash) this.drum(t, 'crash', 0.8);
    this.voicing = this.voice(this.chord, S.pad ? S.pad.o || 1 : 1, S.pad && S.pad.sev);
  };

  // Chord tones placed close to the previous chord so pads move smoothly instead of jumping.
  P.voice = function (c, o, sev) {
    var base = this.root + 12 * o, center = base + 7, tones = sev ? [0, 2, 4, 6] : [0, 2, 4], sc = this.sc;
    return tones.map(function (k) {
      var m = base + deg(sc, c + k);
      while (m > center + 6) m -= 12;
      while (m < center - 6) m += 12;
      return m;
    });
  };

  function hitAt(p, step, st) { return p.length === 16 ? p[st] : p[step % p.length]; } // 16-step patterns follow the bar
  function vel(ch) { return ch === 'X' ? 1 : ch === 'x' ? 0.78 : ch === 'o' ? 0.42 : 0; }
  function holdLen(p, i) { var n = 1, L = p.length; while (n < L && p[(i + n) % L] === '-') n++; return n; }

  P.tick = function (t) {
    var S = this.S, st = this.step % 16, b = Math.floor(this.step / 16), self = this;
    if (st === 0) this.barStart(b, t);
    var tt = t + (st % 2 === 1 && S.swing ? S.swing * this.sd : 0);
    var hum = 1 + (this.rng.next() - 0.5) * 0.12;
    (S.drums || []).forEach(function (d, i) {
      if (!self.on['d' + i]) return;
      var pat = Array.isArray(d[1]) ? d[1][b % d[1].length] : d[1];
      var v = vel(hitAt(pat, self.step, st));
      if (!v) return;
      self.drum(tt, d[0], v * (d[3] || 1) * hum);
      if (d[0] === 'kick' && S.pump) {
        self.pump.gain.setValueAtTime(1 - S.pump * v, tt);
        self.pump.gain.setTargetAtTime(1, tt + 0.02, 0.07);
      }
    });
    if (this.fillOn) { var fv = vel(S.fill[1][st]); if (fv) this.drum(tt, S.fill[0], fv * hum); }
    this.part(S.bass, 'bass', tt, st);
    this.part(S.arp, 'arp', tt, st);
    if (S.pad && this.on.pad) {
      var pp = S.pad.p, pi = pp.length === 16 ? st : this.step % pp.length;
      if (pp[pi] === 'x') this.note(PATCH[S.pad.patch], tt, this.voicing, holdLen(pp, pi) * this.sd, 1);
    }
    (S.mel || []).forEach(function (m, i) {
      if (!self.on['m' + i]) return;
      var arr = m[self.sec] || m.A, notes = parseBar(arr[b % arr.length]);
      for (var k = 0; k < notes.length; k++) {
        var n = notes[k];
        if (n.s === st && n.d != null) self.note(PATCH[m.patch], tt, self.root + 12 * (m.o || 2) + deg(self.sc, n.d), n.n * self.sd, 0.9 + 0.1 * hum);
      }
    });
  };

  P.part = function (L, key, t, st) {
    if (!L || !this.on[key]) return;
    var p = L.p, i = p.length === 16 ? st : this.step % p.length, ch = p[i];
    if (ch < '0' || ch > '9') return;
    var patch = PATCH[L.patch], v = patch.accent ? (st % 4 === 0 ? 1 : 0.62) : 0.85 + this.rng.next() * 0.15;
    this.note(patch, t, this.root + 12 * (L.o || 0) + deg(this.sc, this.chord + CT[+ch]), holdLen(p, i) * this.sd, v);
  };

  P.drum = function (t, name, v) {
    var ac = this.ac, src = ac.createBufferSource(), g = ac.createGain();
    src.buffer = drumBuf(ac, this.S.kit || 'neon', name);
    g.gain.value = (DG[name] || 0.2) * v;
    src.connect(g);
    var pan = PAN[name];
    if (pan && ac.createStereoPanner) {
      if (!this.pans[name]) { var pn = ac.createStereoPanner(); pn.pan.value = pan; pn.connect(this.out); this.pans[name] = pn; this.keep.push(pn); }
      g.connect(this.pans[name]);
    } else g.connect(this.out);
    if (name === 'snare' || name === 'clap') g.connect(this.send('v', 0.3));
    src.onended = function () { g.disconnect(); };
    src.start(t);
  };

  // One voice of a patch. midi may be an array (pads play the whole chord through one filter).
  P.note = function (patch, t, midi, dur, v) {
    var ac = this.ac, end = t + dur * (patch.gate || 1), rel = patch.rel || 0.1, stop = end + rel * 1.6 + 0.05;
    var g = ac.createGain(), pk = (patch.g || 0.1) * v, a = patch.a || 0.005, dec = patch.dec || 0.3;
    var sus = patch.sus == null ? (patch.t === 'pad' ? 1 : 0.7) : patch.sus;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(pk, t + a);
    if (sus < 1) g.gain.setTargetAtTime(pk * sus, t + a, dec / 3);
    g.gain.setTargetAtTime(0, end, rel / 3);
    var srcs = [];
    if (patch.t === 'fm') {
      (Array.isArray(midi) ? midi : [midi]).forEach(function (m) {
        var f = mtof(m), car = ac.createOscillator(), mod = ac.createOscillator(), mg = ac.createGain();
        mod.frequency.value = f * patch.ratio; car.frequency.value = f;
        mg.gain.setValueAtTime(f * patch.idx * v, t);
        mg.gain.setTargetAtTime(f * (patch.idxEnd || 0), t, (patch.idxDec || 0.3) / 3);
        mod.connect(mg); mg.connect(car.frequency); car.connect(g);
        srcs.push(car, mod);
      });
    } else {
      var fl = ac.createBiquadFilter(), notes = Array.isArray(midi) ? midi : [midi], n = patch.n || 1;
      fl.type = patch.ft || 'lowpass'; fl.Q.value = patch.q || 1;
      var cut = patch.cut || 2000, env = (patch.env || 0) * v;
      fl.frequency.setValueAtTime(cut + env, t);
      if (env) fl.frequency.setTargetAtTime(cut, t, dec / 3);
      if (patch.lfo) {
        var lfo = ac.createOscillator(), lg = ac.createGain();
        lfo.frequency.value = patch.lfo[0]; lg.gain.value = patch.lfo[1];
        lfo.connect(lg); lg.connect(fl.frequency); srcs.push(lfo);
      }
      var vib = null;
      if (patch.vib) {
        var vo = ac.createOscillator(); vib = ac.createGain();
        vo.frequency.value = patch.vib[0];
        vib.gain.setValueAtTime(0, t); vib.gain.linearRampToValueAtTime(patch.vib[1], t + (patch.vib[2] || 0.2) + 0.01);
        vo.connect(vib); srcs.push(vo);
      }
      var self = this;
      notes.forEach(function (m) {
        var fq = mtof(m);
        for (var i = 0; i < n; i++) {
          var o = ac.createOscillator();
          o.type = patch.w || 'sawtooth';
          if (patch.glide && self.lastLead && !Array.isArray(midi)) {
            o.frequency.setValueAtTime(self.lastLead, t);
            o.frequency.exponentialRampToValueAtTime(fq, t + patch.glide);
          } else o.frequency.value = fq;
          if (n > 1) o.detune.value = (i / (n - 1) - 0.5) * patch.det;
          if (vib) vib.connect(o.detune);
          o.connect(fl); srcs.push(o);
        }
        if (patch.sub) {
          var so = ac.createOscillator(), sg = ac.createGain();
          so.type = 'sine'; so.frequency.value = fq / 2; sg.gain.value = patch.sub;
          so.connect(sg); sg.connect(g); srcs.push(so);
        }
      });
      if (patch.glide && !Array.isArray(midi)) this.lastLead = mtof(midi);
      fl.connect(g);
    }
    this.route(g, patch);
    srcs.forEach(function (s) { s.start(t); s.stop(stop); });
    srcs[0].onended = function () { g.disconnect(); };
  };

  P.fadeOut = function (at, secs, hard) {
    [this.out.gain, this.verb.gain].forEach(function (g) {
      if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(at); else g.cancelScheduledValues(at); // hold a fade-in that is still ramping
      g.setTargetAtTime(0, at, Math.max(0.02, secs / 4));
    });
    this.stopAt = hard ? at : at + secs;
    this.endAt = at + secs + 2.5; // echo and reverb tails
  };
  P.dispose = function () { this.keep.forEach(function (n) { try { n.disconnect(); } catch (e) { /* already gone */ } }); };

  /* ------------------------------------------------------------------ the live scheduler */
  function tick() {
    if (!ctx || ctx.state !== 'running') return;
    var now = ctx.currentTime;
    for (var i = players.length - 1; i >= 0; i--) {
      var p = players[i];
      if (p.next < now - 0.2 && p.stopAt === Infinity) { // the clock jumped (tab hidden): rejoin on the grid
        var skip = Math.ceil((now + 0.05 - p.next) / p.sd);
        p.step += skip; p.next = p.t0 + p.step * p.sd;
      }
      p.run(now + LOOK);
      if (p.endAt && now > p.endAt) { p.dispose(); players.splice(i, 1); }
    }
  }

  M.init = function (ac, dest, vIn) {
    ctx = ac; bus = dest; verbIn = vIn;
    setInterval(tick, 25);
  };

  M.play = function (id, o) {
    o = o || {};
    if (!ctx) return;
    var key = id ? id + '|' + (o.transpose || 0) : null;
    if ((cur && cur.key === key) || (!cur && !key)) return;
    var now = ctx.currentTime, at = now + 0.08;
    if (cur) {
      if (o.sync && cur.next > now) { at = Math.max(cur.nextBar(), now + 0.08); cur.fadeOut(at, 0.25, true); }
      else cur.fadeOut(now, o.out == null ? 1.1 : o.out, false);
    }
    cur = null;
    if (!id || !SG.list[id]) return;
    var p = new Player(ctx, bus, verbIn, id, { t0: at, fade: o.sync ? 0.05 : (o.fade == null ? 0.6 : o.fade), transpose: o.transpose, intensity: want, seed: (MB.fx.next() * 1e9) | 0 });
    p.key = key; players.push(p); cur = p;
    tick();
  };

  M.intensity = function (v) { want = Math.max(0, Math.min(1, v)); if (cur) cur.want = want; };
  M.current = function () {
    if (!cur) return null;
    var on = [];
    for (var k in cur.on) if (cur.on[k]) on.push(k);
    return { id: cur.id, bar: cur.bar, sec: cur.sec, I: cur.I, on: on, players: players.length };
  };

  // Renders bars of a song without the live context: used by tools/audiocheck.mjs to catch silent
  // instruments, clipping and NaN in every song.
  M.renderOffline = function (id, o) {
    o = o || {};
    var S = SG.list[id], sr = 44100, nb = o.bars || 8, secs = nb * 16 * 60 / S.bpm / 4;
    var oc = new OfflineAudioContext(2, Math.ceil((secs + 2) * sr), sr);
    var p = new Player(oc, oc.destination, null, id, { t0: 0.02, fade: 0.01, intensity: o.I == null ? 1 : o.I, transpose: o.transpose });
    p.run(secs);
    return oc.startRendering().then(function (buf) {
      var a = DSP.measure(buf.getChannelData(0)), b = DSP.measure(buf.getChannelData(1)), on = [];
      for (var k in p.on) if (p.on[k]) on.push(k);
      return { id: id, peak: Math.max(a.peak, b.peak), rms: (a.rms + b.rms) / 2, bad: a.bad || b.bad, secs: secs, on: on };
    });
  };
})();
