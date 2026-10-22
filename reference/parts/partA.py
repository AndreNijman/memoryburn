


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

# @@PART Toggle@@

# @@PART Slider@@

# @@PART Choice@@

BIOMES = {
    'Neon Grid': {'bg': (10, 12, 18), 'notes': 'Clean lanes. Standard.', 'player_spd_mul': 1.0, 'bullet_spd_mul': 1.0},
    'Rain Alley': {'bg': (12, 16, 24), 'notes': 'Slick streets. Lower friction.', 'player_spd_mul': 1.05, 'friction': 0.985, 'snow': True},
    'Dust Slums': {'bg': (28, 24, 20), 'notes': 'Grime. Lower pickup.', 'player_spd_mul': 0.95, 'pickup_mul': 0.8, 'dust': True},
    'Vine Mesh': {'bg': (16, 28, 24), 'notes': 'Constricting cables. Slow pulses.', 'player_spd_mul': 0.95, 'pulse_slow': 0.8},
    'Jetstream': {'bg': (14, 16, 26), 'notes': 'Crosswind from air vents.', 'bullet_spd_mul': 0.95, 'wind': True},
    'Reactor Core': {'bg': (26, 10, 14), 'notes': 'Heat bleed. Minor HP drain.', 'hp_drain': 0.5, 'embers': True},
    'Midnight District': {'bg': (8, 10, 16), 'notes': 'Dim cams. More spawns.', 'spawn_mul': 1.1, 'dim': 0.25},
}

# @@PART pick_biome@@

# @@PART Game@@

# @@PART Player@@

if __name__ == '__main__':

    game = Game()
    game.run()
