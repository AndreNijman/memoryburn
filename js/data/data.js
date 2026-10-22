/*
 * MemoryBurn - js/data/data.js
 *
 * Content and tuning, ported value-for-value from the original pygame build (reference/MemoryBurn.py).
 * The story is new and lives in js/data/story.js.
 * Shared by sim, render and UI so numbers cannot drift.
 */
(function () {
  'use strict';
  var D = MB.data;

  D.VIRTUAL_W = 1920;
  D.VIRTUAL_H = 1080;
  D.WAVE_TIME = 32;
  D.STARTING_CASH = 25;
  D.STEP = 1 / 60; // fixed sim step (original ran variable dt capped at 0.05)

  D.RARITY_COL = { common: '#78a0c8', uncommon: '#50f0c8', rare: '#78dcff', epic: '#ff8cf0' };
  D.RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic'];

  D.DIFFICULTIES = ['Normal', 'Hard', 'Insane'];
  D.DIFF_MUL = { Normal: 1.0, Hard: 1.25, Insane: 1.5 };

  // Archetypes. `id` and `blurb` are new (sprite index + menu flavour); every stat is the original.
  D.ARCHETYPES = [
    { id: 0, name: 'Netrunner (Deck)', desc: 'Data spikes. Balanced.', base_cd: 0.38, dmg_mul: 1.1, atkspd_mul: 1.1, bullet_speed_add: 220, spread: 0.06, range_px: 900, color: '#e6f0ff' },
    { id: 1, name: 'Solo (Scattergun)', desc: 'Close quarters. Big HP.', hp_mul: 1.35, base_cd: 0.6, dmg_mul: 1.3, spd_mul: 0.9, spread: 0.14, range_px: 520, color: '#ffe6a0' },
    { id: 2, name: 'Courier (SMG)', desc: 'Very fast. Low per shot.', spd_mul: 1.2, base_cd: 0.22, dmg_mul: 0.75, atkspd_mul: 1.2, spread: 0.08, range_px: 700, color: '#c8e6ff' },
    { id: 3, name: 'Vamp (Ion Beam)', desc: 'Piercing ion beam. Lifesteal.', base_cd: 0.48, dmg_mul: 1.15, lifesteal_add: 0.08, spread: 0.08, range_px: 1000, color: '#8cdcff' },
    { id: 4, name: 'Techno Monk', desc: 'Calm aim. Fewer bullets, harder hits.', base_cd: 0.44, dmg_mul: 1.35, atkspd_mul: 0.95, spread: 0.04, range_px: 800, color: '#7af0ff' },
    { id: 5, name: 'Riot Runner', desc: 'Extreme mobility. Fragile.', spd_mul: 1.4, base_cd: 0.26, dmg_mul: 0.85, atkspd_mul: 1.25, bullet_speed_add: 120, spread: 0.09, range_px: 750, color: '#ffffff' },
    { id: 6, name: 'Steel Witch', desc: 'Slow cast. Heavy pierce.', base_cd: 0.7, dmg_mul: 1.55, atkspd_mul: 0.85, bullet_speed_add: 260, spread: 0.05, range_px: 950, color: '#e0c8ff' },
    { id: 7, name: 'Junk Saint', desc: 'Tanky scav. Big pickup radius.', hp_mul: 1.5, base_cd: 0.5, dmg_mul: 1.05, pickup_add: 160, spread: 0.1, range_px: 650, color: '#ffd890' }
  ];

  function it(name, stat, amt, cost, desc, rarity) { return { name: name, '+stat': stat, '+amt': amt, cost: cost, desc: desc, rarity: rarity }; }
  function mods(name, list, cost, desc, rarity) { return { name: name, mods: list, cost: cost, desc: desc, rarity: rarity }; }

  D.ITEM_POOL = [
    mods('Cursed Contract', [{ stat: 'damage', kind: 'percent', amt: 18 }, { stat: 'luck', amt: -10 }], 44, '+18% damage, -10 Luck', 'uncommon'),
    mods('Hexed Cartridge', [{ stat: 'crit_mult', amt: 0.25 }, { stat: 'luck', amt: -8 }], 48, '+0.25x crit, -8 Luck', 'uncommon'),
    it('Lucky Chip', 'luck', 8, 60, '+8 Luck', 'common'),
    it('Rabbit Foot', 'luck', 15, 110, '+15 Luck', 'rare'),
    it('Sharpened Logic', 'crit_chance', 0.08, 52, '+8% Crit Chance', 'uncommon'),
    it('Overvolt Lens', 'crit_mult', 0.4, 62, '+0.4x Crit Damage', 'rare'),
    mods('Glass Processor', [{ stat: 'damage', kind: 'percent', amt: 35 }, { stat: 'max_hp', kind: 'percent', amt: -20 }], 42, '+35% damage, -20% max HP', 'uncommon'),
    mods('Heavy Armor Kit', [{ stat: 'armor', amt: 4 }, { stat: 'speed', amt: -80 }], 44, '+4 armor, -80 speed', 'uncommon'),
    mods('Recoil Dampener', [{ stat: 'attack_speed', amt: -0.12 }, { stat: 'damage', kind: 'percent', amt: 20 }], 40, '+20% damage, -0.12 atkspd', 'uncommon'),
    mods('Hollow Battery', [{ stat: 'attack_speed', amt: 0.35 }, { stat: 'max_hp', amt: -10 }], 46, '+0.35 atkspd, -10 max HP', 'rare'),
    mods('Lead Boots', [{ stat: 'armor', amt: 2 }, { stat: 'speed', amt: -120 }], 30, '+2 armor, -120 speed', 'common'),
    mods('Gilded Magnet', [{ stat: 'pickup', amt: 180 }, { stat: 'damage', kind: 'percent', amt: -10 }], 28, '+180 pickup, -10% damage', 'common'),
    it('Overclock Gel', 'damage', 6, 26, '+6% firepower', 'common'),
    it('Auto-Loader', 'attack_speed', 0.18, 30, '+18% rate of fire', 'common'),
    it('Kinetic Boots', 'speed', 60, 24, '+60 sprint', 'common'),
    it('Reactive Plating', 'armor', 3, 28, '+3 plating', 'uncommon'),
    it('Nano-Injector', 'max_hp', 15, 22, '+15 max HP', 'common'),
    it('Vacuum Drone', 'pickup', 80, 18, '+80 loot radius', 'common'),
    it('Hemopump', 'lifesteal', 0.08, 30, '+8% siphon', 'uncommon'),
    it('Gyro Stabilizer', 'bullet_speed', 160, 24, '+160 projectile speed', 'common'),
    it('Fork Module', 'bullets', 1, 44, '+1 projectile', 'rare'),
    it('Clock Signal', 'attack_speed', 0.35, 55, '+35% rate of fire', 'rare'),
    it('Adrenal Surge', 'speed', 120, 60, '+120 sprint', 'epic'),
    it('Drone: Gunpod', 'pet', 'turret_buddy', 120, 'Orbiting turret that shoots.', 'epic'),
    it('Drone: VacuBot', 'pet', 'magnet_drone', 110, 'Orbiting drone that boosts pickup.', 'rare'),
    it('Drone: Medbot', 'pet', 'heal_bot', 130, 'Orbiting bot that heals over time.', 'epic'),
    it('Street Prophet Ink', 'damage', 9, 34, '+9% firepower', 'uncommon'),
    it('Servo Fingers', 'attack_speed', 0.22, 36, '+22% rate of fire', 'uncommon'),
    it('Grav Skates', 'speed', 90, 38, '+90 sprint', 'uncommon'),
    it('Titan Ribbing', 'armor', 5, 46, '+5 plating', 'rare'),
    it('Blood Synth', 'max_hp', 25, 40, '+25 max HP', 'uncommon'),
    it('Wideband Magnet', 'pickup', 140, 42, '+140 loot radius', 'rare'),
    it('Hemoverse v2', 'lifesteal', 0.12, 58, '+12% siphon', 'rare'),
    it('Rail Guide', 'bullet_speed', 260, 40, '+260 projectile speed', 'uncommon'),
    it('Fork Array', 'bullets', 2, 88, '+2 projectiles', 'epic'),
    it('Chrono Loop', 'attack_speed', 0.5, 92, '+50% rate of fire', 'epic'),
    it('Blackline Booster', 'speed', 160, 90, '+160 sprint', 'epic'),
    it('Drone: Twin Gunpods', 'pet', 'turret_buddy', 180, 'Adds another turret-buddy.', 'epic'),
    it('Drone: OmniVac', 'pet', 'magnet_drone', 150, 'Adds another magnet drone.', 'rare'),
    it('Drone: Meds 2.0', 'pet', 'heal_bot', 170, 'Adds another med bot.', 'epic'),
    it('Regen Chip', 'health_regen', 0.5, 45, '+0.5 HP/s regen', 'uncommon'),
    mods('Nanite Core', [{ stat: 'health_regen', amt: 1.2 }, { stat: 'speed', amt: -60 }], 70, '+1.2 HP/s regen, -60 speed', 'rare')
  ];
  D.ITEM_POOL.forEach(function (item, i) { item.idx = i; });

  // Shop icon per stat (sprite key icon:<stat>); items with several mods use the first one.
  D.itemIcon = function (item) {
    if (item['+stat'] === 'pet') return 'pet:' + item['+amt'];
    var s = item['+stat'] || (item.mods && item.mods[0].stat) || 'damage';
    return 'icon:' + s;
  };

  D.BIOMES = {
    'Neon Grid': { bg: [10, 12, 18], notes: 'Clean lanes. Standard.', player_spd_mul: 1.0, bullet_spd_mul: 1.0 },
    'Rain Alley': { bg: [12, 16, 24], notes: 'Slick streets. Lower friction.', player_spd_mul: 1.05, friction: 0.985, snow: true },
    'Dust Slums': { bg: [28, 24, 20], notes: 'Grime. Lower pickup.', player_spd_mul: 0.95, pickup_mul: 0.8, dust: true },
    'Vine Mesh': { bg: [16, 28, 24], notes: 'Constricting cables. Slow pulses.', player_spd_mul: 0.95, pulse_slow: 0.8 },
    'Jetstream': { bg: [14, 16, 26], notes: 'Crosswind from air vents.', bullet_spd_mul: 0.95, wind: true },
    'Reactor Core': { bg: [26, 10, 14], notes: 'Heat bleed. Minor HP drain.', hp_drain: 0.5, embers: true },
    'Midnight District': { bg: [8, 10, 16], notes: 'Dim cams. More spawns.', spawn_mul: 1.1, dim: 0.25 }
  };
  D.BIOME_NAMES = Object.keys(D.BIOMES);

  D.ENEMY_KINDS = ['scrap', 'brute', 'skater', 'suicide', 'aegis', 'sentry'];
  D.ENEMY_WEIGHTS = [5, 3, 3, 2, 2, 2];
  D.ENEMY_INFO = {
    scrap: { name: 'Scrap', blurb: 'Basic rush bot.' },
    brute: { name: 'Brute', blurb: 'Accelerates when close.' },
    skater: { name: 'Skater', blurb: 'Zig-zags erratically.' },
    suicide: { name: 'Suicide', blurb: 'Bursts shrapnel up close.' },
    aegis: { name: 'Aegis', blurb: 'Shield blocks shots.' },
    sentry: { name: 'Sentry', blurb: 'Stationary shooter.' },
    overlord: { name: 'Overlord', blurb: 'Big HP, radial shots.' }
  };

  D.QUESTS = {
    NoHit: { label: "Don't get hit for 12s", target: 12.0 },
    Collect: { label: 'Collect 15 materials', target: 15 },
    Kills: { label: 'Kill 40 enemies', target: 40 }
  };
})();
