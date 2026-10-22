# Memory Burn: sound

The game ships no audio files. The code synthesizes every sound effect when the page loads and plays every song live from note data. Five files hold it all:

| File | What it holds |
| --- | --- |
| `js/audio/dsp.js` | An offline synth that renders a list of layers into a sample buffer. It runs without a DOM, so the headless tests use it too. |
| `js/audio/sounds.js` | 63 sound recipes, the dialogue voices, and the drum kits the songs use. |
| `js/audio/songs.js` | Synth patches, scales, the memory motif and 16 songs. |
| `js/audio/music.js` | The sequencer: a look-ahead scheduler that plays a song with live Web Audio voices. |
| `js/audio/engine.js` | The AudioContext, the mixer, the event-to-sound mapping, ambience, and the director that picks the song. |

Audio reads sim events and app state and nothing else. It rolls dice with the cosmetic RNG, so a run with sound plays out exactly like a run without it, and the run hashes stay the same.

## Mix

```
music ─► duck ─┐
sfx ───────────┼─► muffle (low-pass) ─┐
ambience ──────┤                      ├─► master ─► glue compressor ─► limiter ─► speakers
reverb ────────┘                      │
ui, voice ────────────────────────────┘
```

- **Duck** dips the music for a moment when you take a hit, die, or kill a boss.
- **Muffle** closes to 700 Hz on the pause screen, 2400 Hz below 30% HP and 260 Hz on death. UI clicks and dialogue blips skip it, so menus stay crisp while the fight sounds far away.
- **Reverb** uses a generated stereo impulse. Sounds and patches set their own send level.
- **Volume** sliders (Master, Music, Sound Effects, 0 to 100) map through `(v / 100)^1.6`, so the low end of each slider stays usable. Settings save with the rest of Options.

The browser blocks audio until you click or press a key. The AudioContext starts on the first one and suspends when you switch tabs.

## Sound effects

Each recipe in `sounds.js` returns layers for `MB.dsp.render`: oscillators (sine, triangle, saw, square, noise, pink, brown, metallic), pitch sweeps, a filter with its own sweep, FM, vibrato, tremolo, drive, and repeats. A post stage adds echo, sample-rate reduction or bit crushing. Each recipe renders three variants by default, and playback adds a small random pitch shift, so the 400th shot still sounds different from the 399th.

The engine renders the bank in 6 ms slices after the context starts, common sounds first. It caps playback at 32 voices and steals the lowest-priority one when full. A per-sound `gap` stops a sound from stacking faster than it can be heard. Sounds pan with their position in the arena.

| Event | Sound |
| --- | --- |
| A player shoots | `gun0` to `gun7`, one per archetype |
| Hit, crit, blocked hit | `hit`, `crit`, `block` |
| An enemy dies | `kill_<kind>`, plus `elite` for elites, `bossDown` for the first Overlord kill in a wave |
| Explosions, portals, enemy shots | `explode`, `portal`, `portalBoss`, `eshoot`, `eshootBig` |
| You get hurt, heal, dash or die | `hurt`, `heal`, `dash`, `death` |
| Pickups | `pickup_mat` climbs a pentatonic scale as you chain them; `pickup_xp`, `pickup_heal` |
| Wave flow | `waveStart`, a `riser` into the fight, `tick` and `tickLast` for the last five seconds, `waveClear`, `questDone`, `questFail` |
| Low HP | `heart`, a heartbeat that speeds up as HP drops |
| Shop and menus | `buy`, `reroll`, `lock`, `unlock`, `deny`, `uiHover`, `uiClick`, `uiBack`, toggles, slider ticks, `pageTurn` |
| Ending | `plug`, `smash` |

Every district also has an ambience bed: looped filtered noise with a slow LFO and a hum, plus occasional one-shots (drips in Rain Alley, sirens in Midnight District, sparks in Reactor Core).

### Dialogue voices

Story panels and the radio blip as text types out, one blip every three or four letters. Each speaker has a voice: a waveform and a pitch.

| Speaker | Voice |
| --- | --- |
| Doc | square, 1.05 |
| Lucky | saw, 0.82, lower and buzzier |
| Lethe | FM bell, 1.18, bright and polished |
| Ren | triangle, 1.3 |
| Nine | square, 0.74 |
| Fragment | triangle, 0.9, with heavy reverb |
| The Appraiser, the Auctioneer, the Archivist | saw or FM, pitched low (0.6 to 0.68) |

Punctuation and spaces stay silent, and each blip picks one of six variants that step up a scale, with a random pitch wobble on top.

## Soundtrack

### The memory motif

Every song quotes one four-bar tune, `MOTIF` in `songs.js`. In A minor it runs E C B A G, A C E A G E, E F E C B, A. Each song plays it in its own key, scale and tempo, so the district songs sound unrelated until you notice the tune. The plug ending plays it whole in major. The smash ending plays its first bar on glass, waits, then plays only the last note, with the middle missing. Rain Alley plays the first half at half speed over the breakbeat.

### Songs

| Song | Title | Tempo | Scale | Plays |
| --- | --- | --- | --- | --- |
| `menu` | Forty Eddies a Hit | 100 | minor | title, options, character and difficulty screens |
| `story` | Doc's Table | 72 | dorian | story panels |
| `shop` | Back-Alley Market | 86 | dorian | the shop |
| `brief` | Contract | 120 | phrygian | the contract briefing |
| `neon` | Neon Grid | 128 | minor | Neon Grid |
| `rain` | Rain Alley | 172 | minor | Rain Alley (drum and bass) |
| `dust` | Dust Slums | 96 | phrygian dominant | Dust Slums |
| `vine` | Vine Mesh | 112 | dorian | Vine Mesh (3-against-4 percussion) |
| `jet` | Jetstream | 138 | minor | Jetstream |
| `core` | Reactor Core | 146 | phrygian | Reactor Core |
| `midnight` | Midnight District | 116 | minor | Midnight District |
| `boss` | Lethe & Sons | 160 | harmonic minor | boss waves; up 3, 5 and 7 semitones for each act |
| `vault` | Clause 14 | 76 | minor | the ending scene |
| `plug` | Everything Back | 80 | major | after you plug the shard in |
| `smash` | Nine | 64 | dorian | after you smash it |
| `flatline` | Flatline | 60 | minor | game over |

### How a fight song moves

Fight songs follow an intensity value from 0 to 1. The director computes it from the enemy count, the time left in the wave, Afterburn and the boss. Each part (drum line, bass, arp, pad, melody) has a `min` intensity. It joins at the next bar once intensity passes that value and drops out only when intensity falls 0.06 below it, so parts don't flicker in and out. Drums add a fill on the last bar of each four-bar phrase and a crash on the next downbeat.

When you move from one district to the next, the new song starts on the next bar line of the old one. Screen songs crossfade instead. The tempo ignores Game Speed.

## Adding a sound

1. Add a `def` in `js/audio/sounds.js`:

   ```js
   def('myThing', { bus: 'sfx', vol: 0.3, pri: 1, gap: 0.05 }, function (r, j, v) {
     return { layers: [{ w: 'saw', f: 440 * j, f1: 220, d: 0.2, g: 0.5, lp: 3000 }] };
   });
   ```

   `r` is a seeded random function for this variant, `j` a pitch jitter near 1 and `v` the variant index. `bus` is `sfx`, `ui`, `voice` or `music`. A higher `pri` survives voice stealing. The comment at the top of `dsp.js` lists every layer field.
2. Play it from the engine (`play('myThing', { x: e.x })` in `events` for a sim event) or from the UI (`MB.audio.ui('myThing')`).
3. Run `node tools/headless.mjs audio`. It renders every variant and fails on silence, clipping, NaN or anything longer than five seconds.

## Adding a song

1. Add an entry to `list` in `js/audio/songs.js`. The header comment explains each field. Bars are 16 steps; a melody bar is `degree:steps` tokens that must add up to 16.
2. Point the director at it in `songFor` in `js/audio/engine.js`, or add the district to `DISTRICT`.
3. Run `node tools/headless.mjs audio` to check the data, then `node tools/audiocheck.mjs <id>` to render it.
4. Set `gain` so the song lands between -17 and -20 dB RMS in the audiocheck table, like the others.

## Tests

```sh
node tools/headless.mjs audio   # renders all 63 sounds and checks every song's data, without a browser
node tools/audiocheck.mjs       # renders each song offline in Chromium at low and full intensity; prints a loudness table
node tools/playtest.mjs         # checks that the right song plays on each screen, district, boss wave and ending
node tools/bench.mjs --audio    # frame cost of the audio engine in a crowded wave 12
```

In a crowded wave 12 the engine costs about 0.07 ms per frame and drops no voices.
