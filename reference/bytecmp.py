"""Compare reconstructed Python source against the original MemoryBurn.pyc bytecode.

Usage (must run under Python 3.11, e.g. ~/.local/share/memoryburn/venv/bin/python):
  python -I reference/bytecmp.py <source.py> [--class Game] [--only QUALNAME ...] [--diff]

--class NAME   the fragment is a set of methods indented 4 spaces; it is wrapped in `class NAME:`
--only         restrict to these qualnames (prefix match on e.g. "Game.update_play")
--diff         print a unified diff of the first mismatching code objects

Compares, per code object qualname present in the source, the sequence of (opname, normalised argrepr).
Offsets and line numbers are ignored. Exit code 0 when every compared code object matches.
"""
import dis, marshal, re, sys, types, difflib, os

HERE = os.path.dirname(os.path.abspath(__file__))
PYC = os.path.join(HERE, '..', 'MemoryBurn.pyc')

CODE_RE = re.compile(r'<code object (\S+) at 0x[0-9a-f]+, file "[^"]*", line \d+>')


def norm(ins):
    a = ins.argrepr
    a = CODE_RE.sub(lambda m: '<code ' + m.group(1) + '>', a)
    if ins.opname.startswith(('JUMP', 'POP_JUMP', 'FOR_ITER', 'SEND')) or 'JUMP' in ins.opname:
        a = ''  # target offsets shift with any upstream change; structure is checked by opnames
    return ins.opname + ' ' + a


def collect(co, out, wrapper=None):
    for k in co.co_consts:
        if isinstance(k, types.CodeType):
            q = k.co_qualname
            if wrapper and not q.startswith(wrapper + '.') and q != wrapper:
                q = q  # nested inside wrapper class keeps Game.x qualname anyway
            out.setdefault(q, []).append([norm(i) for i in dis.get_instructions(k)])
            collect(k, out, wrapper)
    return out


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__); sys.exit(2)
    src_path = args[0]
    cls = None; only = []; show = '--diff' in args
    if '--class' in args:
        cls = args[args.index('--class') + 1]
    if '--only' in args:
        i = args.index('--only') + 1
        while i < len(args) and not args[i].startswith('--'):
            only.append(args[i]); i += 1
    src = open(src_path).read()
    if cls:
        src = 'class ' + cls + ':\n' + src
    try:
        new = compile(src, 'MemoryBurn.py', 'exec')
    except SyntaxError as e:
        print('SYNTAX ERROR:', e); sys.exit(1)
    d = open(PYC, 'rb').read()
    orig = marshal.loads(d[16:])
    o = collect(orig, {})
    n = collect(new, {})
    if cls:
        n.pop(cls, None)  # the synthetic wrapper class body is not comparable
    bad = 0; good = 0; shown = 0
    if '--module' in args:  # whole-file check: also compare the module body itself
        o['<module>'] = [[norm(i) for i in dis.get_instructions(orig)]]
        n['<module>'] = [[norm(i) for i in dis.get_instructions(new)]]
    for q, lst in n.items():
        if '<' in q.split('.')[-1]:
            continue  # comprehensions/lambdas are compared through their parent's const list
        if only and not any(q.startswith(p) for p in only):
            continue
        if q not in o:
            print('EXTRA   ', q, '(not in original)'); bad += 1; continue
        if lst == o[q]:
            good += 1
            # also check nested comprehensions/lambdas of this function
            continue
        bad += 1
        a, b = o[q][0], lst[0]
        sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
        print('MISMATCH', q, 'orig %d ins, new %d ins, ratio %.3f' % (len(a), len(b), sm.ratio()))
        if show and shown < 3:
            shown += 1
            for line in difflib.unified_diff(a, b, 'orig', 'new', n=3, lineterm=''):
                print('   ', line)
    # nested comprehension/lambda objects
    for q, lst in n.items():
        if '<' not in q.split('.')[-1]:
            continue
        if only and not any(q.startswith(p) for p in only):
            continue
        if q not in o or sorted(map(tuple, lst)) != sorted(map(tuple, o[q])):
            bad += 1; print('MISMATCH', q, '(nested comprehension/lambda)')
        else:
            good += 1
    print('matched %d, mismatched %d' % (good, bad))
    sys.exit(0 if bad == 0 else 1)


if __name__ == '__main__':
    main()
