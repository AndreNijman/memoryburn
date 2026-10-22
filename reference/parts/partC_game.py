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
