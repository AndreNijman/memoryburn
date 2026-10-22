


import sys, os

def resource_path(rel):
    if hasattr(sys, '_MEIPASS'):
        return os.path.join(sys._MEIPASS, rel)
    return os.path.join(os.path.abspath('.'), rel)

import math, random
import pygame

VIRTUAL_W, VIRTUAL_H = (1920, 1080)
DEFAULT_FPS_CAP = 120
WAVE_TIME = 32
STARTING_CASH = 25

WHITE = (240, 240, 240)
GREY1 = (14, 14, 22)
GREY2 = (26, 28, 40)
GREY3 = (34, 36, 52)
GREEN = (100, 255, 200)
RED = (255, 70, 110)
YELLOW = (255, 230, 120)
BLUE = (120, 200, 255)
PURPLE = (255, 120, 255)
ORANGE = (255, 190, 120)
CYAN = (80, 255, 220)

RARITY_COL = {'common': (120, 160, 200), 'uncommon': (80, 240, 200), 'rare': (120, 220, 255), 'epic': (255, 140, 240)}

STATE_MENU = 0
STATE_CHAR_SELECT = 1
STATE_DIFFICULTY = 2
STATE_PLAY = 3
STATE_SHOP = 4
STATE_PREVIEW = 5
STATE_GAMEOVER = 6
STATE_PAUSE = 7
STATE_MENU_OPTS = 8

def clamp(a, lo, hi): return max(lo, min(hi, a))

class ScreenShake:
    def __init__(self): self.t, self.mag = 0, 0
    def add(self, mag, dur=0.15): self.t = max(self.t, dur); self.mag = max(self.mag, mag)
    def offset(self, rng):
        if self.t <= 0 or self.mag <= 0: return (0, 0)
        ang = rng.uniform(0, math.tau); m = self.mag * (self.t / 0.15)
        return (math.cos(ang) * m, math.sin(ang) * m)
    def update(self, dt): self.t = max(0, self.t - dt)

class Particle:
    def __init__(self, pos, vel, life, color, radius, grow=False):
        self.pos = pygame.math.Vector2(pos); self.vel = pygame.math.Vector2(vel)
        self.life = life; self.max_life = life; self.color = color; self.radius = radius; self.grow = grow
        d = radius * 2
        self._surf = pygame.Surface((d, d), pygame.SRCALPHA).convert_alpha()
        pygame.draw.circle(self._surf, (*color[:3], 255), (radius, radius), radius)
        self._scaled = self._surf; self._last_d = d
    def update(self, dt):
        self.pos += self.vel * dt; self.vel *= 0.98; self.life -= dt
    def draw(self, surf):
        if self.life <= 0: return
        t = self.life / self.max_life
        alpha = int(255 * t)
        r_scale = 1.0 + (1.2 if self.grow else 0) * (1 - t)
        d = max(2, int(self.radius * 2 * r_scale))
        if self._last_d != d:
            self._scaled = pygame.transform.smoothscale(self._surf, (d, d))
            self._last_d = d
        self._scaled.set_alpha(alpha)
        surf.blit(self._scaled, (self.pos.x - d // 2, self.pos.y - d // 2))

class Tracer:
    def __init__(self, a, b, life=0.08):
        self.a = pygame.math.Vector2(a); self.b = pygame.math.Vector2(b); self.life = life; self.max_life = life
    def update(self, dt): self.life -= dt
    def draw(self, surf):
        if self.life <= 0: return
        pygame.draw.line(surf, (255, 255, 255), self.a, self.b, 2)


class DmgText:
    def __init__(self, pos, text, color=(255, 240, 200), life=0.9):
        self.pos = pygame.math.Vector2(pos)
        self.vel = pygame.math.Vector2(0, -60)
        self.text = str(text)
        self.life = life
        self.max_life = life
        self.color = color
        self.alpha = 255
    def update(self, dt):
        self.pos += self.vel * dt
        self.life -= dt
        t = max(0.0, self.life / self.max_life)
        self.alpha = int(255 * t)
    def draw(self, surf, font):
        if self.life <= 0: return
        s = font.render(self.text, True, self.color)
        s.set_alpha(self.alpha)
        surf.blit(s, (self.pos.x - s.get_width() / 2, self.pos.y - s.get_height() / 2))


class Bullet(pygame.sprite.Sprite):
    def __init__(self, pos, vel, dmg, life=2.0, pierce=0, color=(240, 240, 255), radius=6):
        super().__init__()
        self.image = pygame.Surface((radius * 2, radius * 2), pygame.SRCALPHA).convert_alpha()
        pygame.draw.circle(self.image, color, (radius, radius), radius)
        self.rect = self.image.get_rect(center=pos)
        self.pos = pygame.math.Vector2(pos)
        self.prev = self.pos.xy
        self.vel = pygame.math.Vector2(vel)
        self.dmg = dmg; self.life = life; self.pierce = pierce
    def update(self, dt):
        self.prev = (self.pos.x, self.pos.y)
        self.pos += self.vel * dt; self.rect.center = (int(self.pos.x), int(self.pos.y))
        self.life -= dt
        if self.life <= 0 or self.pos.x < -60 or self.pos.x > VIRTUAL_W + 60 or self.pos.y < -60 or self.pos.y > VIRTUAL_H + 60: self.kill()


class EnemyBullet(pygame.sprite.Sprite):
    def __init__(self, pos, vel, dmg):
        super().__init__()
        self.image = pygame.Surface((10, 10), pygame.SRCALPHA).convert_alpha(); pygame.draw.circle(self.image, ORANGE, (5, 5), 5)
        self.rect = self.image.get_rect(center=pos); self.pos = pygame.math.Vector2(pos); self.vel = pygame.math.Vector2(vel); self.dmg = dmg; self.life = 3.5
    def update(self, dt):
        self.pos += self.vel * dt; self.rect.center = (int(self.pos.x), int(self.pos.y))
        self.life -= dt
        if self.life <= 0: self.kill()


LETTER_MAP = {'scrap': 'S', 'brute': 'B', 'skater': 'K', 'suicide': 'X', 'aegis': 'A', 'sentry': 'T', 'overlord': 'O'}

class Enemy(pygame.sprite.Sprite):
    def __init__(self, pos, hp, speed, dmg, color=RED, size=26, etype='scrap'):
        super().__init__()
        self.etype = etype
        self.size = size; self.max_hp = hp; self.hp = hp
        self.base_img = pygame.Surface((size, size), pygame.SRCALPHA).convert_alpha()
        pygame.draw.rect(self.base_img, color, (0, 0, size, size), border_radius=8)
        if etype == 'aegis': pygame.draw.rect(self.base_img, CYAN, (2, 2, size - 4, size - 4), 2, border_radius=8)
        if etype == 'overlord': pygame.draw.rect(self.base_img, (255, 220, 120), (2, 2, size - 4, size - 4), 2, border_radius=8)
        self.image = self.base_img.copy(); self.rect = self.image.get_rect(center=pos)
        self.pos = pygame.math.Vector2(pos); self.speed = speed; self.dmg = dmg
        self.hit_cool = 0; self.flash_t = 0; self.shoot_cd = 0; self.phase = random.random() * math.tau; self.shield_hp = 80 if etype == 'aegis' else 0
    def update(self, dt, player, enemy_bullets, rng, diff_mul):
        vec = player.pos - self.pos; d = vec.length(); vec_n = vec.normalize() if d > 1 else pygame.math.Vector2(0, 0)
        et = self.etype
        if et == 'scrap':
            self.pos += vec_n * self.speed * dt
        elif et == 'brute':
            self.pos += vec_n * self.speed * (1.8 if d < 300 else 1.0) * dt
        elif et == 'skater':
            perp = pygame.math.Vector2(-vec_n.y, vec_n.x); wob = math.sin(self.phase) * 0.6; self.phase += dt * 6.0
            self.pos += (vec_n * 0.9 + perp * wob) * self.speed * dt
        elif et == 'suicide':
            self.pos += vec_n * (self.speed * 0.75) * dt
            if d < 60:
                for i in range(8):
                    ang = rng.uniform(0, math.tau); enemy_bullets.add(EnemyBullet(self.pos, pygame.math.Vector2(math.cos(ang), math.sin(ang)) * 420, int(self.dmg * 0.8)))
                self.hp = 0
        elif et == 'sentry':
            self.shoot_cd -= dt
            if self.shoot_cd <= 0:
                self.shoot_cd = 1.6 / diff_mul
                if d > 0: enemy_bullets.add(EnemyBullet(self.pos, vec_n * 420, int(self.dmg)))
        elif et == 'overlord':
            self.shoot_cd -= dt; self.pos += vec_n * (self.speed * 0.8) * dt
            if self.shoot_cd <= 0:
                self.shoot_cd = 1.0 / diff_mul
                for i in range(8):
                    ang = i * (math.tau / 8.0); enemy_bullets.add(EnemyBullet(self.pos, pygame.math.Vector2(math.cos(ang), math.sin(ang)) * 380, int(self.dmg * 0.9)))
        self.rect.center = (int(self.pos.x), int(self.pos.y))
        if self.hit_cool > 0: self.hit_cool -= dt
        self.image = self.base_img.copy() if self.flash_t <= 0 else self.base_img.copy().convert_alpha()
        if self.flash_t > 0: self.flash_t -= dt

def spawn_enemy(rng, wave, kind=None):
    if kind is None:
        kinds = ['scrap', 'brute', 'skater', 'suicide', 'aegis', 'sentry']
        weights = [5, 3, 3, 2, 2, 2]
        kind = rng.choices(kinds, weights)[0]
    base = 14 + wave * 2.4 + (wave ** 1.18) * 0.55 + rng.randint(0, 6)
    hp = int(base * (1.0 if kind != 'aegis' else 1.8))
    speed = clamp(120 + wave * 6 + (wave ** 1.06) * 1.0 + rng.randint(-20, 20), 90, 520)
    if kind == 'sentry': speed = 40
    if kind == 'overlord': speed *= 0.7
    dmg = 7 + wave // 2 + (2 if kind in ('brute', 'suicide', 'overlord') else 0)
    size = 28 if kind != 'overlord' else 64
    color = {'scrap': RED, 'brute': (255, 100, 140), 'skater': (255, 180, 110), 'suicide': (255, 120, 120), 'aegis': CYAN, 'sentry': (200, 160, 220), 'overlord': PURPLE}[kind]
    margin = 40; edge = rng.randint(0, 3)
    pos = ((margin, rng.randint(margin, VIRTUAL_H - margin)) if edge == 0 else
           (VIRTUAL_W - margin, rng.randint(margin, VIRTUAL_H - margin)) if edge == 1 else
           (rng.randint(margin, VIRTUAL_W - margin), margin) if edge == 2 else
           (rng.randint(margin, VIRTUAL_W - margin), VIRTUAL_H - margin))
    return Enemy(pos, hp, speed, dmg, color=color, size=size, etype=kind)

class Pickup(pygame.sprite.Sprite):
    def __init__(self, pos, kind='mat', amount=1):
        super().__init__()
        self.kind = kind; self.amount = amount
        size = 12 if kind == 'mat' else 16
        self.base = pygame.Surface((size, size), pygame.SRCALPHA).convert_alpha()
        col = (90, 200, 90) if kind == 'mat' else (100, 180, 255) if kind == 'xp' else (200, 120, 240) if kind == 'heal' else (100, 180, 255)
        pygame.draw.circle(self.base, col, (size // 2, size // 2), size // 2)
        self.image = self.base.copy(); self.rect = self.image.get_rect(center=pos)
        self.pos = pygame.math.Vector2(pos); self.vel = pygame.math.Vector2(random.uniform(-60, 60), random.uniform(-60, 60)); self.t = 0
    def update(self, dt, player):
        self.t += dt; self.vel *= (1 - min(1, dt * 2))
        b = BIOMES[game.biome] if 'game' in globals() else {}
        pr_mul = b.get('pickup_mul', 1.0)
        to_p = player.pos - self.pos; d = to_p.length()
        if d < player.pickup_range * pr_mul:
            if d > 1: to_p = to_p.normalize()
            self.vel += to_p * 700 * dt
        self.pos += self.vel * dt; self.rect.center = (int(self.pos.x), int(self.pos.y))
        self.image = self.base; self.rect = self.image.get_rect(center=(int(self.pos.x), int(self.pos.y)))

class Pet:
    def __init__(self, kind):
        self.kind = kind; self.pos = pygame.math.Vector2(VIRTUAL_W / 2, VIRTUAL_H / 2); self.cd = 0
    def update(self, dt, player, bullets, rng):
        t = pygame.time.get_ticks() / 1000.0
        radius = 50 if self.kind == 'turret_buddy' else 70
        ang = t * 2.0 if self.kind != 'magnet_drone' else t * 1.5
        self.pos = player.pos + pygame.math.Vector2(math.cos(ang), math.sin(ang)) * radius
        if self.kind == 'turret_buddy':
            self.cd -= dt
            if self.cd <= 0:
                self.cd = 0.6; bullets.add(Bullet(self.pos, pygame.math.Vector2(900, 0).rotate(rng.uniform(0, 360)), dmg=8, life=1.2, color=(255, 230, 180), radius=5))
        elif self.kind == 'magnet_drone':
            player.pickup_range += 40 * dt
        elif self.kind == 'heal_bot':
            self.cd -= dt
            if self.cd <= 0: self.cd = 2.8; player.hp = min(player.max_hp, player.hp + 2)

ARCHETYPES = [
    {'name': 'Netrunner (Deck)', 'desc': 'Data spikes. Balanced.', 'base_cd': 0.38, 'dmg_mul': 1.1, 'atkspd_mul': 1.1, 'bullet_speed_add': 220, 'spread': 0.06, 'range_px': 900},
    {'name': 'Solo (Scattergun)', 'desc': 'Close quarters. Big HP.', 'hp_mul': 1.35, 'base_cd': 0.6, 'dmg_mul': 1.3, 'spd_mul': 0.9, 'spread': 0.14, 'range_px': 520},
    {'name': 'Courier (SMG)', 'desc': 'Very fast. Low per shot.', 'spd_mul': 1.2, 'base_cd': 0.22, 'dmg_mul': 0.75, 'atkspd_mul': 1.2, 'spread': 0.08, 'range_px': 700},
    {'name': 'Vamp (Ion Beam)', 'desc': 'Piercing ion beam. Lifesteal.', 'base_cd': 0.48, 'dmg_mul': 1.15, 'lifesteal_add': 0.08, 'spread': 0.08, 'range_px': 1000},

    {'name': 'Techno Monk', 'desc': 'Calm aim. Fewer bullets, harder hits.', 'base_cd': 0.44, 'dmg_mul': 1.35, 'atkspd_mul': 0.95, 'spread': 0.04, 'range_px': 800},
    {'name': 'Riot Runner', 'desc': 'Extreme mobility. Fragile.', 'spd_mul': 1.4, 'base_cd': 0.26, 'dmg_mul': 0.85, 'atkspd_mul': 1.25, 'bullet_speed_add': 120, 'spread': 0.09, 'range_px': 750},
    {'name': 'Steel Witch', 'desc': 'Slow cast. Heavy pierce.', 'base_cd': 0.7, 'dmg_mul': 1.55, 'atkspd_mul': 0.85, 'bullet_speed_add': 260, 'spread': 0.05, 'range_px': 950},
    {'name': 'Junk Saint', 'desc': 'Tanky scav. Big pickup radius.', 'hp_mul': 1.5, 'base_cd': 0.5, 'dmg_mul': 1.05, 'pickup_add': 160, 'spread': 0.1, 'range_px': 650},
]


ITEM_POOL = [
    {'name': 'Cursed Contract', 'mods': [{'stat': 'damage', 'kind': 'percent', 'amt': 18}, {'stat': 'luck', 'amt': -10}], 'cost': 44, 'desc': '+18% damage, -10 Luck', 'rarity': 'uncommon'},
    {'name': 'Hexed Cartridge', 'mods': [{'stat': 'crit_mult', 'amt': 0.25}, {'stat': 'luck', 'amt': -8}], 'cost': 48, 'desc': '+0.25x crit, -8 Luck', 'rarity': 'uncommon'},

    {'name': 'Lucky Chip', '+stat': 'luck', '+amt': 8, 'cost': 60, 'desc': '+8 Luck', 'rarity': 'common'},
    {'name': 'Rabbit Foot', '+stat': 'luck', '+amt': 15, 'cost': 110, 'desc': '+15 Luck', 'rarity': 'rare'},
    {'name': 'Sharpened Logic', '+stat': 'crit_chance', '+amt': 0.08, 'cost': 52, 'desc': '+8% Crit Chance', 'rarity': 'uncommon'},
    {'name': 'Overvolt Lens', '+stat': 'crit_mult', '+amt': 0.4, 'cost': 62, 'desc': '+0.4x Crit Damage', 'rarity': 'rare'},


    {'name': 'Glass Processor', 'mods': [{'stat': 'damage', 'kind': 'percent', 'amt': 35}, {'stat': 'max_hp', 'kind': 'percent', 'amt': -20}], 'cost': 42, 'desc': '+35% damage, -20% max HP', 'rarity': 'uncommon'},
    {'name': 'Heavy Armor Kit', 'mods': [{'stat': 'armor', 'amt': 4}, {'stat': 'speed', 'amt': -80}], 'cost': 44, 'desc': '+4 armor, -80 speed', 'rarity': 'uncommon'},
    {'name': 'Recoil Dampener', 'mods': [{'stat': 'attack_speed', 'amt': -0.12}, {'stat': 'damage', 'kind': 'percent', 'amt': 20}], 'cost': 40, 'desc': '+20% damage, -0.12 atkspd', 'rarity': 'uncommon'},
    {'name': 'Hollow Battery', 'mods': [{'stat': 'attack_speed', 'amt': 0.35}, {'stat': 'max_hp', 'amt': -10}], 'cost': 46, 'desc': '+0.35 atkspd, -10 max HP', 'rarity': 'rare'},
    {'name': 'Lead Boots', 'mods': [{'stat': 'armor', 'amt': 2}, {'stat': 'speed', 'amt': -120}], 'cost': 30, 'desc': '+2 armor, -120 speed', 'rarity': 'common'},
    {'name': 'Gilded Magnet', 'mods': [{'stat': 'pickup', 'amt': 180}, {'stat': 'damage', 'kind': 'percent', 'amt': -10}], 'cost': 28, 'desc': '+180 pickup, -10% damage', 'rarity': 'common'},


    {'name': 'Overclock Gel', '+stat': 'damage', '+amt': 6, 'cost': 26, 'desc': '+6% firepower', 'rarity': 'common'},
    {'name': 'Auto-Loader', '+stat': 'attack_speed', '+amt': 0.18, 'cost': 30, 'desc': '+18% rate of fire', 'rarity': 'common'},
    {'name': 'Kinetic Boots', '+stat': 'speed', '+amt': 60, 'cost': 24, 'desc': '+60 sprint', 'rarity': 'common'},
    {'name': 'Reactive Plating', '+stat': 'armor', '+amt': 3, 'cost': 28, 'desc': '+3 plating', 'rarity': 'uncommon'},
    {'name': 'Nano-Injector', '+stat': 'max_hp', '+amt': 15, 'cost': 22, 'desc': '+15 max HP', 'rarity': 'common'},
    {'name': 'Vacuum Drone', '+stat': 'pickup', '+amt': 80, 'cost': 18, 'desc': '+80 loot radius', 'rarity': 'common'},
    {'name': 'Hemopump', '+stat': 'lifesteal', '+amt': 0.08, 'cost': 30, 'desc': '+8% siphon', 'rarity': 'uncommon'},
    {'name': 'Gyro Stabilizer', '+stat': 'bullet_speed', '+amt': 160, 'cost': 24, 'desc': '+160 projectile speed', 'rarity': 'common'},
    {'name': 'Fork Module', '+stat': 'bullets', '+amt': 1, 'cost': 44, 'desc': '+1 projectile', 'rarity': 'rare'},
    {'name': 'Clock Signal', '+stat': 'attack_speed', '+amt': 0.35, 'cost': 55, 'desc': '+35% rate of fire', 'rarity': 'rare'},
    {'name': 'Adrenal Surge', '+stat': 'speed', '+amt': 120, 'cost': 60, 'desc': '+120 sprint', 'rarity': 'epic'},
    {'name': 'Drone: Gunpod', '+stat': 'pet', '+amt': 'turret_buddy', 'cost': 120, 'desc': 'Orbiting turret that shoots.', 'rarity': 'epic'},
    {'name': 'Drone: VacuBot', '+stat': 'pet', '+amt': 'magnet_drone', 'cost': 110, 'desc': 'Orbiting drone that boosts pickup.', 'rarity': 'rare'},
    {'name': 'Drone: Medbot', '+stat': 'pet', '+amt': 'heal_bot', 'cost': 130, 'desc': 'Orbiting bot that heals over time.', 'rarity': 'epic'},


    {'name': 'Street Prophet Ink', '+stat': 'damage', '+amt': 9, 'cost': 34, 'desc': '+9% firepower', 'rarity': 'uncommon'},
    {'name': 'Servo Fingers', '+stat': 'attack_speed', '+amt': 0.22, 'cost': 36, 'desc': '+22% rate of fire', 'rarity': 'uncommon'},
    {'name': 'Grav Skates', '+stat': 'speed', '+amt': 90, 'cost': 38, 'desc': '+90 sprint', 'rarity': 'uncommon'},
    {'name': 'Titan Ribbing', '+stat': 'armor', '+amt': 5, 'cost': 46, 'desc': '+5 plating', 'rarity': 'rare'},
    {'name': 'Blood Synth', '+stat': 'max_hp', '+amt': 25, 'cost': 40, 'desc': '+25 max HP', 'rarity': 'uncommon'},
    {'name': 'Wideband Magnet', '+stat': 'pickup', '+amt': 140, 'cost': 42, 'desc': '+140 loot radius', 'rarity': 'rare'},
    {'name': 'Hemoverse v2', '+stat': 'lifesteal', '+amt': 0.12, 'cost': 58, 'desc': '+12% siphon', 'rarity': 'rare'},
    {'name': 'Rail Guide', '+stat': 'bullet_speed', '+amt': 260, 'cost': 40, 'desc': '+260 projectile speed', 'rarity': 'uncommon'},
    {'name': 'Fork Array', '+stat': 'bullets', '+amt': 2, 'cost': 88, 'desc': '+2 projectiles', 'rarity': 'epic'},
    {'name': 'Chrono Loop', '+stat': 'attack_speed', '+amt': 0.5, 'cost': 92, 'desc': '+50% rate of fire', 'rarity': 'epic'},
    {'name': 'Blackline Booster', '+stat': 'speed', '+amt': 160, 'cost': 90, 'desc': '+160 sprint', 'rarity': 'epic'},
    {'name': 'Drone: Twin Gunpods', '+stat': 'pet', '+amt': 'turret_buddy', 'cost': 180, 'desc': 'Adds another turret-buddy.', 'rarity': 'epic'},
    {'name': 'Drone: OmniVac', '+stat': 'pet', '+amt': 'magnet_drone', 'cost': 150, 'desc': 'Adds another magnet drone.', 'rarity': 'rare'},
    {'name': 'Drone: Meds 2.0', '+stat': 'pet', '+amt': 'heal_bot', 'cost': 170, 'desc': 'Adds another med bot.', 'rarity': 'epic'},
    {'name': 'Regen Chip', '+stat': 'health_regen', '+amt': 0.5, 'cost': 45, 'desc': '+0.5 HP/s regen', 'rarity': 'uncommon'},
    {'name': 'Nanite Core', 'mods': [{'stat': 'health_regen', 'amt': 1.2}, {'stat': 'speed', 'amt': -60}], 'cost': 70, 'desc': '+1.2 HP/s regen, -60 speed', 'rarity': 'rare'},
]

def roll_items(rng, n=3, wave=1, luck=0):
    pool = ITEM_POOL[:]
    base = {'common': 5, 'uncommon': 3, 'rare': 2, 'epic': 1}
    bias_cu = max(0, wave // 3)
    bias_ur = max(0, wave // 5)
    weights = {}

    luck = max(0, int(luck))
    eff = min(luck, 100)
    luck_mul_rare = 1.0 + eff * 0.012
    luck_mul_epic = 1.0 + eff * 0.018
    luck_mul_common = max(0.35, 1.0 - eff * 0.007)
    luck_mul_uncommon = max(0.45, 1.0 - eff * 0.0055)

    for it in pool:
        r = it['rarity']
        w = base[r]
        if r == 'common':
            w = max(1, w - bias_cu)
            w = max(1, int(w * luck_mul_common))
        if r == 'uncommon':
            w = max(1, w - bias_ur)
            w = max(1, int(w * luck_mul_uncommon))
        if r == 'rare':
            w = w + wave // 7
            w = max(1, int(w * luck_mul_rare))
        if r == 'epic':
            w = w + wave // 9
            w = max(1, int(w * luck_mul_epic))
        weights[it['name']] = w

    rng.shuffle(pool)
    pool.sort(key=lambda it: weights[it['name']], reverse=True)
    return [pool[i] for i in range(min(n, len(pool)))]

def apply_item(p, item, game):

    if '+stat' in item:
        stat = item.get('+stat'); amt = item.get('+amt')
        if stat == 'damage': p.damage = int(p.damage * (1 + amt / 100.0))
        elif stat == 'attack_speed': p.attack_speed += amt
        elif stat == 'speed': p.speed += amt
        elif stat == 'armor': p.armor += int(amt)
        elif stat == 'max_hp': p.max_hp += int(amt); p.hp += int(max(0, amt))
        elif stat == 'pickup': p.pickup_range += amt
        elif stat == 'lifesteal': p.lifesteal += amt
        elif stat == 'bullet_speed': p.bullet_speed += amt
        elif stat == 'bullets': p.bullets = clamp(int(p.bullets) + int(amt), 1, 16)
        elif stat == 'pet': game.pets.append(Pet(amt))
        elif stat == 'luck': p.luck += int(amt)
        elif stat == 'crit_chance': p.crit_chance = max(0.0, min(0.95, p.crit_chance + float(amt)))
        elif stat == 'crit_mult': p.crit_mult += float(amt)
        elif stat == 'health_regen': p.health_regen += float(amt)
        return

    mods = item.get('mods', [])
    for m in mods:
        stat = m.get('stat'); kind = m.get('kind', 'flat'); amt = m.get('amt', 0)
        if stat in ('luck', 'crit_chance', 'crit_mult'):
            if stat == 'luck':
                if kind == 'percent': p.luck = int(p.luck * (1 + amt / 100.0))
                else: p.luck += int(amt)
            elif stat == 'crit_chance':
                if kind == 'percent': p.crit_chance *= (1 + amt / 100.0)
                else: p.crit_chance += float(amt)
                p.crit_chance = max(0.0, min(0.95, p.crit_chance))
            elif stat == 'crit_mult':
                if kind == 'percent': p.crit_mult *= (1 + amt / 100.0)
                else: p.crit_mult += float(amt)
            continue
        if stat == 'damage':
            if kind == 'percent': p.damage = int(max(1, p.damage * (1 + amt / 100.0)))
            else: p.damage = max(1, p.damage + int(amt))
        elif stat == 'attack_speed':
            if kind == 'percent': p.attack_speed *= (1 + amt / 100.0)
            else: p.attack_speed += amt
        elif stat == 'speed':
            if kind == 'percent': p.speed *= (1 + amt / 100.0)
            else: p.speed += amt
        elif stat == 'armor':
            if kind == 'percent': p.armor = int(p.armor * (1 + amt / 100.0))
            else: p.armor += int(amt)
        elif stat == 'max_hp':
            if kind == 'percent':
                delta = int(p.max_hp * (amt / 100.0)); p.max_hp += delta; p.hp += max(0, delta)
            else:
                p.max_hp += int(amt); p.hp += max(0, int(amt))
        elif stat == 'pickup':
            if kind == 'percent': p.pickup_range *= (1 + amt / 100.0)
            else: p.pickup_range += amt
        elif stat == 'lifesteal':
            if kind == 'percent': p.lifesteal *= (1 + amt / 100.0)
            else: p.lifesteal += amt
        elif stat == 'bullet_speed':
            if kind == 'percent': p.bullet_speed *= (1 + amt / 100.0)
            else: p.bullet_speed += amt
        elif stat == 'bullets':
            if kind == 'percent': p.bullets = clamp(int(p.bullets * (1 + amt / 100.0)), 1, 16)
            else: p.bullets = clamp(int(p.bullets) + int(amt), 1, 16)
        elif stat == 'pet':
            if isinstance(amt, str): game.pets.append(Pet(amt))
            elif isinstance(amt, (int, float)):
                for _ in range(int(amt)): game.pets.append(Pet('turret_buddy'))

def make_fast_gradient(size, top=(22, 24, 30), bottom=(30, 34, 42)):
    w, h = size
    tiny = pygame.Surface((1, 128))
    for y in range(128):
        t = y / 127
        col = (int(top[0] * (1 - t) + bottom[0] * t), int(top[1] * (1 - t) + bottom[1] * t), int(top[2] * (1 - t) + bottom[2] * t))
        tiny.set_at((0, y), col)
    grad = pygame.transform.smoothscale(tiny, (w, h))
    return grad


class Button:
    def __init__(self, rect, label, font, bg, fg, border=(120, 180, 255), tooltip=None):
        self.rect = pygame.Rect(rect); self.label = label; self.font = font; self.bg = bg; self.fg = fg; self.border = border; self.hover = False; self.tooltip = tooltip
    def draw(self, surf):
        col = (70, 78, 90) if self.hover else self.bg
        pygame.draw.rect(surf, col, self.rect, border_radius=12); pygame.draw.rect(surf, self.border if self.hover else (90, 100, 120), self.rect, 2, border_radius=12)
        t = self.font.render(self.label, True, self.fg); surf.blit(t, (self.rect.centerx - t.get_width() // 2, self.rect.centery - t.get_height() // 2))
    def update_hover(self, mx, my): self.hover = self.rect.collidepoint(mx, my)
    def clicked(self, mx, my, ev): return ev.type == pygame.MOUSEBUTTONDOWN and ev.button == 1 and self.rect.collidepoint(mx, my)

class Toggle:
    def __init__(self, rect, label, font, value=False, tooltip=None): self.rect = pygame.Rect(rect); self.label = label; self.font = font; self.value = value; self.tooltip = tooltip
    def draw(self, surf):
        box = pygame.Rect(self.rect.x, self.rect.y, 32, 32)
        pygame.draw.rect(surf, GREY2, box, border_radius=6); pygame.draw.rect(surf, (120, 180, 255), box, 2, border_radius=6)
        if self.value: pygame.draw.line(surf, (120, 180, 255), (box.x + 6, box.y + 16), (box.x + 14, box.y + 26), 3); pygame.draw.line(surf, (120, 180, 255), (box.x + 14, box.y + 26), (box.x + 26, box.y + 8), 3)
        txt = self.font.render(self.label, True, WHITE); surf.blit(txt, (box.right + 12, box.y + 2)); pygame.draw.rect(surf, (90, 100, 120), self.rect, 1, border_radius=6)
    def clicked(self, mx, my, ev):
        if ev.type == pygame.MOUSEBUTTONDOWN and ev.button == 1 and self.rect.collidepoint(mx, my): self.value = not self.value; return True
        return False

class Slider:
    def __init__(self, rect, label, font, minv, maxv, value, step=1, fmt=lambda v: f"{v}", tooltip=None):
        self.rect = pygame.Rect(rect); self.label = label; self.font = font; self.minv = minv; self.maxv = maxv; self.value = value; self.step = step; self.fmt = fmt; self.drag = False; self.tooltip = tooltip
    def draw(self, surf):
        pygame.draw.rect(surf, GREY2, self.rect, border_radius=8)
        track = pygame.Rect(self.rect.x + 16, self.rect.y + self.rect.h // 2 - 4, self.rect.w - 32, 8)
        pygame.draw.rect(surf, GREY3, track, border_radius=6)
        t = 0 if self.maxv == self.minv else (self.value - self.minv) / (self.maxv - self.minv)
        knob_x = track.x + int(t * track.w); knob = pygame.Rect(knob_x - 8, track.centery - 12, 16, 24)
        pygame.draw.rect(surf, (120, 180, 255), knob, border_radius=6)
        label_text = self.fmt(self.value) if callable(self.fmt) else f"{self.value}"
        lab = self.font.render(f"{self.label}: {label_text}", True, WHITE); surf.blit(lab, (self.rect.x + 12, self.rect.y + 8))
    def handle(self, mx, my, ev):
        track = pygame.Rect(self.rect.x + 16, self.rect.y + self.rect.h // 2 - 8, self.rect.w - 32, 16)
        if ev.type == pygame.MOUSEBUTTONDOWN and ev.button == 1 and track.collidepoint(mx, my): self.drag = True; self._set_from_mouse(mx, track)
        elif ev.type == pygame.MOUSEBUTTONUP and ev.button == 1: self.drag = False
        elif ev.type == pygame.MOUSEMOTION and self.drag: self._set_from_mouse(mx, track)
    def _set_from_mouse(self, mx, track):
        t = clamp((mx - track.x) / track.w, 0, 1); val = self.minv + t * (self.maxv - self.minv)
        if self.step: val = round(val / self.step) * self.step
        self.value = clamp(val, self.minv, self.maxv)

class Choice:
    def __init__(self, rect, label, options, font, idx=0):
        self.rect = pygame.Rect(rect); self.label = label; self.options = options; self.font = font; self.idx = idx; self.hover = False
    def value(self): return self.options[self.idx]
    def draw(self, surf):
        pygame.draw.rect(surf, (50, 55, 65), self.rect, border_radius=8)
        pygame.draw.rect(surf, (120, 180, 255), self.rect, 2, border_radius=8)
        lab = self.font.render(self.label, True, (230, 230, 230)); val = self.font.render(str(self.options[self.idx]), True, (240, 220, 120))
        surf.blit(lab, (self.rect.x + 12, self.rect.y + 8)); surf.blit(val, (self.rect.right - val.get_width() - 12, self.rect.y + 8))
    def update_hover(self, mx, my): self.hover = self.rect.collidepoint(mx, my)
    def clicked(self, mx, my, ev):
        if ev.type == pygame.MOUSEBUTTONDOWN and ev.button == 1 and self.rect.collidepoint(mx, my): self.idx = (self.idx + 1) % len(self.options); return True
        return False

BIOMES = {
    'Neon Grid': {'bg': (10, 12, 18), 'notes': 'Clean lanes. Standard.', 'player_spd_mul': 1.0, 'bullet_spd_mul': 1.0},
    'Rain Alley': {'bg': (12, 16, 24), 'notes': 'Slick streets. Lower friction.', 'player_spd_mul': 1.05, 'friction': 0.985, 'snow': True},
    'Dust Slums': {'bg': (28, 24, 20), 'notes': 'Grime. Lower pickup.', 'player_spd_mul': 0.95, 'pickup_mul': 0.8, 'dust': True},
    'Vine Mesh': {'bg': (16, 28, 24), 'notes': 'Constricting cables. Slow pulses.', 'player_spd_mul': 0.95, 'pulse_slow': 0.8},
    'Jetstream': {'bg': (14, 16, 26), 'notes': 'Crosswind from air vents.', 'bullet_spd_mul': 0.95, 'wind': True},
    'Reactor Core': {'bg': (26, 10, 14), 'notes': 'Heat bleed. Minor HP drain.', 'hp_drain': 0.5, 'embers': True},
    'Midnight District': {'bg': (8, 10, 16), 'notes': 'Dim cams. More spawns.', 'spawn_mul': 1.1, 'dim': 0.25},
}

def pick_biome(rng): return rng.choice(list(BIOMES.keys()))

class Game:
    def __init__(self):
        pygame.init()
        try:
            self.display = pygame.display.set_mode((0, 0), pygame.FULLSCREEN, vsync=0)
        except TypeError:
            self.display = pygame.display.set_mode((0, 0), pygame.FULLSCREEN)
        self.screen_w, self.screen_h = self.display.get_size()
        pygame.display.set_caption("Memory Burn")
        self.clock = pygame.time.Clock()
        self.surface = pygame.Surface((VIRTUAL_W, VIRTUAL_H))
        self.bg_grad = make_fast_gradient((VIRTUAL_W, VIRTUAL_H))
        self.scale_x = self.screen_w / VIRTUAL_W; self.scale_y = self.screen_h / VIRTUAL_H
        self.ui_scale = 1.0; self.text_scale = 1.0; self._rebuild_fonts()
        self.grid_bg = pygame.Surface((VIRTUAL_W, VIRTUAL_H))
        self.grid_bg.fill((0, 0, 0))
        for x in range(0, VIRTUAL_W, 48): pygame.draw.line(self.grid_bg, GREY2, (x, 0), (x, VIRTUAL_H))
        for y in range(0, VIRTUAL_H, 48): pygame.draw.line(self.grid_bg, GREY2, (0, y), (VIRTUAL_W, y))
        self.rng = random.Random()
        self.state = STATE_MENU
        self.menu_t0 = 0
        self._last_menu_tick = 0
        self.menu_particles = []
        self.reset_run()
        self.fade = 1.0
        self.start_btn = Button((VIRTUAL_W // 2 - 180, 680, 360, 72), "Start", self.big, GREY2, WHITE)
        self.menu_opts_btn = Button((VIRTUAL_W // 2 - 180, 760, 360, 56), "Options", self.font, GREY2, WHITE)
        self.manual_fire = False
        self.pause_tab = "Resume"
        self.fps_cap = DEFAULT_FPS_CAP

        self.toggle_manual = Toggle(pygame.Rect(0, 0, 480, 40), "Manual Fire (hold LMB)", self.font, value=self.manual_fire)
        self.toggle_shake = Toggle(pygame.Rect(0, 0, 480, 40), "Screen Shake", self.font, value=True)
        self.toggle_tracers = Toggle(pygame.Rect(0, 0, 480, 40), "Bullet Tracers", self.font, value=True)
        self.toggle_dmgnums = Toggle(pygame.Rect(0, 0, 480, 40), "Damage Numbers", self.font, value=True)
        self.toggle_reduced_flashes = Toggle(pygame.Rect(0, 0, 480, 40), "Reduced Flashes", self.font, value=False)
        self.slider_ui = Slider(pygame.Rect(0, 0, 520, 64), "UI Scale", self.font, 75, 140, 100, step=5, fmt=lambda v: f"{int(v)}%")
        self.slider_text = Slider(pygame.Rect(0, 0, 520, 64), "Text Size", self.font, 80, 140, 100, step=5, fmt=lambda v: f"{int(v)}%")
        self.slider_vfx = Slider(pygame.Rect(0, 0, 520, 64), "VFX Intensity", self.font, 50, 150, 100, step=5, fmt=lambda v: f"{int(v)}%")
        self.slider_gamespeed = Slider(pygame.Rect(0, 0, 520, 64), "Game Speed", self.font, 60, 120, 100, step=5, fmt=lambda v: f"{int(v)}%")
        self.slider_dmg_taken = Slider(pygame.Rect(0, 0, 520, 64), "Damage Taken", self.font, 50, 150, 100, step=5, fmt=lambda v: f"{int(v)}%")
        self.toggle_aim_assist = Toggle(pygame.Rect(0, 0, 520, 40), "Aim Assist", self.font, value=False)
        self.slider_fps = Slider(pygame.Rect(0, 0, 520, 64), "FPS Cap", self.font, 0, 240, DEFAULT_FPS_CAP, step=10, fmt=lambda v: "Unlimited" if int(v) == 0 else f"{int(v)}")

        self.diff_choice = Choice(pygame.Rect(VIRTUAL_W // 2 - 200, 460, 400, 48), "Difficulty", ["Normal", "Hard", "Insane"], self.font, idx=0)
        self.char_scroll = 0
        self.char_dragging = False
        self.diff_confirm = Button((VIRTUAL_W // 2 - 180, 540, 360, 64), "Confirm Difficulty", self.big, GREY2, WHITE)
        self.locked_difficulty = "Normal"
        self.bg_grad = make_fast_gradient((VIRTUAL_W, VIRTUAL_H))
        self.shake = ScreenShake()
        self._range_ring_cache = (None, None)
        self.particles = []; self.tracers = []; self.dtexts = []; self.pets = []; self.dmg_log = []; self.dmg_log = []
        self.shop_items = []; self.item_rects = []; self.item_locks = [False, False, False]
        self.biome = "Neon Grid"
        self.quest = None; self.quest_progress = 0; self.quest_target = 0; self.quest_fail = False
        self.next_wave_preview = ""
        self.jungle_slow = 1.0
        self.next_biome = None

        self.story_data = {
            1: ["MOTHERBOARD", "Connection re-established. Subject: Cipher-9. Memory fragmentation at 87 percent."],
            2: ["BLACK HAT", "You woke up in a cheap clinic with premium scars. Whoever did the job expected you to stay dead."],
            3: ["MOTHERBOARD", "Each contract cracks a node. Keep pushing and you will remember who burned you."],
            4: ["FIXER", "NovaCorp owns the cops and the air you breathe. Lucky for you, they still pay their invoices."],
            5: ["MARKET", "Rumor on the wire: NovaCorp hired mercs to erase rogue fragments. That means you."],
            6: ["CIPHER-9", "I remember a rooftop. A voice yelling my name. Static. Then nothing."],
            7: [["GHOST", "You keep chasing the shard like it's salvation."],
                ["GHOST", "Newsflash: you were dangerous before they cut you up."]],
            8: ["MOTHERBOARD", "Sector K has your biographical shard. Expect ICE patterns copying your old tactics."],
            9: ["MOTHERBOARD", "Do not trust the signal from Sector O. It is not me."],
            10: ["EVE", "You are a fork that would not die. Stop chasing ghosts."],
            11: [["EVE", "NovaCorp archived the original you as 'asset drift'."],
                 ["EVE", "They cloned the rest into product. Most of them broke. You didn't."]],
            12: ["EVE", "System integrity restored? No. Just a better lie. Welcome back, copy."],
            13: [["BLACK HAT", "I pulled your payroll. You used to burn crews like me for fun."],
                 ["BLACK HAT", "So tell me, copy-why should I help you finish the job?"]],
            14: ["FIXER", "Payment clears when the tower falls. Don't get sentimental now."],
            15: [["CIPHER-9", "I remember the rooftop. I remember the voice. It was mine."],
                 ["CIPHER-9", "I signed the order to erase me. This city doesn't forgive legends."]],
        }
        self.story_phase = 0
        self.wind = pygame.math.Vector2(0, 0); self.wind_phase = 0.0; self.pulse_t = 0.0

    def _rebuild_fonts(self):
        base = max(16, int(32 * self.text_scale))
        self.font = pygame.font.SysFont(None, base)
        self.big = pygame.font.SysFont(None, int(base * 2))
        self.huge = pygame.font.SysFont(None, int(base * 2.6))

    def reset_run(self):
        self.player = None
        self.wave = 1; self.wave_time = WAVE_TIME
        self.materials = 0
        self.enemies = pygame.sprite.Group(); self.bullets = pygame.sprite.Group(); self.enemy_bullets = pygame.sprite.Group()
        self.pickups = pygame.sprite.Group()
        self.spawn_timer = 0; self.base_spawn_rate = 0.72
        self.particles = []; self.tracers = []; self.dtexts = []; self.pets = []; self.dmg_log = []; self.dmg_log = []
        self.shop_items = []; self.item_rects = []; self.item_locks = [False, False, False]
        self.next_wave_preview = ""
        self.jungle_slow = 1.0
        self.next_biome = None

    def difficulty_mul(self):
        m = {"Normal": 1.0, "Hard": 1.25, "Insane": 1.5}[self.locked_difficulty]
        if BIOMES[self.biome].get("spawn_mul"): m *= BIOMES[self.biome]["spawn_mul"]
        return m

    def spawn_burst(self, pos, elite=False):
        intensity = self.slider_vfx.value / 100.0
        for _ in range(int((14 if not elite else 20) * intensity)):
            ang = self.rng.uniform(0, math.tau); spd = self.rng.uniform(160, 460)
            vel = (math.cos(ang) * spd, math.sin(ang) * spd); col = (255, 180, 110) if not elite else (220, 140, 255)
            self.particles.append(Particle(pos, vel, life=self.rng.uniform(0.2, 0.45), color=col, radius=6))

    def spawn_portal(self, pos):
        intensity = self.slider_vfx.value / 100.0
        for _ in range(int(10 * intensity)):
            ang = self.rng.uniform(0, math.tau); spd = self.rng.uniform(80, 240)
            vel = (math.cos(ang) * spd, math.sin(ang) * spd); self.particles.append(Particle(pos, vel, life=self.rng.uniform(0.2, 0.5), color=(160, 140, 255), radius=5, grow=True))

    def pick_quest(self):
        q = self.rng.choice(["NoHit", "Collect", "Kills"])
        if q == "NoHit": self.quest = ("Don't get hit for 12s", "NoHit"); self.quest_target = 12.0; self.quest_progress = 0.0; self.quest_fail = False
        elif q == "Collect": self.quest = ("Collect 15 materials", "Collect"); self.quest_target = 15; self.quest_progress = 0; self.quest_fail = False
        else: self.quest = ("Kill 40 enemies", "Kills"); self.quest_target = 40; self.quest_progress = 0; self.quest_fail = False

    def apply_biome_effects_tick(self, dt):
        b = BIOMES[self.biome]
        if b.get("hp_drain"): self.player.hp = max(1, self.player.hp - b["hp_drain"] * dt)
        self.jungle_slow = 1.0
        if b.get("pulse_slow"):
            self.pulse_t += dt
            cycle = 6.0
            t = self.pulse_t % cycle
            if 0.0 <= t < 1.2: self.jungle_slow = b["pulse_slow"]
        if b.get("wind"):
            self.wind_phase += dt * 0.6
            self.wind.x = math.cos(self.wind_phase) * 260
            self.wind.y = math.sin(self.wind_phase * 0.7) * 140
        else:
            self.wind.xy = (0, 0)

    def preview_text(self, next_wave, biome):
        boss = next_wave % 5 == 0
        kinds = ["G", "C", "Z", "X", "S", "T"]; weights = [5, 3, 3, 2, 2, 2]
        if boss:
            kinds.append("B"); weights.append(1)
        top = sorted(zip(kinds, weights), key=lambda x: x[1], reverse=True)[:3]
        lines = [
            f"Contract {next_wave}: Sitrep",
            f"District: {biome} - {BIOMES[biome]['notes']}",
            "Hostiles likely: " + ", ".join([f"{k}({w})" for k, w in top]),
            "Side-job next: random objective for bonus eddies.",
        ]
        return "\n".join(lines)

    def update_play(self, dt):
        # game speed
        dt *= self.slider_gamespeed.value / 100.0
        self.apply_biome_effects_tick(dt)
        keys = pygame.key.get_pressed()
        self.player.update(dt, keys, jungle_slow=self.jungle_slow)
        if keys[pygame.K_8]: self.wave_time = 0
        if keys[pygame.K_8]: self.wave_time = 0
        if keys[pygame.K_9]: self.player.cash += 100

        # spawning
        self.spawn_timer -= dt
        diff = (1.0 + self.wave * 0.16 + (self.wave ** 1.08) * 0.025) * self.difficulty_mul()

        if self.locked_difficulty == "Normal":
            if self.wave <= 12:
                diff *= 0.85
            elif self.wave <= 15:
                t = (self.wave - 12) / 3.0
                diff *= (0.85 + 0.15 * t)
        if self.spawn_timer <= 0:
            if self.wave % 5 == 0 and len([e for e in self.enemies if e.etype == "overlord"]) == 0:
                e = spawn_enemy(self.rng, self.wave, kind="overlord"); self.spawn_portal(e.pos); self.enemies.add(e)
            for _ in range(1 + int(self.wave / 6)):
                e = spawn_enemy(self.rng, self.wave); self.spawn_portal(e.pos); self.enemies.add(e)
            self.spawn_timer = max(0.07, self.base_spawn_rate / diff)

        # firing
        m_pressed = pygame.mouse.get_pressed()[0]; mx, my = pygame.mouse.get_pos(); vmx, vmy = mx / self.scale_x, my / self.scale_y
        self.player.try_fire(self.bullets, self.enemies.sprites(), self.rng, self.tracers, manual_fire=self.manual_fire, mouse_pos=(vmx, vmy), mouse_down=m_pressed)

        # pets
        for pet in self.pets: pet.update(dt, self.player, self.bullets, self.rng)

        # bullets
        bullet_spd_mul = BIOMES[self.biome].get("bullet_spd_mul", 1.0); wind = self.wind
        for b in tuple(self.bullets):
            b.vel *= bullet_spd_mul ** dt
            if wind.length_squared() > 0: b.vel += wind * dt * 1.6
            b.update(dt)
        for eb in tuple(self.enemy_bullets): eb.update(dt)

        # enemies / pickups / fx
        for e in tuple(self.enemies): e.update(dt, self.player, self.enemy_bullets, self.rng, self.difficulty_mul())
        for p in tuple(self.pickups): p.update(dt, self.player)
        for pr in tuple(self.particles):
            pr.update(dt)
            if pr.life <= 0: self.particles.remove(pr)
        for t in tuple(self.tracers):
            t.update(dt)
            if t.life <= 0: self.tracers.remove(t)
        self.shake.update(dt)

        for dtxt in tuple(self.dtexts):
            dtxt.update(dt)
            if dtxt.life <= 0: self.dtexts.remove(dtxt)

        now = pygame.time.get_ticks() / 1000.0
        self.dmg_log = [(t, d) for (t, d) in self.dmg_log if now - t <= 3.0]

        dmg_mul = self.slider_dmg_taken.value / 100.0

        # bullet hits
        for b in tuple(self.bullets):
            hit = pygame.sprite.spritecollide(b, self.enemies, False)
            if hit:
                for e in hit:
                    blocked = False
                    if e.etype == "aegis" and e.shield_hp > 0:
                        e.shield_hp -= b.dmg; blocked = True
                        if self.toggle_dmgnums.value:
                            self.dtexts.append(DmgText(b.pos, "BLOCK", color=(140, 220, 255)))
                        if not self.toggle_reduced_flashes.value: self.particles.append(Particle(b.pos, (0, 0), life=0.15, color=CYAN, radius=10, grow=True))
                    if not blocked:
                        dmg_val = int(b.dmg)
                        if self.rng.random() < getattr(self.player, "crit_chance", 0.0):
                            dmg_val = int(dmg_val * getattr(self.player, "crit_mult", 1.5))
                            is_crit = True
                        else:
                            is_crit = False
                        e.hp -= dmg_val; e.flash_t = 0.08; self.player.heal_on_hit()
                        if not self.toggle_reduced_flashes.value: self.particles.append(Particle(b.pos, (0, 0), life=0.12, color=(255, 240, 200), radius=8, grow=True))

                        if self.toggle_dmgnums.value:
                            if is_crit:
                                self.dtexts.append(DmgText(b.pos, f"{dmg_val}!", color=(255, 200, 120)))
                            else:
                                self.dtexts.append(DmgText(b.pos, str(int(dmg_val)), color=(255, 230, 180)))
                        self.dmg_log.append((pygame.time.get_ticks() / 1000.0, int(dmg_val)))
                        if e.hp <= 0:
                            self.spawn_burst(e.pos, elite=e.etype in ("aegis", "overlord"))
                            if self.rng.random() < 0.96: self.pickups.add(Pickup(e.pos, "mat", amount=self.rng.randint(1, 4)))
                            if self.rng.random() < 0.9: self.pickups.add(Pickup(e.pos, "xp", amount=1))

                            if self.rng.random() < 0.08: self.pickups.add(Pickup(e.pos, "heal", amount=self.rng.randint(4, 8)))
                            e.kill()
                            if self.quest and self.quest[1] == "Kills": self.quest_progress += 1
                if b.pierce > 0: b.pierce -= 1
                else: b.kill()

        # contact damage
        for e in tuple(self.enemies):
            if e.rect.colliderect(self.player.rect) and getattr(e, "hit_cool", 0) <= 0:
                self.player.take_damage(int(e.dmg * self.difficulty_mul() * dmg_mul)); e.hit_cool = 0.6; self.shake.add(6, dur=0.2)
                if self.quest and self.quest[1] == "NoHit": self.quest_fail = True

        # enemy bullets
        for eb in tuple(self.enemy_bullets):
            if eb.rect.collidepoint(self.player.rect.center):
                self.player.take_damage(int(eb.dmg * self.difficulty_mul() * dmg_mul)); self.shake.add(6, dur=0.2); eb.kill()
                if self.quest and self.quest[1] == "NoHit": self.quest_fail = True

        # pickups
        for p in tuple(self.pickups):
            if p.rect.colliderect(self.player.rect):
                if p.kind == "mat": self.materials += p.amount
                elif p.kind == "xp": self.player.gain_xp(p.amount * 12)
                elif p.kind == "heal": self.player.hp = min(self.player.max_hp, self.player.hp + p.amount)
                if self.quest and self.quest[1] == "Collect" and p.kind == "mat": self.quest_progress += p.amount
                p.kill()

        # quest tick
        if self.quest and self.quest[1] == "NoHit" and not self.quest_fail:
            self.quest_progress += dt

        self.wave_time -= dt
        if self.wave_time <= 0:
            for g in (self.enemies, self.bullets, self.enemy_bullets, self.pickups):
                for s in g: s.kill()
            quest_done = False
            if self.quest:
                if self.quest[1] == "NoHit":
                    quest_done = not self.quest_fail and self.quest_progress >= self.quest_target
                else:
                    quest_done = self.quest_progress >= self.quest_target
            reward = 35 + int(self.wave * 3) if quest_done else 0
            self.player.cash += self.materials + reward; self.materials = 0
            self.state = STATE_SHOP; self.roll_shop(); self.fade = 1.0
            self.next_biome = pick_biome(self.rng)
            self.next_wave_preview = self.preview_text(self.wave + 1, self.next_biome)
        if self.player.hp <= 0: self.state = STATE_GAMEOVER; self.fade = 1.0

    def draw_enemy_hp(self, e):
        if e.hp >= e.max_hp: return
        w = 40 if e.etype != "overlord" else 120; h = 6; x = e.rect.centerx - w // 2; y = e.rect.top - 10
        pygame.draw.rect(self.surface, (40, 40, 48), (x, y, w, h), border_radius=4)
        ww = int(w * clamp(e.hp / e.max_hp, 0, 1)); pygame.draw.rect(self.surface, (220, 90, 90), (x, y, ww, h), border_radius=4)
        if e.etype == "aegis" and e.shield_hp > 0:
            pygame.draw.rect(self.surface, (20, 50, 60), (x, y - 8, w, 4), border_radius=3)
            sw = int(w * clamp(e.shield_hp / 80.0, 0, 1)); pygame.draw.rect(self.surface, CYAN, (x, y - 8, sw, 4), border_radius=3)

    def draw_enemy_letter(self, e):
        letter = LETTER_MAP.get(e.etype, "?"); label = self.font.render(letter, True, (10, 250, 220))
        cx, cy = e.rect.center; self.surface.blit(label, (cx - label.get_width() // 2, cy - label.get_height() // 2))

    def draw_bar(self, x, y, w, h, frac, col_fg, col_bg=GREY3):
        pygame.draw.rect(self.surface, col_bg, (x, y, w, h), border_radius=10); ww = int(w * clamp(frac, 0, 1))
        if ww > 0: pygame.draw.rect(self.surface, col_fg, (x, y, ww, h), border_radius=10)

    def draw_biome_vfx(self):
        b = BIOMES[self.biome]
        if b.get("dim"):
            alpha = int(255 * b["dim"]); overlay = pygame.Surface((VIRTUAL_W, VIRTUAL_H), pygame.SRCALPHA); overlay.fill((0, 0, 0, alpha)); self.surface.blit(overlay, (0, 0))
        if b.get("snow") and self.rng.random() < 0.2:
            x = self.rng.randint(0, VIRTUAL_W); vel = (self.rng.uniform(-20, 20), self.rng.uniform(60, 120))
            self.particles.append(Particle((x, -10), vel, life=self.rng.uniform(2.0, 3.5), color=(220, 230, 255), radius=3))
        if b.get("dust") and self.rng.random() < 0.25:
            x = self.rng.randint(0, VIRTUAL_W); vel = (self.rng.uniform(-10, 10), self.rng.uniform(40, 80))
            self.particles.append(Particle((x, -10), vel, life=self.rng.uniform(1.5, 2.4), color=(200, 180, 120), radius=3))
        if b.get("embers") and self.rng.random() < 0.3:
            x = self.rng.randint(0, VIRTUAL_W); vel = (self.rng.uniform(-20, 20), self.rng.uniform(-20, -60))
            self.particles.append(Particle((x, VIRTUAL_H + 10), vel, life=self.rng.uniform(1.0, 1.8), color=(255, 170, 120), radius=3))

    def draw_play(self):
        bcol = BIOMES[self.biome]['bg']
        self.surface.fill(bcol)
        self.surface.blit(self.grid_bg, (0, 0))
        off = self.shake.offset(self.rng); ox, oy = int(off[0]), int(off[1])
        for s in self.pickups: self.surface.blit(s.image, s.rect.move(ox, oy))
        for s in self.enemies:
            self.surface.blit(s.image, s.rect.move(ox, oy)); self.draw_enemy_hp(s); self.draw_enemy_letter(s)
        for s in self.bullets: self.surface.blit(s.image, s.rect.move(ox, oy))
        for s in self.enemy_bullets: self.surface.blit(s.image, s.rect.move(ox, oy))
        self.surface.blit(self.player.image, self.player.rect.move(ox, oy))
        for pr in self.particles: pr.draw(self.surface)
        for tr in self.tracers: tr.draw(self.surface)

        for dtxt in self.dtexts: dtxt.draw(self.surface, self.font)
        self.draw_biome_vfx()

        pygame.draw.rect(self.surface, GREY3, (0, 0, VIRTUAL_W, 64))
        self.draw_bar(20, 18, 420, 28, self.player.hp / self.player.max_hp, RED, (50, 30, 30))
        self.surface.blit(self.font.render(f"HP {int(self.player.hp)}/{self.player.max_hp}", True, WHITE), (28, 20))
        wtxt = self.font.render(f"Wave {self.wave}", True, WHITE); ttxt = self.font.render(f"{int(self.wave_time)}s", True, WHITE)
        midx = VIRTUAL_W // 2; self.surface.blit(wtxt, (midx - wtxt.get_width() - 12, 18)); self.surface.blit(ttxt, (midx + 12, 18))
        self.surface.blit(self.font.render(f"Creds {self.materials}", True, GREEN), (VIRTUAL_W - 420, 12))


        try:
            r = int(self.player.range_px)
            rad, surf_cached = self._range_ring_cache
            if rad != r or surf_cached is None:
                surf_cached = pygame.Surface((r * 2, r * 2), pygame.SRCALPHA).convert_alpha()
                pygame.draw.circle(surf_cached, (150, 200, 255, 40), (r, r), r, 2)
                self._range_ring_cache = (r, surf_cached)
            self.surface.blit(surf_cached, (int(self.player.pos.x) - r - 2, int(self.player.pos.y) - r - 2))
        except Exception:
            pass

        self.surface.blit(self.font.render(f"Range {int(self.player.range_px)} px", True, (200, 220, 230)), (VIRTUAL_W - 620, 8))
        cd = self.player.dash_cd
        cd_txt = "Ready" if cd <= 0 else f"Dash {cd:.1f}s"
        self.surface.blit(self.font.render(cd_txt, True, (200, 220, 230)), (VIRTUAL_W - 620, 36))
        self.surface.blit(self.font.render(f"Eddies ₵{self.player.cash}", True, YELLOW), (VIRTUAL_W - 420, 36))


        if self.quest:
            if self.quest[1] == 'NoHit':
                qtxt = f"Quest: {self.quest[0]} ({int(self.quest_progress)}/{int(self.quest_target)}){' [FAIL]' if self.quest_fail else ''}"
            else:
                qtxt = f"Quest: {self.quest[0]} ({int(self.quest_progress)}/{int(self.quest_target)})"
            self.surface.blit(self.font.render(qtxt, True, (240, 240, 200)), (20, 72))
        self.surface.blit(self.font.render(f"District: {self.biome}", True, (200, 210, 220)), (20, 100))
        fps = int(self.clock.get_fps()); fps_text = self.font.render(f"{fps} FPS", True, (200, 220, 230))
        self.surface.blit(fps_text, (VIRTUAL_W - fps_text.get_width() - 18, 8))

        dps = 0
        if self.dmg_log:
            total = sum(d for _, d in self.dmg_log)
            span = max(0.5, self.dmg_log[-1][0] - self.dmg_log[0][0])
            dps = int(total / min(3.0, span))
        dps_text = self.font.render(f"DPS {dps}", True, (220, 240, 180))
        self.surface.blit(dps_text, (VIRTUAL_W - dps_text.get_width() - 18, 36))

    def draw_menu(self):

        now_ms = pygame.time.get_ticks()
        if self.menu_t0 == 0: self.menu_t0 = now_ms
        if self._last_menu_tick == 0: self._last_menu_tick = now_ms
        dt = (now_ms - self._last_menu_tick) / 1000.0
        self._last_menu_tick = now_ms
        t = (now_ms - self.menu_t0) / 1000.0


        mx, my = pygame.mouse.get_pos(); vmx, vmy = mx / self.scale_x, my / self.scale_y
        parx = int((vmx - VIRTUAL_W / 2) * 0.02); pary = int((vmy - VIRTUAL_H / 2) * 0.02)


        self.surface.blit(self.bg_grad, (parx, pary))
        scan = pygame.Surface((VIRTUAL_W, VIRTUAL_H), pygame.SRCALPHA)
        for y in range(0, VIRTUAL_H, 4):
            a = int(18 + 10 * (0.5 + 0.5 * math.sin(y * 0.02 + t * 3.0)))
            yy = (y + int(t * 40)) % VIRTUAL_H
            pygame.draw.line(scan, (255, 255, 255, a), (0, yy), (VIRTUAL_W, yy))
        self.surface.blit(scan, (0, 0))


        if len(self.menu_particles) < 90:
            for _ in range(2):
                x = self.rng.uniform(0, VIRTUAL_W); vel = (self.rng.uniform(-10, 10), self.rng.uniform(-8, -18))
                self.menu_particles.append(Particle((x, VIRTUAL_H + 10), vel, life=self.rng.uniform(2.0, 3.5), color=(255, 170, 120), radius=3))
        for p in list(self.menu_particles):
            p.update(dt)
            if p.life <= 0: self.menu_particles.remove(p); continue
            p.draw(self.surface)


        title = self.huge.render("Memory Burn", True, WHITE)
        sub = self.font.render("Fragments of who you were keep fighting back.", True, (210, 210, 220))
        by = self.font.render("By Andre Nijman", True, (190, 190, 200))


        y = 260
        if t < 1.8:
            j = 10 * (1.0 - t / 1.8)
            rx = int(self.rng.uniform(-j, j)); ry = int(self.rng.uniform(-j, j))
            gx = int(self.rng.uniform(-j, j)); gy = int(self.rng.uniform(-j, j))
            bx = int(self.rng.uniform(-j, j)); byy = int(self.rng.uniform(-j, j))

            t_r = self.huge.render("Memory Burn", True, (255, 80, 80))
            t_g = self.huge.render("Memory Burn", True, (80, 255, 140))
            t_b = self.huge.render("Memory Burn", True, (120, 180, 255))
            cx = VIRTUAL_W // 2
            self.surface.blit(t_r, (cx - t_r.get_width() // 2 + rx, y + ry))
            self.surface.blit(t_g, (cx - t_g.get_width() // 2 + gx, y + gy))
            self.surface.blit(t_b, (cx - t_b.get_width() // 2 + bx, y + byy))
            base = title.copy(); base.set_alpha(int(120 + 80 * (t / 1.8))); self.surface.blit(base, (cx - base.get_width() // 2, y))
        else:
            self.surface.blit(title, (VIRTUAL_W // 2 - title.get_width() // 2, y))

        y += 80
        self.surface.blit(sub, (VIRTUAL_W // 2 - sub.get_width() // 2, y))
        y += 50
        self.surface.blit(by, (VIRTUAL_W // 2 - by.get_width() // 2, y))


        self.start_btn.rect = pygame.Rect(VIRTUAL_W // 2 - 180, 680, 360, 72)
        self.menu_opts_btn.rect = pygame.Rect(VIRTUAL_W // 2 - 180, 760, 360, 56)
        self.start_btn.update_hover(vmx, vmy); self.menu_opts_btn.update_hover(vmx, vmy)
        self.start_btn.draw(self.surface); self.menu_opts_btn.draw(self.surface)

        if self.start_btn.hover:
            flick = pygame.Surface((self.start_btn.rect.w, self.start_btn.rect.h), pygame.SRCALPHA); flick.set_alpha(40 + int(40 * (0.5 + 0.5 * math.sin(t * 20))))
            pygame.draw.rect(flick, (255, 255, 255), (0, 0, *self.start_btn.rect.size), border_radius=12)
            self.surface.blit(flick, self.start_btn.rect.topleft)
        if self.menu_opts_btn.hover:
            flick2 = pygame.Surface((self.menu_opts_btn.rect.w, self.menu_opts_btn.rect.h), pygame.SRCALPHA); flick2.set_alpha(40 + int(40 * (0.5 + 0.5 * math.sin(t * 20 + 1))))
            pygame.draw.rect(flick2, (255, 255, 255), (0, 0, *self.menu_opts_btn.rect.size), border_radius=12)
            self.surface.blit(flick2, self.menu_opts_btn.rect.topleft)

        cap_label = "Unlimited" if self.fps_cap == 0 else str(self.fps_cap)
        cap = self.font.render(f"FPS Cap: {cap_label}", True, (220, 220, 230))
        self.surface.blit(cap, (VIRTUAL_W // 2 - cap.get_width() // 2, 840))

    def draw_char_select(self):

        self.surface.blit(self.bg_grad, (0, 0))
        header = self.big.render("Select your character", True, WHITE)
        self.surface.blit(header, (VIRTUAL_W // 2 - header.get_width() // 2, 44))


        mx, my = pygame.mouse.get_pos()
        vmx, vmy = mx / self.scale_x, my / self.scale_y

        cols = 4
        rows = (len(ARCHETYPES) + cols - 1) // cols
        card_w, card_h = 440, 168
        gap_x, gap_y = 28, 24
        total_w = cols * card_w + (cols - 1) * gap_x
        start_x = (VIRTUAL_W - total_w) // 2
        start_y = 140

        self.char_rects = []
        idx_hover = -1
        for i, arch in enumerate(ARCHETYPES):
            r = i // cols; c = i % cols
            x = start_x + c * (card_w + gap_x)
            y = start_y + r * (card_h + gap_y)
            rect = pygame.Rect(x, y, card_w, card_h)
            self.char_rects.append(rect)
            if rect.collidepoint(vmx, vmy):
                idx_hover = i
            hover = (i == idx_hover)
            pygame.draw.rect(self.surface, GREY2 if not hover else (70, 78, 90), rect, border_radius=12)
            pygame.draw.rect(self.surface, (90, 100, 120) if not hover else (120, 180, 255), rect, 2, border_radius=12)
            name = self.font.render(arch['name'], True, WHITE); self.surface.blit(name, (x + 14, y + 12))
            desc = self.font.render(arch.get('desc', ''), True, (210, 220, 230)); self.surface.blit(desc, (x + 14, y + 52))

        tip = self.font.render("Click a card to continue.", True, (200, 210, 255))
        self.surface.blit(tip, (VIRTUAL_W // 2 - tip.get_width() // 2, VIRTUAL_H - 80))
        return idx_hover






    def draw_difficulty(self):
        self.surface.blit(self.bg_grad, (0, 0))
        header = self.big.render("Choose Difficulty", True, WHITE); self.surface.blit(header, (VIRTUAL_W // 2 - header.get_width() // 2, 320))
        self.diff_choice.draw(self.surface); self.diff_confirm.draw(self.surface)
        tip = self.font.render("Difficulty is locked for this run.", True, (210, 210, 220)); self.surface.blit(tip, (VIRTUAL_W // 2 - tip.get_width() // 2, 620))

    def draw_shop(self):
        self.surface.blit(self.bg_grad, (0, 0))
        header = self.big.render(f"Back-Alley Market - Wave {self.wave}", True, WHITE); self.surface.blit(header, (VIRTUAL_W // 2 - header.get_width() // 2, 60))
        tip = self.font.render("Tip: Click the padlock icon on a card to lock it for rerolls.", True, (220, 220, 240)); self.surface.blit(tip, (VIRTUAL_W // 2 - tip.get_width() // 2, 108))
        coins = self.font.render(f"Eddies ₵{self.player.cash}", True, YELLOW); self.surface.blit(coins, (VIRTUAL_W // 2 - coins.get_width() // 2, 144))
        luck_text = self.font.render(f"Luck {int(getattr(self.player, 'luck', 0))}", True, (200, 240, 200))
        self.surface.blit(luck_text, (VIRTUAL_W // 2 - luck_text.get_width() // 2, 174))
        pad = 120; gap = 60; card_w = (VIRTUAL_W - pad * 2 - gap * 2) // 3; card_h = 360
        self.item_rects = []
        mx, my = pygame.mouse.get_pos(); vmx, vmy = mx / self.scale_x, my / self.scale_y
        pulse = (math.sin(pygame.time.get_ticks() / 300.0) + 1.0) * 0.5
        for i, item in enumerate(self.shop_items):
            x = pad + i * (card_w + gap); y = 240; rect = pygame.Rect(x, y, card_w, card_h); self.item_rects.append(rect)
            hover = rect.collidepoint(vmx, vmy); can_buy = self.player.cash >= item['cost']; border_col = RARITY_COL[item['rarity']]

            glow_a = int(60 + 120 * pulse)
            glow = pygame.Surface((rect.w + 12, rect.h + 12), pygame.SRCALPHA)
            pygame.draw.rect(glow, (*border_col, glow_a), glow.get_rect(), border_radius=20)
            self.surface.blit(glow, (rect.x - 6, rect.y - 6))
            pygame.draw.rect(self.surface, GREY2 if not hover else (70, 78, 90), rect, border_radius=16)
            pygame.draw.rect(self.surface, border_col if can_buy else (90, 100, 120), rect, 3, border_radius=16)
            title = self.big.render(item['name'], True, WHITE); self.surface.blit(title, (x + 20, y + 20))
            desc = self.font.render(item['desc'], True, (200, 220, 210)); self.surface.blit(desc, (x + 24, y + 100))
            cost = self.font.render(f"Cost ${item['cost']}", True, YELLOW); self.surface.blit(cost, (x + 24, y + 150))
            tip = self.font.render(f"Rarity: {item['rarity'].title()}", True, border_col); self.surface.blit(tip, (x + 24, y + 190))

            if hover:
                tip_lines = [item['desc']]
                stat = item.get('+stat'); amt = item.get('+amt')
                if stat == 'damage':
                    cur = int(self.player.damage); new = int(self.player.damage * (1 + amt / 100.0)); tip_lines.append(f"Dmg: {cur} -> {new}")
                elif stat == 'attack_speed':
                    cur = self.player.attack_speed; new = self.player.attack_speed + amt; tip_lines.append(f"AtkSpd: {cur:.2f} -> {new:.2f}")
                elif stat == 'speed':
                    cur = int(self.player.speed); new = int(self.player.speed + amt); tip_lines.append(f"Speed: {cur} -> {new}")
                elif stat == 'armor':
                    cur = self.player.armor; new = self.player.armor + amt; tip_lines.append(f"Armor: {cur} -> {new}")
                elif stat == 'max_hp':
                    cur = self.player.max_hp; new = self.player.max_hp + amt; tip_lines.append(f"Max HP: {cur} -> {new}")
                elif stat == 'pickup':
                    cur = int(self.player.pickup_range); new = int(self.player.pickup_range + amt); tip_lines.append(f"Pickup: {cur} -> {new}")
                elif stat == 'lifesteal':
                    cur = int(self.player.lifesteal * 100); new = int((self.player.lifesteal + amt) * 100); tip_lines.append(f"Lifesteal: {cur}% -> {new}%")
                elif stat == 'bullet_speed':
                    cur = int(self.player.bullet_speed); new = int(self.player.bullet_speed + amt); tip_lines.append(f"Proj Spd: {cur} -> {new}")
                elif stat == 'bullets':
                    cur = int(self.player.bullets); new = int(min(16, max(1, self.player.bullets + amt))); tip_lines.append(f"Projectiles: {cur} -> {new}")
                elif stat == 'pet':
                    cur = len(self.pets); new = cur + 1; tip_lines.append(f"Pet count: {cur} -> {new}")
                elif stat == 'health_regen':
                    cur = float(getattr(self.player, 'health_regen', 0.0)); new = cur + float(amt); tip_lines.append(f"Regen: {cur:.2f}/s -> {new:.2f}/s")

                tw = max(self.font.size(t)[0] for t in tip_lines) + 24
                th = len(tip_lines) * 28 + 16
                tx, ty = rect.right - tw, rect.y + rect.h + 8
                panel = pygame.Rect(tx, ty, tw, th)
                pygame.draw.rect(self.surface, GREY3, panel, border_radius=10)
                pygame.draw.rect(self.surface, border_col, panel, 2, border_radius=10)
                y0 = ty + 8
                for ln in tip_lines:
                    t = self.font.render(ln, True, WHITE)
                    self.surface.blit(t, (tx + 12, y0)); y0 += 28

            lock_rect = pygame.Rect(x + card_w - 44, y + 12, 32, 32)
            pygame.draw.rect(self.surface, GREY2, lock_rect, border_radius=6); pygame.draw.rect(self.surface, (120, 180, 255), lock_rect, 2, border_radius=6)
            if self.item_locks[i]:
                pygame.draw.line(self.surface, (120, 180, 255), (lock_rect.x + 8, lock_rect.y + 24), (lock_rect.x + 24, lock_rect.y + 24), 3)
                pygame.draw.circle(self.surface, (120, 180, 255), (lock_rect.x + 16, lock_rect.y + 12), 6, 2)
            else:
                pygame.draw.circle(self.surface, (90, 100, 120), (lock_rect.x + 16, lock_rect.y + 20), 8, 2)
            setattr(self, f"lock_rect_{i}", lock_rect)
        self.reroll_btn = Button((VIRTUAL_W // 2 - 360, VIRTUAL_H - 120, 220, 52), "Reroute (₵5)", self.font, GREY2, WHITE)
        self.next_btn = Button((VIRTUAL_W // 2 - 60, VIRTUAL_H - 120, 220, 52), "Contract Start", self.font, GREY2, WHITE)
        for b in (self.reroll_btn, self.next_btn): b.update_hover(vmx, vmy); b.draw(self.surface)
        panel = pygame.Rect(80, VIRTUAL_H - 190, VIRTUAL_W - 160, 60); pygame.draw.rect(self.surface, GREY2, panel, border_radius=14)
        stats = f"HP {int(self.player.hp)}/{self.player.max_hp}  Armor {self.player.armor} | Dmg {self.player.damage}  AtkSpd {self.player.attack_speed:.2f}  Bullets {self.player.bullets} | Speed {int(self.player.speed)}  Lifesteal {int(self.player.lifesteal * 100)}%  Pickup {int(self.player.pickup_range)}  Pets {len(self.pets)}  Regen {self.player.health_regen:.2f}/s"
        self.surface.blit(self.font.render(stats, True, WHITE), (panel.x + 20, panel.y + 14))

    def _draw_story_overlay(self, dt):

        if not hasattr(self, 'story_idx'): self.story_idx = 0
        if not hasattr(self, 'story_timer'): self.story_timer = 0.0
        if not hasattr(self, 'story_speed'): self.story_speed = 38
        if not hasattr(self, 'story_fast'): self.story_fast = False
        if not hasattr(self, 'story_skip_all'): self.story_skip_all = False
        if not hasattr(self, 'story_phase'): self.story_phase = 0

        nxt = self.wave + 1
        beats = None

        data = getattr(self, 'story_data', {})
        v = data.get(nxt)
        if isinstance(v, list) and len(v) >= 1 and isinstance(v[0], (list, tuple)) and len(v[0]) == 2:
            beats = v
        elif isinstance(v, list) and len(v) == 2 and all(isinstance(x, str) for x in v):
            beats = [v]
        else:
            return False

        if self.story_skip_all or self.story_phase != 0:
            return False

        panel = pygame.Rect(VIRTUAL_W // 2 - 520, 120, 1040, 520)

        self.surface.blit(make_fast_gradient((VIRTUAL_W, VIRTUAL_H)), (0, 0))
        pygame.draw.rect(self.surface, (20, 24, 28), panel, border_radius=18)
        pygame.draw.rect(self.surface, (120, 180, 255), panel, 2, border_radius=18)


        title = self.big.render("Memory Node Access", True, (240, 240, 240))
        self.surface.blit(title, (panel.centerx - title.get_width() // 2, panel.y + 18))


        skip_box = pygame.Rect(panel.right - 240, panel.y + 20, 18, 18)
        pygame.draw.rect(self.surface, (220, 220, 230), skip_box, 2)
        if self.story_skip_all:
            pygame.draw.line(self.surface, (220, 220, 230), skip_box.topleft, skip_box.bottomright, 2)
            pygame.draw.line(self.surface, (220, 220, 230), skip_box.topright, skip_box.bottomleft, 2)
        sktxt = self.font.render("Skip story this run", True, (210, 210, 220))
        self.surface.blit(sktxt, (skip_box.right + 10, skip_box.y - 2))
        self.story_skip_rect = skip_box


        total = len(beats)

        if self.story_idx >= total:
            self.story_phase = 1
            self.story_idx = 0
            self.story_timer = 0
            self.story_fast = False
            return False
        for i in range(total):
            cx = panel.centerx - (total - 1) * 12 + i * 24
            cy = panel.bottom - 26
            col = (180, 220, 255) if i == self.story_idx else (90, 110, 140)
            pygame.draw.circle(self.surface, col, (cx, cy), 6)


        who, full_line = beats[self.story_idx]
        who_chip = self.font.render("[" + who + "]", True, (150, 200, 255))
        self.surface.blit(who_chip, (panel.x + 28, panel.y + 80))


        self.story_timer += dt * (self.story_speed * (4 if self.story_fast else 1))
        shown = int(self.story_timer)
        text = full_line[:shown]


        words = text.split(' ')
        lines = []; cur = ''
        for w in words:
            t = (cur + ' ' + w).strip()
            if len(t) > 74:
                lines.append(cur); cur = w
            else:
                cur = t
        if cur: lines.append(cur)

        y = panel.y + 128
        for ln in lines[:6]:
            r = self.font.render(ln, True, (220, 220, 230))
            self.surface.blit(r, (panel.x + 28, y)); y += 40


        self.story_btn_prev = pygame.Rect(panel.x + 28, panel.bottom - 60, 120, 36)
        self.story_btn_next = pygame.Rect(panel.right - 148, panel.bottom - 60, 120, 36)
        for rect, label in ((self.story_btn_prev, 'Back'), (self.story_btn_next, 'Next')):
            pygame.draw.rect(self.surface, (60, 70, 85), rect, border_radius=10)
            pygame.draw.rect(self.surface, (140, 170, 230), rect, 2, border_radius=10)
            t = self.font.render(label, True, (230, 235, 245))
            self.surface.blit(t, (rect.centerx - t.get_width() // 2, rect.centery - t.get_height() // 2))

        hint = self.font.render("Click Next or press Space.", True, (210, 210, 220))
        self.surface.blit(hint, (panel.centerx - hint.get_width() // 2, panel.bottom + 8))
        return True

    def draw_preview(self):
        dt = self.clock.get_time() / 1000.0

        self.surface.blit(make_fast_gradient((VIRTUAL_W, VIRTUAL_H)), (0, 0))

        if self._draw_story_overlay(dt):
            return

        header = self.big.render("Contract Briefing", True, WHITE)
        self.surface.blit(header, (VIRTUAL_W // 2 - header.get_width() // 2, 120))
        y = 220
        for line in str(self.next_wave_preview).splitlines():
            t = self.font.render(line, True, (220, 220, 230))
            self.surface.blit(t, (VIRTUAL_W // 2 - t.get_width() // 2, y))
            y += 44
        hint = self.font.render("Click to deploy.", True, (210, 210, 220))
        self.surface.blit(hint, (VIRTUAL_W // 2 - hint.get_width() // 2, VIRTUAL_H - 160))

    def _draw_options_panel(self, content_rect, vmx, vmy, event):
        y = content_rect.y + 20
        widgets = [self.toggle_manual, self.toggle_shake, self.toggle_tracers, self.toggle_dmgnums, self.toggle_reduced_flashes,
                   self.slider_ui, self.slider_text, self.slider_vfx, self.slider_gamespeed, self.slider_dmg_taken, self.toggle_aim_assist,
                   self.slider_fps]
        for w in widgets:
            if isinstance(w, Toggle):
                w.rect = pygame.Rect(content_rect.x + 20, y, 520, 40); w.draw(self.surface); y += 52
            else:
                w.rect = pygame.Rect(content_rect.x + 20, y, 560, 64); w.draw(self.surface); y += 76
            if event and isinstance(w, Slider): w.handle(vmx, vmy, event)
        self.ui_scale = self.slider_ui.value / 100.0; self.text_scale = self.slider_text.value / 100.0; self._rebuild_fonts()
        self.grid_bg = pygame.Surface((VIRTUAL_W, VIRTUAL_H))
        self.grid_bg.fill((0, 0, 0))
        for x in range(0, VIRTUAL_W, 48): pygame.draw.line(self.grid_bg, GREY2, (x, 0), (x, VIRTUAL_H))
        for y in range(0, VIRTUAL_H, 48): pygame.draw.line(self.grid_bg, GREY2, (0, y), (VIRTUAL_W, y))
        if event and self.toggle_manual.clicked(vmx, vmy, event): self.manual_fire = self.toggle_manual.value
        self.fps_cap = int(self.slider_fps.value)

    def _pause_tabs_bar(self, vmx, vmy, event):
        bar = pygame.Rect(240, 110, VIRTUAL_W - 480, 64)
        pygame.draw.rect(self.surface, GREY3, bar, border_radius=10)
        tabs = ['Resume', 'Options', 'Legend', 'Controls', 'Quit']
        tab_w = bar.w // len(tabs)
        for i, name in enumerate(tabs):
            r = pygame.Rect(bar.x + i * tab_w, bar.y, tab_w, bar.h)
            hover = r.collidepoint(vmx, vmy)
            pygame.draw.rect(self.surface, (70, 78, 90) if hover or self.pause_tab == name else GREY2, r, border_radius=10)
            pygame.draw.rect(self.surface, (120, 180, 255) if hover or self.pause_tab == name else (90, 100, 120), r, 2, border_radius=10)
            label = self.font.render(name, True, WHITE); self.surface.blit(label, (r.centerx - label.get_width() // 2, r.centery - label.get_height() // 2))
            if event and event.type == pygame.MOUSEBUTTONDOWN and event.button == 1 and r.collidepoint(vmx, vmy): self.pause_tab = name

    def draw_pause(self, event):
        overlay = pygame.Surface((VIRTUAL_W, VIRTUAL_H), pygame.SRCALPHA); overlay.fill((0, 0, 0, 160)); self.surface.blit(overlay, (0, 0))
        panel = pygame.Rect(160, 80, VIRTUAL_W - 320, VIRTUAL_H - 160)
        pygame.draw.rect(self.surface, GREY2, panel, border_radius=18); pygame.draw.rect(self.surface, (120, 180, 255), panel, 2, border_radius=18)
        title = self.big.render('Paused', True, WHITE); self.surface.blit(title, (panel.centerx - title.get_width() // 2, panel.y + 24))
        mx, my = pygame.mouse.get_pos(); vmx, vmy = mx / self.scale_x, my / self.scale_y
        self._pause_tabs_bar(vmx, vmy, event)
        content = pygame.Rect(panel.x + 40, panel.y + 120, panel.w - 80, panel.h - 180); pygame.draw.rect(self.surface, GREY3, content, border_radius=12)
        if self.pause_tab == 'Resume':
            resume = Button((content.centerx - 160, content.centery - 32, 320, 64), 'Resume', self.big, GREY2, WHITE)
            resume.update_hover(vmx, vmy); resume.draw(self.surface)
            if event and resume.clicked(vmx, vmy, event): self.state = STATE_PLAY
        elif self.pause_tab == 'Options':
            self._draw_options_panel(content, vmx, vmy, event)
        elif self.pause_tab == 'Legend':
            lines = ['S = Scrap - Basic rush bot.', 'B = Brute - Accelerates when close.', 'K = Skater - Zig-zags erratically.', 'X = Suicide - Bursts shrapnel up close.', 'A = Aegis - Shield blocks shots.', 'T = Sentry - Stationary shooter.', 'Ω = Overlord - Big HP, radial shots.']
            y = content.y + 20
            for ln in lines: t = self.font.render(ln, True, WHITE); self.surface.blit(t, (content.x + 20, y)); y += 36
        elif self.pause_tab == 'Controls':
            lines = ['Move: WASD', 'Aim: Mouse', 'Manual Fire: Hold LMB (if enabled)', 'Pause: Esc', 'Debug: 8 to skip contract']
            y = content.y + 20
            for ln in lines: t = self.font.render(ln, True, WHITE); self.surface.blit(t, (content.x + 20, y)); y += 36
        elif self.pause_tab == 'Quit':
            q = Button((content.centerx - 160, content.centery - 32, 320, 64), 'Quit to Menu', self.big, GREY2, WHITE)
            q.update_hover(vmx, vmy); q.draw(self.surface)
            if event and q.clicked(vmx, vmy, event): self.state = STATE_MENU; self.reset_run()

    def draw_menu_options(self, event):
        self.surface.blit(self.bg_grad, (0, 0))
        title = self.big.render('Options', True, WHITE); self.surface.blit(title, (VIRTUAL_W // 2 - title.get_width() // 2, 40))
        mx, my = pygame.mouse.get_pos(); vmx, vmy = mx / self.scale_x, my / self.scale_y
        panel = pygame.Rect(160, 120, VIRTUAL_W - 320, VIRTUAL_H - 220); pygame.draw.rect(self.surface, GREY2, panel, border_radius=18); pygame.draw.rect(self.surface, (120, 180, 255), panel, 2, border_radius=18)
        content = pygame.Rect(panel.x + 40, panel.y + 20, panel.w - 80, panel.h - 80); pygame.draw.rect(self.surface, GREY3, content, border_radius=12)
        self._draw_options_panel(content, vmx, vmy, event)
        back = Button((panel.centerx - 140, panel.bottom - 56, 280, 48), 'Back', self.font, GREY2, WHITE)
        back.update_hover(vmx, vmy); back.draw(self.surface)
        if event and back.clicked(vmx, vmy, event): self.state = STATE_MENU

    def roll_shop(self):
        if not self.shop_items or not any(self.item_locks): self.shop_items = roll_items(self.rng, 3, self.wave, getattr(self.player, 'luck', 0)); self.item_locks = [False, False, False]; return
        # keep locked items
        new_items = roll_items(self.rng, 3)
        for i in range(3):
            if not self.item_locks[i]: self.shop_items[i] = new_items[i]

    def pick_character(self, idx):
        # start immediately
        self.start_new_run(idx)

    def start_new_run(self, arch_idx):
        # new run
        arch = ARCHETYPES[arch_idx]; self.player = Player(pygame.math.Vector2(VIRTUAL_W / 2, VIRTUAL_H / 2), arch)
        self.enemies.empty(); self.bullets.empty(); self.enemy_bullets.empty(); self.pickups.empty()
        self.wave = 1; self.wave_time = WAVE_TIME; self.materials = 0; self.base_spawn_rate = 0.72
        self.particles.clear(); self.dtexts.clear(); self.tracers.clear(); self.pets.clear()
        self.biome = pick_biome(self.rng); self.pick_quest()
        self.wind.xy = (0, 0); self.wind_phase = 0.0; self.pulse_t = 0.0; self.jungle_slow = 1.0; self.next_biome = None

    def run(self):
        running = True; char_idx_hover = -1
        while running:
            dt = min(self.clock.tick_busy_loop(int(self.fps_cap) if self.fps_cap is not None else 0) / 1000.0, 0.05)
            event = None
            for e in pygame.event.get():
                event = e
                if e.type == pygame.QUIT: running = False
                if e.type == pygame.KEYDOWN and e.key == pygame.K_ESCAPE:
                    if self.state == STATE_PLAY: self.state = STATE_PAUSE
                    elif self.state == STATE_PAUSE: self.state = STATE_PLAY
                mx, my = pygame.mouse.get_pos(); vmx, vmy = mx / self.scale_x, my / self.scale_y
                if self.state == STATE_MENU:
                    if self.start_btn.clicked(vmx, vmy, e): self.state = STATE_CHAR_SELECT; self.fade = 1.0
                    if self.menu_opts_btn.clicked(vmx, vmy, e): self.state = STATE_MENU_OPTS; self.fade = 1.0
                elif self.state == STATE_CHAR_SELECT:
                    idx_hover = self.draw_char_select()
                    if e.type == pygame.KEYDOWN and e.key == pygame.K_ESCAPE:
                        self.state = STATE_MENU
                    elif e.type == pygame.MOUSEBUTTONDOWN and e.button == 1 and idx_hover != -1:
                        self.pick_character(idx_hover)
                        self.state = STATE_DIFFICULTY
                        self.fade = 1.0
                elif self.state == STATE_DIFFICULTY:
                    if self.diff_choice.clicked(vmx, vmy, e): pass
                    if self.diff_confirm.clicked(vmx, vmy, e):
                        self.locked_difficulty = self.diff_choice.value()
                        self.state = STATE_PLAY; self.fade = 1.0
                elif self.state == STATE_SHOP:
                    if e.type == pygame.MOUSEBUTTONDOWN and e.button == 1:
                        # locks
                        for i in range(3):
                            lr = getattr(self, f'lock_rect_{i}')
                            if lr.collidepoint(vmx, vmy):
                                self.item_locks[i] = not self.item_locks[i]
                        # buy
                        for i, rect in enumerate(self.item_rects):
                            if rect.collidepoint(vmx, vmy):
                                item = self.shop_items[i]
                                if self.player.cash >= item['cost']:
                                    self.player.cash -= item['cost']
                                    apply_item(self.player, item, self)
                                    self.player.hp = clamp(self.player.hp + 6, 0, self.player.max_hp)
                                    if not self.item_locks[i]:
                                        self.shop_items[i] = roll_items(self.rng, 1, self.wave, getattr(self.player, 'luck', 0))[0]
                        # reroll
                        if self.reroll_btn.clicked(vmx, vmy, e):
                            if self.player.cash >= 5:
                                self.player.cash -= 5
                                self.roll_shop()
                        if self.next_btn.clicked(vmx, vmy, e):
                            self.state = STATE_PREVIEW
                            self.story_phase = 0
                            self.story_idx = 0
                            self.story_timer = 0.0
                            self.story_fast = False
                            self.fade = 1.0
                elif self.state == STATE_PREVIEW:
                    # story controls
                    if e.type == pygame.MOUSEBUTTONDOWN:
                        if e.button == 1:
                            mx, my = pygame.mouse.get_pos()
                            vmx, vmy = mx / self.scale_x, my / self.scale_y
                            self.story_fast = True
                            nxt = self.wave + 1
                            beats = self.story_data.get(nxt)
                            if self.story_phase == 0 and not self.story_skip_all and beats:
                                if hasattr(self, 'story_skip_rect') and self.story_skip_rect.collidepoint(vmx, vmy):
                                    self.story_skip_all = not self.story_skip_all
                                elif hasattr(self, 'story_btn_prev') and self.story_btn_prev.collidepoint(vmx, vmy):
                                    if self.story_idx > 0:
                                        self.story_idx -= 1; self.story_timer = 0
                                elif hasattr(self, 'story_btn_next') and self.story_btn_next.collidepoint(vmx, vmy):
                                    if self.story_timer < len(beats[self.story_idx][1]):
                                        self.story_timer = 9999
                                    else:
                                        if self.story_idx < len(beats) - 1:
                                            self.story_idx += 1; self.story_timer = 0
                                        else:
                                            self.story_phase = 1; self.story_idx = 0; self.story_timer = 0; self.story_fast = False
                                else:
                                    if self.story_timer < len(beats[self.story_idx][1]):
                                        self.story_timer = 9999
                                    else:
                                        if self.story_idx < len(beats) - 1:
                                            self.story_idx += 1; self.story_timer = 0
                                        else:
                                            self.story_phase = 1; self.story_idx = 0; self.story_timer = 0; self.story_fast = False

                                pass
                    elif e.type == pygame.MOUSEBUTTONUP and e.button == 1:
                        self.story_fast = False
                    elif e.type == pygame.KEYDOWN and e.key == pygame.K_SPACE:
                        nxt = self.wave + 1
                        beats = self.story_data.get(nxt)
                        if self.story_phase == 0 and not self.story_skip_all and beats:
                            if self.story_timer < len(beats[self.story_idx][1]):
                                self.story_timer = 9999
                            else:
                                if self.story_idx < len(beats) - 1:
                                    self.story_idx += 1; self.story_timer = 0
                                else:
                                    self.story_phase = 1; self.story_idx = 0; self.story_timer = 0; self.story_fast = False

                            pass


                    if e.type == pygame.MOUSEBUTTONDOWN and e.button == 1:
                        if self.story_phase == 0 and not self.story_skip_all and (self.wave + 1) in self.story_data:
                            continue
                        # next wave
                        for g in (self.enemies, self.bullets, self.enemy_bullets, self.pickups):
                            for s in g: s.kill()
                        self.wave += 1; self.wave_time = WAVE_TIME + min(15, self.wave * 0.6)
                        self.biome = self.next_biome or pick_biome(self.rng); self.next_biome = None
                        self.pick_quest(); self.state = STATE_PLAY; self.fade = 1.0
                    # game over
                elif self.state == STATE_GAMEOVER:
                    if e.type == pygame.MOUSEBUTTONDOWN and e.button == 1: self.state = STATE_MENU; self.reset_run()
            # draw
            if self.state == STATE_PLAY: self.update_play(dt); self.draw_play()
            elif self.state == STATE_MENU: self.draw_menu()
            elif self.state == STATE_CHAR_SELECT: self.draw_char_select()
            elif self.state == STATE_DIFFICULTY: self.draw_difficulty()
            elif self.state == STATE_SHOP: self.draw_shop()
            elif self.state == STATE_PREVIEW: self.draw_preview()
            elif self.state == STATE_GAMEOVER:
                self.surface.blit(self.bg_grad, (0, 0))
                t1 = self.huge.render('Game Over', True, WHITE); t2 = self.big.render(f'Wave reached: {self.wave}', True, (230, 200, 200)); t3 = self.font.render('Click to return to menu.', True, (210, 210, 220))
                self.surface.blit(t1, (VIRTUAL_W // 2 - t1.get_width() // 2, 380)); self.surface.blit(t2, (VIRTUAL_W // 2 - t2.get_width() // 2, 480)); self.surface.blit(t3, (VIRTUAL_W // 2 - t3.get_width() // 2, 540))
            elif self.state == STATE_PAUSE: self.draw_play(); self.draw_pause(event)
            elif self.state == STATE_MENU_OPTS: self.draw_menu_options(event)

            if self.fade > 0:
                self.fade -= dt * 1.8; overlay = pygame.Surface((VIRTUAL_W, VIRTUAL_H), pygame.SRCALPHA); overlay.fill((0, 0, 0, int(255 * max(0, self.fade)))); self.surface.blit(overlay, (0, 0))
            scaled = pygame.transform.smoothscale(self.surface, (self.screen_w, self.screen_h)); self.display.blit(scaled, (0, 0)); pygame.display.flip()
        pygame.quit()



class Player(pygame.sprite.Sprite):
    def __init__(self, pos, archetype):
        super().__init__()
        self.base_img = pygame.Surface((34, 34), pygame.SRCALPHA)
        pygame.draw.circle(self.base_img, WHITE, (17, 17), 17); pygame.draw.circle(self.base_img, (60, 60, 60), (17, 17), 12, 2)
        self.image = self.base_img.copy(); self.rect = self.image.get_rect(center=pos)
        self.pos = pygame.math.Vector2(pos); self.vel = pygame.math.Vector2(0, 0)
        self.speed = 430; self.max_hp = 110; self.hp = self.max_hp
        self.armor = 0; self.damage = 14; self.attack_speed = 1.0; self.cooldown = 0
        self.luck = 0
        self.crit_chance = 0.2
        self.crit_mult = 1.5
        self.bullets = 1; self.bullet_speed = 900; self.bullet_spread = 0.1
        self.lifesteal = 0.0; self.pickup_range = 170
        self.arch = archetype
        self.health_regen = 0.0
        self.iframe = 0.0
        # dash
        self.dash_cd_max = 1.2
        self.dash_cd = 0.0
        self.dashing = False
        self.dash_t = 0.0
        self.dash_time = 0.18
        self.dash_speed = 1200
        self.dash_dir = pygame.math.Vector2(1, 0)
        self._dash_prev = False

        self.range_px = self.arch.get('range_px', 850)
        self.level = 1; self.xp = 0; self.xp_to_next = 999999999
        self.cash = STARTING_CASH
        a = archetype
        self.damage = int(self.damage * a.get('dmg_mul', 1.0)) + a.get('dmg_add', 0)
        self.max_hp = int(self.max_hp * a.get('hp_mul', 1.0)) + a.get('hp_add', 0); self.hp = self.max_hp
        self.speed = int(self.speed * a.get('spd_mul', 1.0)) + a.get('spd_add', 0)
        self.attack_speed *= a.get('atkspd_mul', 1.0)
        self.bullets = a.get('bullets', self.bullets)
        self.bullet_speed += a.get('bullet_speed_add', 0)
        self.bullet_spread = a.get('spread', self.bullet_spread)
        self.lifesteal += a.get('lifesteal_add', 0.0)
    def update(self, dt, keys, jungle_slow=1.0):
        # timers
        if self.iframe > 0:
            self.iframe = max(0.0, self.iframe - dt)
        if self.health_regen > 0 and self.hp > 0:
            self.hp = clamp(self.hp + self.health_regen * dt, 0, self.max_hp)
        desire = pygame.math.Vector2(0, 0)
        if keys[pygame.K_w]: desire.y -= 1
        if keys[pygame.K_s]: desire.y += 1
        if keys[pygame.K_a]: desire.x -= 1
        if keys[pygame.K_d]: desire.x += 1
        if desire.length_squared() > 0: desire = desire.normalize()
        b = BIOMES[game.biome] if 'game' in globals() else {}
        spd_mul = b.get('player_spd_mul', 1.0) * jungle_slow
        friction = b.get('friction', None)
        target_vel = desire * (self.speed * spd_mul)
        # dash
        dash_key = keys[pygame.K_LSHIFT] or keys[pygame.K_RSHIFT]
        if self.dash_cd > 0: self.dash_cd = max(0.0, self.dash_cd - dt)
        if dash_key and not self._dash_prev and self.dash_cd <= 0.0:
            # dash direction
            if desire.length_squared() > 0:
                self.dash_dir = desire.normalize()
            else:
                try:
                    mx, my = pygame.mouse.get_pos()
                    vmx, vmy = mx / game.scale_x, my / game.scale_y
                    v = pygame.math.Vector2(vmx, vmy) - self.pos
                    self.dash_dir = v.normalize() if v.length_squared() > 0 else pygame.math.Vector2(1, 0)
                except Exception:
                    self.dash_dir = pygame.math.Vector2(1, 0)
            self.dashing = True; self.dash_t = self.dash_time; self.dash_cd = self.dash_cd_max; self.iframe = max(self.iframe, self.dash_time + 0.3)
        self._dash_prev = dash_key
        # dashing
        if self.dashing:
            self.dash_t -= dt
            target_vel = self.dash_dir * (self.dash_speed * spd_mul)
            if self.dash_t <= 0:
                self.dashing = False
        if friction is not None:
            self.vel = self.vel.lerp(target_vel, 0.12) * (friction ** (dt * 60))
        else:
            self.vel = target_vel
        self.pos += self.vel * dt
        self.pos.x = clamp(self.pos.x, 18, VIRTUAL_W - 18); self.pos.y = clamp(self.pos.y, 18, VIRTUAL_H - 18)
        self.rect.center = (int(self.pos.x), int(self.pos.y))
        if self.cooldown > 0: self.cooldown -= dt * self.attack_speed
    def take_damage(self, amount):
        if getattr(self, 'iframe', 0.0) > 0.0:
            return
        reduced = max(1, int(amount * (100 / (100 + self.armor)))); self.hp -= reduced
    def heal_on_hit(self):
        if self.lifesteal > 0 and random.random() < self.lifesteal: self.hp = clamp(self.hp + 1, 0, self.max_hp)

    def gain_xp(self, n):
        # xp disabled
        pass

    # bullet life from range

    def _life_for_speed(self, speed, default_life):
        # cap travel distance to range_px
        if speed <= 1: return default_life
        max_life = self.range_px / float(speed)
        return min(default_life, max(0.1, max_life))

    def _fire_once_by_arch(self, angle, bullets_group, rng, tracers):
        name = self.arch['name']
        muzzle = pygame.math.Vector2(math.cos(angle), math.sin(angle))
        if name == 'Netrunner (Deck)':
            ang = angle + rng.uniform(-0.02, 0.02); vel = pygame.math.Vector2(math.cos(ang), math.sin(ang)) * (self.bullet_speed + 220)
            end = self.pos + muzzle * 28; tracers.append(Tracer(end, end + muzzle * 40))
            bullets_group.add(Bullet(self.pos, vel, int(self.damage * 1.2), life=2.2, color=(230, 240, 255), radius=6))
        elif name == 'Solo (Scattergun)':
            for i in range(6):
                ang = angle + rng.uniform(-0.22, 0.22); speed = self.bullet_speed * rng.uniform(0.6, 0.9)
                vel = pygame.math.Vector2(math.cos(ang), math.sin(ang)) * speed; bullets_group.add(Bullet(self.pos, vel, int(self.damage * 0.6), life=0.6, color=(255, 230, 160), radius=7))
        elif name == 'Courier (SMG)':
            for i in range(2):
                ang = angle + rng.uniform(-0.1, 0.1); vel = pygame.math.Vector2(math.cos(ang), math.sin(ang)) * (self.bullet_speed + 50)
                bullets_group.add(Bullet(self.pos, vel, int(self.damage * 0.7), life=1.6, color=(200, 230, 255), radius=5))
        elif name == 'Vamp (Ion Beam)':
            ang = angle; vel = pygame.math.Vector2(math.cos(ang), math.sin(ang)) * (self.bullet_speed * 0.75)
            bullets_group.add(Bullet(self.pos, vel, int(self.damage * 1.1), life=2.5, pierce=2, color=(140, 220, 255), radius=8))
        else:
            vel = pygame.math.Vector2(math.cos(angle), math.sin(angle)) * self.bullet_speed; bullets_group.add(Bullet(self.pos, vel, self.damage, radius=6))
    def fire_pattern(self, target_pos, bullets_group, rng, tracers):
        base_dir = pygame.math.Vector2(target_pos) - self.pos
        if base_dir.length_squared() < 1e-6: return
        base_angle = math.atan2(base_dir.y, base_dir.x)
        count = max(1, int(self.bullets)); spread = max(0.06, self.bullet_spread)
        offsets = [(i - (count - 1) / 2.0) * spread for i in range(count)]
        for off in offsets: self._fire_once_by_arch(base_angle + off, bullets_group, rng, tracers)
    def try_fire(self, bullets_group, enemies, rng, tracers, manual_fire=False, mouse_pos=None, mouse_down=False):
        if self.cooldown > 0: return
        if manual_fire:
            if not mouse_down: return
            target = mouse_pos if mouse_pos is not None else self.pos + pygame.math.Vector2(1, 0)
        else:
            if len(enemies) == 0: return
            nearest = min(enemies, key=lambda e: (e.pos - self.pos).length_squared())
            if (nearest.pos - self.pos).length() > self.range_px:
                return
            target = nearest.pos
        self.fire_pattern(target, bullets_group, rng, tracers); self.cooldown = self.arch.get('base_cd', 0.5)

if __name__ == '__main__':

    game = Game()
    game.run()
