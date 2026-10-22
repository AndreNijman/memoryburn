# @@BEGIN Toggle@@
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

# @@BEGIN Slider@@
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

# @@BEGIN Choice@@
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

# @@BEGIN pick_biome@@
def pick_biome(rng): return rng.choice(list(BIOMES.keys()))
