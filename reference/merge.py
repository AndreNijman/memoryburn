"""Merge reference/parts/* into reference/MemoryBurn.py (the rebuilt original source)."""
import os, re

HERE = os.path.dirname(os.path.abspath(__file__))
P = os.path.join(HERE, 'parts')


def read(name):
    return open(os.path.join(P, name)).read().rstrip('\n') + '\n'


def sections(text):
    # split partB_top.py at its '# @@BEGIN X@@' markers
    out = {}
    cur = None
    for line in text.splitlines(keepends=True):
        m = re.match(r'# @@BEGIN (\w+)@@', line)
        if m:
            cur = m.group(1); out[cur] = ''; continue
        if cur:
            out[cur] += line
    return {k: v.strip('\n') + '\n' for k, v in out.items()}


top = sections(read('partB_top.py'))
game = read('partB_game.py') + '\n' + read('partC_game.py') + '\n' + read('partD_game.py')
blocks = dict(top, Game=game, Player=read('partD_player.py'))

src = read('partA.py')
for name, body in blocks.items():
    marker = '# @@PART %s@@' % name
    assert src.count(marker) == 1, marker
    src = src.replace(marker, body.rstrip('\n'))
assert '@@PART' not in src
open(os.path.join(HERE, 'MemoryBurn.py'), 'w').write(src)
print('wrote reference/MemoryBurn.py', src.count('\n'), 'lines')
