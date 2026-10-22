

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
