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
