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

