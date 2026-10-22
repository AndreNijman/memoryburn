# Source Generated with Decompyle++
# File: MemoryBurn.pyc (Python 3.11)

import sys
import os

def resource_path(rel):
    if hasattr(sys, '_MEIPASS'):
        return os.path.join(sys._MEIPASS, rel)
    return None.path.join(os.path.abspath('.'), rel)

import math
import random
import pygame
(VIRTUAL_W, VIRTUAL_H) = (1920, 1080)
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
RARITY_COL = {
    'common': (120, 160, 200),
    'uncommon': (80, 240, 200),
    'rare': (120, 220, 255),
    'epic': (255, 140, 240) }
STATE_MENU = 0
STATE_CHAR_SELECT = 1
STATE_DIFFICULTY = 2
STATE_PLAY = 3
STATE_SHOP = 4
STATE_PREVIEW = 5
STATE_GAMEOVER = 6
STATE_PAUSE = 7
STATE_MENU_OPTS = 8

def clamp(a, lo, hi):
    return max(lo, min(hi, a))


class ScreenShake:
    
    def __init__(self):
        (self.t, self.mag) = (0, 0)

    
    def add(self, mag, dur = (0.15,)):
        self.t = max(self.t, dur)
        self.mag = max(self.mag, mag)

    
    def offset(self, rng):
        if self.t <= 0 or self.mag <= 0:
            return (0, 0)
        ang = None.uniform(0, math.tau)
        m = self.mag * (self.t / 0.15)
        return (math.cos(ang) * m, math.sin(ang) * m)

    
    def update(self, dt):
        self.t = max(0, self.t - dt)



class Particle:
    
    def __init__(self, pos, vel, life, color, radius, grow = (False,)):
        self.pos = pygame.math.Vector2(pos)
        self.vel = pygame.math.Vector2(vel)
        self.life = life
        self.max_life = life
        self.color = color
        self.radius = radius
        self.grow = grow
        d = radius * 2
        self._surf = pygame.Surface((d, d), pygame.SRCALPHA).convert_alpha()
    # WARNING: Decompyle incomplete

    
    def update(self, dt):
        pass

    
    def draw(self, surf):
        if self.life <= 0:
            return None
        t = None.life / self.max_life
        alpha = int(255 * t)
        r_scale = 1 + 1.2 if self.grow else 0 * (1 - t)
        d = max(2, int(self.radius * 2 * r_scale))
        if self._last_d != d:
            self._scaled = pygame.transform.smoothscale(self._surf, (d, d))
            self._last_d = d
        self._scaled.set_alpha(alpha)
        surf.blit(self._scaled, (self.pos.x - d // 2, self.pos.y - d // 2))



class Tracer:
    
    def __init__(self, a, b, life = (0.08,)):
        self.a = pygame.math.Vector2(a)
        self.b = pygame.math.Vector2(b)
        self.life = life
        self.max_life = life

    
    def update(self, dt):
        pass

    
    def draw(self, surf):
        if self.life <= 0:
            return None
        None.draw.line(surf, (255, 255, 255), self.a, self.b, 2)



class DmgText:
    
    def __init__(self, pos, text, color, life = ((255, 240, 200), 0.9)):
        self.pos = pygame.math.Vector2(pos)
        self.vel = pygame.math.Vector2(0, -60)
        self.text = str(text)
        self.life = life
        self.max_life = life
        self.color = color
        self.alpha = 255

    
    def update(self, dt):
        max(0, self.life / self.max_life) = self, self.life -= dt, .life
        self.alpha = int(255 * t)

    
    def draw(self, surf, font):
        if self.life <= 0:
            return None
        s = None.render(self.text, True, self.color)
        s.set_alpha(self.alpha)
        surf.blit(s, (self.pos.x - s.get_width() / 2, self.pos.y - s.get_height() / 2))



class Bullet(pygame.sprite.Sprite):
    pass
# WARNING: Decompyle incomplete


class EnemyBullet(pygame.sprite.Sprite):
    pass
# WARNING: Decompyle incomplete

LETTER_MAP = {
    'scrap': 'S',
    'brute': 'B',
    'skater': 'K',
    'suicide': 'X',
    'aegis': 'A',
    'sentry': 'T',
    'overlord': 'O' }

class Enemy(pygame.sprite.Sprite):
    pass
# WARNING: Decompyle incomplete


def spawn_enemy(rng, wave, kind = (None,)):
    pass
# WARNING: Decompyle incomplete


class Pickup(pygame.sprite.Sprite):
    pass
# WARNING: Decompyle incomplete


class Pet:
    
    def __init__(self, kind):
        self.kind = kind
        self.pos = pygame.math.Vector2(VIRTUAL_W / 2, VIRTUAL_H / 2)
        self.cd = 0

    
    def update(self, dt, player, bullets, rng):
        t = pygame.time.get_ticks() / 1000
        radius = 50 if self.kind == 'turret_buddy' else 70
        ang = t * 2 if self.kind != 'magnet_drone' else t * 1.5
        self.pos = player.pos + pygame.math.Vector2(math.cos(ang), math.sin(ang)) * radius
        if self.kind == 'turret_buddy':
            if self.cd <= 0:
                0.6 = self, self.cd -= dt, .cd
                bullets.add(Bullet(self.pos, pygame.math.Vector2(900, 0).rotate(rng.uniform(0, 360)), dmg = 8, life = 1.2, color = (255, 230, 180), radius = 5))
                return None
            return self, self.cd -= dt, .cd
        if None.kind == 'magnet_drone':
            return None
        if None.kind == 'heal_bot' or self.cd <= 0:
            2.8 = self, self.cd -= dt, .cd
            player.hp = min(player.max_hp, player.hp + 2)
            return None
        return self, self.cd -= dt, .cd


ARCHETYPES = [
    {
        'name': 'Netrunner (Deck)',
        'desc': 'Data spikes. Balanced.',
        'base_cd': 0.38,
        'dmg_mul': 1.1,
        'atkspd_mul': 1.1,
        'bullet_speed_add': 220,
        'spread': 0.06,
        'range_px': 900 },
    {
        'name': 'Solo (Scattergun)',
        'desc': 'Close quarters. Big HP.',
        'hp_mul': 1.35,
        'base_cd': 0.6,
        'dmg_mul': 1.3,
        'spd_mul': 0.9,
        'spread': 0.14,
        'range_px': 520 },
    {
        'name': 'Courier (SMG)',
        'desc': 'Very fast. Low per shot.',
        'spd_mul': 1.2,
        'base_cd': 0.22,
        'dmg_mul': 0.75,
        'atkspd_mul': 1.2,
        'spread': 0.08,
        'range_px': 700 },
    {
        'name': 'Vamp (Ion Beam)',
        'desc': 'Piercing ion beam. Lifesteal.',
        'base_cd': 0.48,
        'dmg_mul': 1.15,
        'lifesteal_add': 0.08,
        'spread': 0.08,
        'range_px': 1000 },
    {
        'name': 'Techno Monk',
        'desc': 'Calm aim. Fewer bullets, harder hits.',
        'base_cd': 0.44,
        'dmg_mul': 1.35,
        'atkspd_mul': 0.95,
        'spread': 0.04,
        'range_px': 800 },
    {
        'name': 'Riot Runner',
        'desc': 'Extreme mobility. Fragile.',
        'spd_mul': 1.4,
        'base_cd': 0.26,
        'dmg_mul': 0.85,
        'atkspd_mul': 1.25,
        'bullet_speed_add': 120,
        'spread': 0.09,
        'range_px': 750 },
    {
        'name': 'Steel Witch',
        'desc': 'Slow cast. Heavy pierce.',
        'base_cd': 0.7,
        'dmg_mul': 1.55,
        'atkspd_mul': 0.85,
        'bullet_speed_add': 260,
        'spread': 0.05,
        'range_px': 950 },
    {
        'name': 'Junk Saint',
        'desc': 'Tanky scav. Big pickup radius.',
        'hp_mul': 1.5,
        'base_cd': 0.5,
        'dmg_mul': 1.05,
        'pickup_add': 160,
        'spread': 0.1,
        'range_px': 650 }]
ITEM_POOL = [][{
    'name': 'Cursed Contract',
    'mods': [
        {
            'stat': 'damage',
            'kind': 'percent',
            'amt': 18 },
        {
            'stat': 'luck',
            'amt': -10 }],
    'cost': 44,
    'desc': '+18% damage, -10 Luck',
    'rarity': 'uncommon' }][{
    'name': 'Hexed Cartridge',
    'mods': [
        {
            'stat': 'crit_mult',
            'amt': 0.25 },
        {
            'stat': 'luck',
            'amt': -8 }],
    'cost': 48,
    'desc': '+0.25x crit, -8 Luck',
    'rarity': 'uncommon' }][{
    'name': 'Lucky Chip',
    '+stat': 'luck',
    '+amt': 8,
    'cost': 60,
    'desc': '+8 Luck',
    'rarity': 'common' }][{
    'name': 'Rabbit Foot',
    '+stat': 'luck',
    '+amt': 15,
    'cost': 110,
    'desc': '+15 Luck',
    'rarity': 'rare' }][{
    'name': 'Sharpened Logic',
    '+stat': 'crit_chance',
    '+amt': 0.08,
    'cost': 52,
    'desc': '+8% Crit Chance',
    'rarity': 'uncommon' }][{
    'name': 'Overvolt Lens',
    '+stat': 'crit_mult',
    '+amt': 0.4,
    'cost': 62,
    'desc': '+0.4x Crit Damage',
    'rarity': 'rare' }][{
    'name': 'Glass Processor',
    'mods': [
        {
            'stat': 'damage',
            'kind': 'percent',
            'amt': 35 },
        {
            'stat': 'max_hp',
            'kind': 'percent',
            'amt': -20 }],
    'cost': 42,
    'desc': '+35% damage, -20% max HP',
    'rarity': 'uncommon' }][{
    'name': 'Heavy Armor Kit',
    'mods': [
        {
            'stat': 'armor',
            'amt': 4 },
        {
            'stat': 'speed',
            'amt': -80 }],
    'cost': 44,
    'desc': '+4 armor, -80 speed',
    'rarity': 'uncommon' }][{
    'name': 'Recoil Dampener',
    'mods': [
        {
            'stat': 'attack_speed',
            'amt': -0.12 },
        {
            'stat': 'damage',
            'kind': 'percent',
            'amt': 20 }],
    'cost': 40,
    'desc': '+20% damage, -0.12 atkspd',
    'rarity': 'uncommon' }][{
    'name': 'Hollow Battery',
    'mods': [
        {
            'stat': 'attack_speed',
            'amt': 0.35 },
        {
            'stat': 'max_hp',
            'amt': -10 }],
    'cost': 46,
    'desc': '+0.35 atkspd, -10 max HP',
    'rarity': 'rare' }][{
    'name': 'Lead Boots',
    'mods': [
        {
            'stat': 'armor',
            'amt': 2 },
        {
            'stat': 'speed',
            'amt': -120 }],
    'cost': 30,
    'desc': '+2 armor, -120 speed',
    'rarity': 'common' }][{
    'name': 'Gilded Magnet',
    'mods': [
        {
            'stat': 'pickup',
            'amt': 180 },
        {
            'stat': 'damage',
            'kind': 'percent',
            'amt': -10 }],
    'cost': 28,
    'desc': '+180 pickup, -10% damage',
    'rarity': 'common' }][{
    'name': 'Overclock Gel',
    '+stat': 'damage',
    '+amt': 6,
    'cost': 26,
    'desc': '+6% firepower',
    'rarity': 'common' }][{
    'name': 'Auto-Loader',
    '+stat': 'attack_speed',
    '+amt': 0.18,
    'cost': 30,
    'desc': '+18% rate of fire',
    'rarity': 'common' }][{
    'name': 'Kinetic Boots',
    '+stat': 'speed',
    '+amt': 60,
    'cost': 24,
    'desc': '+60 sprint',
    'rarity': 'common' }][{
    'name': 'Reactive Plating',
    '+stat': 'armor',
    '+amt': 3,
    'cost': 28,
    'desc': '+3 plating',
    'rarity': 'uncommon' }][{
    'name': 'Nano-Injector',
    '+stat': 'max_hp',
    '+amt': 15,
    'cost': 22,
    'desc': '+15 max HP',
    'rarity': 'common' }][{
    'name': 'Vacuum Drone',
    '+stat': 'pickup',
    '+amt': 80,
    'cost': 18,
    'desc': '+80 loot radius',
    'rarity': 'common' }][{
    'name': 'Hemopump',
    '+stat': 'lifesteal',
    '+amt': 0.08,
    'cost': 30,
    'desc': '+8% siphon',
    'rarity': 'uncommon' }][{
    'name': 'Gyro Stabilizer',
    '+stat': 'bullet_speed',
    '+amt': 160,
    'cost': 24,
    'desc': '+160 projectile speed',
    'rarity': 'common' }][{
    'name': 'Fork Module',
    '+stat': 'bullets',
    '+amt': 1,
    'cost': 44,
    'desc': '+1 projectile',
    'rarity': 'rare' }][{
    'name': 'Clock Signal',
    '+stat': 'attack_speed',
    '+amt': 0.35,
    'cost': 55,
    'desc': '+35% rate of fire',
    'rarity': 'rare' }][{
    'name': 'Adrenal Surge',
    '+stat': 'speed',
    '+amt': 120,
    'cost': 60,
    'desc': '+120 sprint',
    'rarity': 'epic' }][{
    'name': 'Drone: Gunpod',
    '+stat': 'pet',
    '+amt': 'turret_buddy',
    'cost': 120,
    'desc': 'Orbiting turret that shoots.',
    'rarity': 'epic' }][{
    'name': 'Drone: VacuBot',
    '+stat': 'pet',
    '+amt': 'magnet_drone',
    'cost': 110,
    'desc': 'Orbiting drone that boosts pickup.',
    'rarity': 'rare' }][{
    'name': 'Drone: Medbot',
    '+stat': 'pet',
    '+amt': 'heal_bot',
    'cost': 130,
    'desc': 'Orbiting bot that heals over time.',
    'rarity': 'epic' }][{
    'name': 'Street Prophet Ink',
    '+stat': 'damage',
    '+amt': 9,
    'cost': 34,
    'desc': '+9% firepower',
    'rarity': 'uncommon' }][{
    'name': 'Servo Fingers',
    '+stat': 'attack_speed',
    '+amt': 0.22,
    'cost': 36,
    'desc': '+22% rate of fire',
    'rarity': 'uncommon' }][{
    'name': 'Grav Skates',
    '+stat': 'speed',
    '+amt': 90,
    'cost': 38,
    'desc': '+90 sprint',
    'rarity': 'uncommon' }][{
    'name': 'Titan Ribbing',
    '+stat': 'armor',
    '+amt': 5,
    'cost': 46,
    'desc': '+5 plating',
    'rarity': 'rare' }][{
    'name': 'Blood Synth',
    '+stat': 'max_hp',
    '+amt': 25,
    'cost': 40,
    'desc': '+25 max HP',
    'rarity': 'uncommon' }][{
    'name': 'Wideband Magnet',
    '+stat': 'pickup',
    '+amt': 140,
    'cost': 42,
    'desc': '+140 loot radius',
    'rarity': 'rare' }][{
    'name': 'Hemoverse v2',
    '+stat': 'lifesteal',
    '+amt': 0.12,
    'cost': 58,
    'desc': '+12% siphon',
    'rarity': 'rare' }][{
    'name': 'Rail Guide',
    '+stat': 'bullet_speed',
    '+amt': 260,
    'cost': 40,
    'desc': '+260 projectile speed',
    'rarity': 'uncommon' }][{
    'name': 'Fork Array',
    '+stat': 'bullets',
    '+amt': 2,
    'cost': 88,
    'desc': '+2 projectiles',
    'rarity': 'epic' }][{
    'name': 'Chrono Loop',
    '+stat': 'attack_speed',
    '+amt': 0.5,
    'cost': 92,
    'desc': '+50% rate of fire',
    'rarity': 'epic' }][{
    'name': 'Blackline Booster',
    '+stat': 'speed',
    '+amt': 160,
    'cost': 90,
    'desc': '+160 sprint',
    'rarity': 'epic' }][{
    'name': 'Drone: Twin Gunpods',
    '+stat': 'pet',
    '+amt': 'turret_buddy',
    'cost': 180,
    'desc': 'Adds another turret-buddy.',
    'rarity': 'epic' }][{
    'name': 'Drone: OmniVac',
    '+stat': 'pet',
    '+amt': 'magnet_drone',
    'cost': 150,
    'desc': 'Adds another magnet drone.',
    'rarity': 'rare' }][{
    'name': 'Drone: Meds 2.0',
    '+stat': 'pet',
    '+amt': 'heal_bot',
    'cost': 170,
    'desc': 'Adds another med bot.',
    'rarity': 'epic' }][{
    'name': 'Regen Chip',
    '+stat': 'health_regen',
    '+amt': 0.5,
    'cost': 45,
    'desc': '+0.5 HP/s regen',
    'rarity': 'uncommon' }][{
    'name': 'Nanite Core',
    'mods': [
        {
            'stat': 'health_regen',
            'amt': 1.2 },
        {
            'stat': 'speed',
            'amt': -60 }],
    'cost': 70,
    'desc': '+1.2 HP/s regen, -60 speed',
    'rarity': 'rare' }]

def roll_items(rng, n, wave, luck = (3, 1, 0)):
    pass
# WARNING: Decompyle incomplete


def apply_item(p, item, game):
    if '+stat' in item:
        stat = item.get('+stat')
        amt = item.get('+amt')
        if stat == 'damage':
            p.damage = int(p.damage * (1 + amt / 100))
        elif stat == 'attack_speed':
            pass
        elif stat == 'speed':
            pass
        elif stat == 'armor':
            pass
        elif stat == 'max_hp':
            pass
        elif stat == 'pickup':
            pass
        elif stat == 'lifesteal':
            pass
        elif stat == 'bullet_speed':
            pass
        elif stat == 'bullets':
            clamp(int(p.bullets) + int(amt), 1, 16) = p, p.bullet_speed += amt, .bullet_speed
        elif stat == 'pet':
            game.pets.append(Pet(amt))
        elif stat == 'luck':
            pass
        elif stat == 'crit_chance':
            max(0, min(0.95, p.crit_chance + float(amt))) = p, p.luck += int(amt), .luck
        elif stat == 'crit_mult':
            pass
        elif stat == 'health_regen':
            pass
        return None
    None.get('mods', []) = None
    for m in mods:
        stat = m.get('stat')
        kind = m.get('kind', 'flat')
        amt = m.get('amt', 0)
        if stat in ('luck', 'crit_chance', 'crit_mult'):
            if stat == 'luck':
                if kind == 'percent':
                    p.luck = int(p.luck * (1 + amt / 100))
                
            elif stat == 'crit_chance':
                max(0, min(0.95, p.crit_chance)) = p, p.crit_chance *= 1 + amt / 100, .crit_chance if kind == 'percent' else p, p.crit_chance += float(amt), .crit_chance
            elif stat == 'crit_mult':
                pass
            continue
        if stat == 'damage':
            if kind == 'percent':
                int(max(1, p.damage * (1 + amt / 100))) = p, p.crit_mult *= 1 + amt / 100, .crit_mult if kind == 'percent' else p, p.crit_mult += float(amt), .crit_mult
                continue
            p.damage = max(1, p.damage + int(amt))
            continue
        if stat == 'attack_speed':
            if kind == 'percent':
                continue
            continue
        if stat == 'speed':
            if kind == 'percent':
                continue
            continue
        if stat == 'armor':
            if kind == 'percent':
                int(p.armor * (1 + amt / 100)) = p, p.speed += amt, .speed
                continue
            continue
        if stat == 'max_hp':
            if kind == 'percent':
                int(p.max_hp * (amt / 100)) = p, p.armor += int(amt), .armor
                continue
            continue
        if stat == 'pickup':
            if kind == 'percent':
                continue
            continue
        if stat == 'lifesteal':
            if kind == 'percent':
                continue
            continue
        if stat == 'bullet_speed':
            if kind == 'percent':
                continue
            continue
        if stat == 'bullets':
            if kind == 'percent':
                clamp(int(p.bullets * (1 + amt / 100)), 1, 16) = p, p.bullet_speed += amt, .bullet_speed
                continue
            p.bullets = clamp(int(p.bullets) + int(amt), 1, 16)
            continue
        if stat == 'pet':
            if isinstance(amt, str):
                game.pets.append(Pet(amt))
                continue
            if isinstance(amt, (int, float)):
                for _ in range(int(amt)):
                    game.pets.append(Pet('turret_buddy'))
                    return None


def make_fast_gradient(size, top, bottom = ((22, 24, 30), (30, 34, 42))):
    (w, h) = size
    tiny = pygame.Surface((1, 128))
    for y in range(128):
        t = y / 127
        col = (int(top[0] * (1 - t) + bottom[0] * t), int(top[1] * (1 - t) + bottom[1] * t), int(top[2] * (1 - t) + bottom[2] * t))
        tiny.set_at((0, y), col)
        grad = pygame.transform.smoothscale(tiny, (w, h))
        return grad


class Button:
    
    def __init__(self, rect, label, font, bg, fg, border, tooltip = ((120, 180, 255), None)):
        self.rect = pygame.Rect(rect)
        self.label = label
        self.font = font
        self.bg = bg
        self.fg = fg
        self.border = border
        self.hover = False
        self.tooltip = tooltip

    
    def draw(self, surf):
        col = (70, 78, 90) if self.hover else self.bg
        pygame.draw.rect(surf, col, self.rect, border_radius = 12)
        pygame.draw.rect(surf, self.border if self.hover else (90, 100, 120), self.rect, 2, border_radius = 12)
        t = self.font.render(self.label, True, self.fg)
        surf.blit(t, (self.rect.centerx - t.get_width() // 2, self.rect.centery - t.get_height() // 2))

    
    def update_hover(self, mx, my):
        self.hover = self.rect.collidepoint(mx, my)

    
    def clicked(self, mx, my, ev):
