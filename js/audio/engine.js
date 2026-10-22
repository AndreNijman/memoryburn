/*
 * MemoryBurn - js/audio/engine.js
 *
 * The audio engine. Browsers only allow sound after a click or key press, so the AudioContext starts on
 * the first one. Reads sim events and app state only; nothing here can change a run.
 *
 * Mix: music, sfx and ambience go through a low-pass that closes on the pause screen, at low HP and on
 * death, then a glue compressor and a limiter. UI and voice skip the low-pass so menus stay crisp.
 * A generated-impulse reverb is shared by everything.
 *
 *   MB.audio.events(app, events)   after each sim step and each shop command
 *   MB.audio.update(app, dt)       once per frame: music choice, intensity, filters, timers, ambience
 *   MB.audio.ui(name) / click() / hover() / blip(speaker)   menu and dialogue sounds
 *   MB.audio.setVolumes(settings)  masterVol, musicVol, sfxVol (0-100)
 *   MB.audio.stats()               counters for the tests
 */
(function () {
  'use strict';
  var SND = MB.sounds, DSP = MB.dsp, SG = MB.songs, ST = MB.data.STORY, W = MB.data.VIRTUAL_W;
  var A = MB.audio = {};
  var ctx = null, N = {}, bank = Object.create(null), queue = [], voices = [], lastAt = Object.create(null);
  var vol = { master: 0.8, music: 0.7, sfx: 0.8 };
  var st = { played: 0, dropped: 0, skipped: 0, rendered: 0 };
  var MAX_VOICES = 32;
  var ATTRACT = { menu: 1, options: 1, chars: 1, difficulty: 1 }, FIGHT = {};
  for (var dk in SG.DISTRICT) FIGHT[SG.DISTRICT[dk]] = 1;

  /* ------------------------------------------------------------------ context and mix */
  function impulse(secs, decay) { // stereo noise with an exponential tail, darker as it decays
    var sr = ctx.sampleRate, n = Math.floor(secs * sr), b = ctx.createBuffer(2, n, sr);
    for (var c = 0; c < 2; c++) {
      var d = b.getChannelData(c), rnd = DSP.noise(c + 11), lp = 0;
      for (var i = 0; i < n; i++) {
        var x = i / n, k = 0.08 + 0.85 * x;
        lp += (rnd() - lp) * (1 - k);
        d[i] = lp * Math.pow(1 - x, decay);
      }
    }
    return b;
  }

  function build() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { try { ctx = new AC(); } catch (e2) { return false; } }
    function gain(v, to) { var g = ctx.createGain(); g.gain.value = v; if (to) g.connect(to); return g; }
    var lim = N.lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -2; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.12;
    lim.connect(ctx.destination);
    var glue = N.glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -16; glue.knee.value = 10; glue.ratio.value = 3; glue.attack.value = 0.008; glue.release.value = 0.25;
    N.master = gain(vol.master, glue); glue.connect(lim);
    N.muffle = ctx.createBiquadFilter(); N.muffle.type = 'lowpass'; N.muffle.frequency.value = 20000; N.muffle.Q.value = 0.9;
    N.muffle.connect(N.master);
    N.duck = gain(1, N.muffle);
    N.music = gain(vol.music, N.duck);
    N.sfx = gain(vol.sfx, N.muffle);
    N.amb = gain(vol.sfx, N.muffle);
    N.ui = gain(vol.sfx, N.master);
    N.voice = gain(vol.sfx, N.master);
    N.verb = ctx.createConvolver(); N.verb.buffer = impulse(2.6, 2.4);
    N.verbIn = gain(0.5, N.verb); N.verb.connect(gain(0.8, N.muffle));
    N.panOk = !!ctx.createStereoPanner;
    MB.music.init(ctx, N.music, N.verbIn);
    warm();
    return true;
  }

  function unlock() {
    if (!ctx && !build()) return;
    if (ctx.state === 'suspended' && !document.hidden) ctx.resume();
  }
  ['pointerdown', 'keydown', 'touchend', 'mousedown'].forEach(function (ev) { document.addEventListener(ev, unlock, true); });
  document.addEventListener('visibilitychange', function () {
    if (!ctx) return;
    if (document.hidden) ctx.suspend(); else ctx.resume();
  });

  function curve(v) { return Math.pow(Math.max(0, Math.min(100, v)) / 100, 1.6); }
  A.setVolumes = function (s) {
    vol.master = curve(s.masterVol); vol.music = curve(s.musicVol); vol.sfx = curve(s.sfxVol);
    if (!ctx) return;
    var t = ctx.currentTime;
    N.master.gain.setTargetAtTime(vol.master, t, 0.03);
    N.music.gain.setTargetAtTime(vol.music, t, 0.03);
    ['sfx', 'amb', 'ui', 'voice'].forEach(function (k) { N[k].gain.setTargetAtTime(vol.sfx, t, 0.03); });
  };

  /* ------------------------------------------------------------------ the sound bank */
  function renderOne(id, v) {
    var d = SND.list[id], r = MB.rng.make(id + ':' + v), j = Math.pow(2, (v - (d.vars - 1) / 2) * 0.7 / 12);
    var rec = d.make(r, j, v), data = DSP.render(rec.layers, ctx.sampleRate, v + 1, rec.post);
    var b = ctx.createBuffer(1, data.length, ctx.sampleRate);
    b.getChannelData(0).set(data);
    st.rendered++;
    return b;
  }
  function buffers(id) {
    var d = SND.list[id], b = bank[id];
    if (!b) b = bank[id] = [];
    for (var v = 0; v < d.vars; v++) if (!b[v]) b[v] = renderOne(id, v); // rendered on demand if warm() hasn't got here yet
    return b;
  }
  // Renders the bank in small slices after unlock so the first boss horn doesn't stall a frame.
  // Gameplay sounds go first; the big one-offs last.
  function warm() {
    var first = ['uiHover', 'uiClick', 'uiBack', 'toggleOn', 'toggleOff', 'uiTick', 'hit', 'crit', 'eshoot', 'portal', 'pickup_mat', 'pickup_xp', 'kill_scrap', 'kill_skater'];
    var ids = first.concat(Object.keys(SND.list).filter(function (k) { return first.indexOf(k) < 0; }));
    ids.forEach(function (id) { for (var v = 0; v < SND.list[id].vars; v++) queue.push([id, v]); });
    (function slice() {
      var t0 = performance.now();
      while (queue.length && performance.now() - t0 < 6) {
        var q = queue.shift(), b = bank[q[0]] || (bank[q[0]] = []);
        if (!b[q[1]]) b[q[1]] = renderOne(q[0], q[1]);
      }
      if (queue.length) setTimeout(slice, 16);
    })();
  }

  // o: {x, vol, rate, jit (semitones), delay, verb}
  function play(id, o) {
    if (!ctx || ctx.state !== 'running') return null;
    var d = SND.list[id];
    if (!d) return null;
    o = o || {};
    var now = ctx.currentTime;
    if (lastAt[id] != null && now - lastAt[id] < d.gap) { st.skipped++; return null; }
    lastAt[id] = now;
    for (var i = voices.length - 1; i >= 0; i--) if (voices[i].end < now) voices.splice(i, 1);
    if (voices.length >= MAX_VOICES) { // steal the oldest voice of the lowest priority, if it ranks no higher
      var vi = -1;
      for (i = 0; i < voices.length; i++) if (vi < 0 || voices[i].pri < voices[vi].pri) vi = i;
      if (voices[vi].pri > d.pri) { st.dropped++; return null; }
      var old = voices.splice(vi, 1)[0];
      old.g.gain.setTargetAtTime(0, now, 0.01); old.src.stop(now + 0.05);
    }
    var bs = buffers(id), buf = bs[(MB.fx.next() * bs.length) | 0];
    var rate = (o.rate || 1) * Math.pow(2, (MB.fx.next() - 0.5) * 2 * (o.jit == null ? 0.4 : o.jit) / 12);
    var src = ctx.createBufferSource(), g = ctx.createGain(), out = g, at = now + (o.delay || 0);
    src.buffer = buf; src.playbackRate.value = rate;
    g.gain.value = d.vol * (o.vol == null ? 1 : o.vol);
    src.connect(g);
    if (o.x != null && N.panOk) {
      var pn = ctx.createStereoPanner();
      pn.pan.value = Math.max(-1, Math.min(1, (o.x / W * 2 - 1) * 0.7));
      g.connect(pn); out = pn;
    }
    out.connect(N[d.bus] || N.sfx);
    var vs = (o.verb != null ? o.verb : d.verb) || 0;
    if (vs) { var sg = ctx.createGain(); sg.gain.value = vs; out.connect(sg); sg.connect(N.verbIn); }
    src.onended = function () { out.disconnect(); if (out !== g) g.disconnect(); };
    src.start(at);
    voices.push({ src: src, g: g, end: at + buf.duration / rate, pri: d.pri });
    st.played++;
    return src;
  }

  /* ------------------------------------------------------------------ sim events */
  var PENT = [0, 2, 4, 7, 9];
  var combo = 0, comboT = -1, bossDowns = 0;
  A.events = function (app, evs) {
    if (!ctx || !app.sim) return;
    var me = app.slot, now = ctx.currentTime;
    for (var i = 0; i < evs.length; i++) {
      var e = evs[i];
      switch (e.t) {
        case 'shoot': play('gun' + e.arch, { x: e.x, vol: e.slot === me ? 1 : 0.5 }); break;
        case 'hit': play(e.crit ? 'crit' : 'hit', { x: e.x }); break;
        case 'block': play('block', { x: e.x }); break;
        case 'kill':
          if (e.kind === 'overlord') {
            if (bossDowns++ === 0) { play('bossDown', { x: e.x }); duck(0.35, 2.2); } else { play('kill_brute', { x: e.x }); play('elite', { x: e.x }); }
          } else { play('kill_' + e.kind, { x: e.x }); if (e.elite) play('elite', { x: e.x, delay: 0.05 }); }
          break;
        case 'explode': play('explode', { x: e.x }); break;
        case 'portal': play(e.kind === 'overlord' ? 'portalBoss' : 'portal', { x: e.x }); break;
        case 'eshoot': play(e.big ? 'eshootBig' : 'eshoot', { x: e.x }); break;
        case 'hurt': if (e.slot === me) { play('hurt', { x: e.x }); duck(0.6, 0.35); } break;
        case 'heal': if (e.slot === me) play('heal', { x: e.x }); break;
        case 'dash': if (e.slot === me) play('dash', { x: e.x }); break;
        case 'death': if (e.slot === me) { play('death', { x: e.x }); duck(0.2, 3); } break;
        case 'pickup':
          if (e.slot !== me) break;
          if (now - comboT < 0.45) combo = Math.min(combo + 1, 14); else combo = 0;
          comboT = now;
          play('pickup_' + e.kind, { x: e.x, jit: 0, rate: Math.pow(2, (PENT[combo % 5] + 12 * Math.floor(combo / 5)) / 12 * 0.5) });
          break;
        case 'waveEnd': play('waveClear'); if (e.questDone) play('questDone', { delay: 0.5 }); break;
        case 'buy': play('buy'); break;
        case 'reroll': play('reroll'); break;
      }
    }
  };

  function duck(level, secs) { // pull the music down under a big moment
    if (!ctx) return;
    var g = N.duck.gain, t = ctx.currentTime;
    if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t); else g.cancelScheduledValues(t);
    g.setTargetAtTime(level, t, 0.03);
    g.setTargetAtTime(1, t + secs * 0.4, secs * 0.25);
  }

  /* ------------------------------------------------------------------ ambience beds per district */
  var noiseBuf = null, bed = null, bedName = null;
  function loopNoise(color) {
    if (!noiseBuf) noiseBuf = {};
    if (noiseBuf[color]) return noiseBuf[color];
    var data = DSP.render([{ w: color, d: 4, a: 0.001, h: 4, g: 1 }], ctx.sampleRate, 5, { peak: 0.6, loop: true });
    var b = ctx.createBuffer(1, data.length, ctx.sampleRate); b.getChannelData(0).set(data);
    return (noiseBuf[color] = b);
  }
  var BEDS = {
    // [noise colour, filter type, freq, Q, gain, lfo rate, lfo depth (Hz)] plus an optional tonal hum [Hz list, gain]
    'Neon Grid': { n: ['pink', 'lowpass', 900, 0.7, 0.05, 0.05, 300], hum: [[60, 120, 180], 0.012] },
    'Rain Alley': { n: ['pink', 'bandpass', 2600, 0.5, 0.2, 0.11, 900] },
    'Dust Slums': { n: ['brown', 'bandpass', 520, 1.2, 0.2, 0.09, 320] },
    'Vine Mesh': { n: ['noise', 'bandpass', 4600, 9, 0.05, 17, 900], hum: [[82.4], 0.02] },
    'Jetstream': { n: ['brown', 'bandpass', 900, 0.8, 0.25, 0.17, 650] },
    'Reactor Core': { n: ['brown', 'lowpass', 300, 1, 0.16, 0.3, 120], hum: [[50, 100, 150, 200], 0.022] },
    'Midnight District': { n: ['brown', 'lowpass', 340, 0.7, 0.2, 0.04, 120] }
  };
  function ambience(name) {
    if (name === bedName || !ctx) return;
    bedName = name;
    var t = ctx.currentTime;
    if (bed) {
      var old = bed;
      old.g.gain.setTargetAtTime(0, t, 0.5);
      setTimeout(function () { old.srcs.forEach(function (s) { try { s.stop(); } catch (e) { /* stopped */ } }); old.g.disconnect(); }, 3000);
      bed = null;
    }
    var B = BEDS[name];
    if (!B) return;
    var g = ctx.createGain(), srcs = [];
    g.gain.value = 0; g.gain.setTargetAtTime(1, t, 0.8); g.connect(N.amb);
    var n = B.n, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), ng = ctx.createGain();
    src.buffer = loopNoise(n[0]); src.loop = true; src.loopStart = 0; src.playbackRate.value = 1;
    f.type = n[1]; f.frequency.value = n[2]; f.Q.value = n[3]; ng.gain.value = n[4];
    src.connect(f); f.connect(ng); ng.connect(g);
    var lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = n[5]; lg.gain.value = n[6]; lfo.connect(lg); lg.connect(f.frequency);
    src.start(t, MB.fx.uniform(0, 3)); lfo.start(t); srcs.push(src, lfo);
    if (B.hum) B.hum[0].forEach(function (hz, k) {
      var o = ctx.createOscillator(), hg = ctx.createGain();
      o.type = k ? 'sine' : 'sawtooth'; o.frequency.value = hz; hg.gain.value = B.hum[1] / (k + 1);
      var hf = ctx.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 420;
      o.connect(hf); hf.connect(hg); hg.connect(g); o.start(t); srcs.push(o);
    });
    bed = { g: g, srcs: srcs };
  }

  /* ------------------------------------------------------------------ the director */
  var I = 0.3, cut = 20000, simRef = null, bossWave = -1, bossOn = false, waveSeen = -1, lastSec = 99, riserWave = -1;
  var heartT = 0, oneShotT = 2;
  function songFor(app) {
    var sc = app.screen, s = app.sim;
    if (ATTRACT[sc] || !s) return ['menu', 0, false];
    if (sc === 'intro') return ['story', 0, false];
    if (sc === 'shop') return ['shop', 0, false];
    if (sc === 'preview') return [app.story && !app.settings.skipStory ? 'story' : 'brief', 0, false];
    if (sc === 'gameover') return ['flatline', 0, false];
    if (sc === 'ending') {
      var e = app.ending;
      if (!e || e.stage === 'lead' || e.stage === 'choice') return ['vault', 0, false];
      return [e.choice === 'plug' ? 'plug' : 'smash', 0, false];
    }
    if (bossOn) return ['boss', SG.BOSS_KEY[Math.min(3, Math.floor((s.wave - 1) / 5))], true];
    return [SG.DISTRICT[s.biome] || 'neon', 0, true];
  }

  A.update = function (app, dt) {
    if (!ctx) return;
    var sc = app.screen, s = app.sim, playing = (sc === 'play' || sc === 'pause') && s;
    if (s !== simRef) { simRef = s; waveSeen = -1; bossWave = -1; bossOn = false; lastSec = 99; riserWave = -1; }
    var p = s ? s.players[app.slot] : null, live = playing && s.phase === 'play' && app.deathT <= 0;
    if (live) {
      if (s.wave !== bossWave) { bossWave = s.wave; bossOn = false; bossDowns = 0; }
      if (!bossOn && s.wave % 5 === 0) {
        for (var i = 0; i < s.enemies.length; i++) if (s.enemies[i].etype === 'overlord') { bossOn = true; break; }
        if (bossOn) { play('bossEnter'); duck(0.3, 2.4); }
      }
    }
    // music: a dying run keeps its song until game over
    if (!(playing && app.deathT > 0)) {
      var w = songFor(app), c = MB.music.current(), fight = c && (c.id === 'boss' || FIGHT[c.id]);
      MB.music.play(w[0], { transpose: w[1], sync: w[2] && sc === 'play' && fight });
    }
    // intensity follows the crowd, the clock and the boss
    var tgt = 0.4;
    if (live) {
      tgt = 0.22 + Math.min(1, s.enemies.length / 26) * 0.5 + (s.waveTime < 12 ? 0.28 * (1 - s.waveTime / 12) : 0);
      if (s.wave > ST.last) tgt += 0.15;
      if (bossOn) tgt = 1;
    } else if (sc === 'ending' && app.ending) tgt = app.ending.stage === 'choice' ? 0.95 : 0.45;
    I += (tgt - I) * Math.min(1, dt * 0.6);
    MB.music.intensity(I);
    // filters: pause and death close the low-pass, low HP half-closes it
    var lowHp = live && p && p.alive && p.hp / p.max_hp < 0.3;
    var want = sc === 'pause' ? 700 : playing && app.deathT > 0 ? 260 : lowHp ? 2400 : 20000;
    if (want !== cut) { N.muffle.frequency.setTargetAtTime(want, ctx.currentTime, want < cut ? 0.06 : 0.3); cut = want; }
    if (!live) { ambience(playing ? s.biome : null); return; }
    ambience(s.biome);
    // contract start stinger, the last-seconds riser and countdown
    if (s.wave !== waveSeen && app.bannerT > 1.5) { waveSeen = s.wave; play('waveStart'); }
    if (s.waveTime < 4.3 && s.waveTime > 3.5 && riserWave !== s.wave) { riserWave = s.wave; play('riser'); }
    var sec = Math.ceil(s.waveTime);
    if (sec !== lastSec) { if (sec >= 1 && sec <= 5 && sec === lastSec - 1) play(sec === 1 ? 'tickLast' : 'tick'); lastSec = sec; }
    if (lowHp) { heartT -= dt; if (heartT <= 0) { play('heart'); heartT = 0.55 + 1.6 * p.hp / p.max_hp; } } else heartT = 0;
    // district one-shots: rain drops, a far siren, reactor sparks
    oneShotT -= dt;
    if (oneShotT <= 0) {
      var x = MB.fx.uniform(0, W);
      if (s.biome === 'Rain Alley') { play('drip', { x: x }); oneShotT = MB.fx.uniform(0.08, 0.5); }
      else if (s.biome === 'Midnight District') { play('siren', { x: x }); oneShotT = MB.fx.uniform(18, 40); }
      else if (s.biome === 'Reactor Core') { play('spark', { x: x }); oneShotT = MB.fx.uniform(0.6, 2.6); }
      else oneShotT = 5;
    }
  };

  /* ------------------------------------------------------------------ menus and dialogue */
  A.ui = function (name, o) { return play(name, o); };
  A.click = function () { play('uiClick'); };
  A.hover = function () { play('uiHover'); };
  // One speech blip per few letters while a line types out; voices differ by timbre and pitch.
  A.blip = function (who, ch) {
    if (!ch || ch === ' ' || '.,!?\'"-:;'.indexOf(ch) >= 0) return;
    var v = SND.voice[who] || SND.voice.DOC;
    play(v.snd, { rate: v.rate, jit: 1.2, verb: v.verb || 0 });
  };
  A.unlock = unlock;
  A.stats = function () {
    return {
      ctx: ctx ? ctx.state : 'none', played: st.played, dropped: st.dropped, skipped: st.skipped, rendered: st.rendered,
      pending: queue.length, voices: voices.length, music: MB.music.current(), intensity: I, cut: cut, ambience: bedName
    };
  };
})();
