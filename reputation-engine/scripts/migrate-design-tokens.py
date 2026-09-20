#!/usr/bin/env python3
"""Saturn design constitution: consolidate 153 hardcoded hexes to the canonical palette.
Pure string replacement (case-insensitive), app/ only. Idempotent."""
import re, sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent / 'app'

# canonical -> [rogue hexes to consolidate] (all lowercase, without #)
MIGRATIONS = {
    # --brand-navy #071421 — structure, ink, dark surfaces
    '071421': ['14213d','111827','243460','243560','171717','374151','1a1a1a',
               '111111','1c1c1e','3a3a3c','172033','15273a','132537','102638',
               '0f172a','344054','475569','4b5563','4d5360','57534e','4f534c',
               '5d5642','111'],
    # --brand-muted #667085 — secondary text
    '667085': ['666','6b7280','6f736a','73756e','7c766a','888','8a8478',
               '8e8e93','94a3b8','64748b','9ca3af','555'],
    # --brand-border #e5e7eb — hairlines
    'e5e7eb': ['ccc','d1d5db','d1d1d6','e2e8f0','e9e9eb','cfd6d1','f3f4f6'],
    # white
    'ffffff': ['fff'],
    # --brand-gold #c99700 — action, emphasis
    'c99700': ['e1ad01','9a762f','d0a24d','b68a3a','d9c36a','d6b53a','d5b45f',
               'd5a411','d8c477','d8c28d','b88a25','b88900','9a7014','8d6116',
               '8a6828','7c6025','9b7200','e09420','d97706'],
    # --brand-gold-dark #8a6800 — gold text that must pass contrast
    '8a6800': ['725700','725600','9a5a00','9b5b00','8a4f00','c9754e','955941',
               '9b5a3c','8a4e35'],
    # --brand-ivory #f7f4ed — warm backgrounds
    'f7f4ed': ['fbfaf6','fbfaf7','f7f4ee','faf8f2','fffdf5','fffefb','fcfbf8',
               'fff9df','fff8e8','fff7ed','fff3bd','fef3c7','fbf6e9','f7e9bc',
               'f5e6c8','f5f2e9','fbf2e4','f6ece7','f5ece7','f4efe4','f4f0e8',
               'eee7da','e9e4d9','eeddd5','fffaf0'],
    # cool wash #f9fafb — neutral surfaces
    'f9fafb': ['f0f2f5','f4f6f8','f1f3f5','f8fafc','f8f9fb','f6f8fb','f0f2f4',
               'f4f7fb','f8f9fc','f5f5f5','eef1f3'],
    # --brand-success #0f6a53
    '0f6a53': ['0b7055','0a5b47','0c5745','0c5947','1a9070','05603a','3a6f5d','315d4f'],
    # success tint bg #ecfdf3
    'ecfdf3': ['f0faf5','eef5f1','edf4f0','ecfdf5','d7f5e6','dfece5','dfe8e3','deefe8'],
    # --brand-danger #b42318
    'b42318': ['dc2626'],
    # --brand-info #1d4ed8
    '1d4ed8': ['315ead','1a4a8a'],
    # info tint bg #eff6ff
    'eff6ff': ['f0f7ff','c5d9f5'],
    # warning tint bg #fffaeb
    'fffaeb': ['fffbeb'],
}

# sanity: fix the typo guard above ('eedd5d'[:6] == 'eedd5d' is 6 chars, fine)
# rgba(r,g,b,a) triplets to canonical triplets (whitespace-tolerant)
RGBA_MIGRATIONS = {
    '201,117,78': '138,104,0',    # terracotta -> gold-dark #8A6800
    '217,119,6': '201,151,0',     # -> gold #C99700
    '245,166,35': '201,151,0',    # amber -> gold
    '245,158,11': '201,151,0',    # amber-500 -> gold
    '249,115,22': '201,151,0',    # orange-500 -> gold
    '49,94,173': '29,78,216',     # -> info #1D4ED8
    '239,68,68': '180,35,24',     # red-500 -> danger #B42318
    '228,226,220': '247,244,237', # warm light gray -> ivory
    '15,27,56': '7,20,33',        # dark navy -> navy
    '26,39,68': '7,20,33',        # dark navy -> navy
    '34,72,56': '15,106,83',      # dark green -> success
    '62,111,93': '15,106,83',     # -> success #0F6A53
    '108,92,164': '102,112,133',  # nurture purple -> muted #667085
}

EXTRA_HEX = {
    '16a34a': '0f6a53',  # email CTA green -> success
}

def build_patterns():
    pats = []
    for canonical, rogues in MIGRATIONS.items():
        for rogue in rogues:
            # match #rogue not followed by another hex char (protects 8-digit hexes)
            pats.append((re.compile(r'#' + rogue + r'(?![0-9a-fA-F])', re.IGNORECASE),
                         '#' + canonical, rogue))
    for rogue, canonical in EXTRA_HEX.items():
        pats.append((re.compile(r'#' + rogue + r'(?![0-9a-fA-F])', re.IGNORECASE),
                     '#' + canonical, rogue))
    # alpha whites -> rgba()
    pats.append((re.compile(r'#ffffffb0(?![0-9a-fA-F])', re.IGNORECASE),
                 'rgba(255,255,255,0.69)', 'ffffffb0'))
    pats.append((re.compile(r'#ffffff80(?![0-9a-fA-F])', re.IGNORECASE),
                 'rgba(255,255,255,0.5)', 'ffffff80'))
    for rogue, canonical in RGBA_MIGRATIONS.items():
        r, g, b = rogue.split(',')
        cr, cg, cb = canonical.split(',')
        pats.append((
            re.compile(r'rgba?\(\s*' + r'\s*,\s*'.join([r, g, b]) + r'\s*(,\s*[0-9.]+\s*)?\)'),
            lambda m, cr=cr, cg=cg, cb=cb: (
                f'rgba({cr},{cg},{cb},{m.group(1).strip()[1:].strip()})'
                if m.group(1) else f'rgb({cr},{cg},{cb})'),
            rogue))
    # longest first so 6-digit matches win over 3-digit subsets
    pats.sort(key=lambda p: -len(p[2]))
    return [(p, r) for p, r, _ in pats]

def main():
    pats = build_patterns()
    files_changed, total_repl = 0, 0
    for path in sorted(APP.rglob('*')):
        if not path.is_file() or path.suffix not in ('.tsx', '.ts', '.css'):
            continue
        text = path.read_text()
        orig = text
        for pat, repl in pats:
            text, n = pat.subn(repl, text)
            total_repl += n
        if text != orig:
            path.write_text(text)
            files_changed += 1
    print(f'files changed: {files_changed}, replacements: {total_repl}')

if __name__ == '__main__':
    main()
