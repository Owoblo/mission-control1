#!/usr/bin/env python3
"""Saturn design constitution part 2: consolidate type sizes and radii.
12 arbitrary text sizes -> named scale + 11px floor.
16 arbitrary radii -> 6-step radius scale. Pure string replacement."""
import re
from pathlib import Path

APP = Path(__file__).resolve().parent.parent / 'app'

TEXT = {
    'text-[8px]': 'text-[11px]',   # below floor -> floor
    'text-[12px]': 'text-xs',
    'text-[13px]': 'text-xs',
    'text-[15px]': 'text-sm',
    'text-[16px]': 'text-base',
    'text-[18px]': 'text-lg',
    'text-[22px]': 'text-xl',
    'text-[28px]': 'text-2xl',
    'text-[30px]': 'text-3xl',
    'text-[32px]': 'text-3xl',
    'text-[34px]': 'text-3xl',
}

RADIUS = {
    'rounded-[3px]': 'rounded',
    'rounded-[4px]': 'rounded',
    'rounded-[5px]': 'rounded',
    'rounded-[6px]': 'rounded-lg',
    'rounded-[7px]': 'rounded-lg',
    'rounded-[8px]': 'rounded-lg',
    'rounded-[9px]': 'rounded-xl',
    'rounded-[10px]': 'rounded-xl',
    'rounded-[11px]': 'rounded-xl',
    'rounded-[12px]': 'rounded-xl',
    'rounded-[14px]': 'rounded-2xl',
    'rounded-[16px]': 'rounded-2xl',
    'rounded-[18px]': 'rounded-2xl',
    'rounded-[20px]': 'rounded-3xl',
    'rounded-[24px]': 'rounded-3xl',
    'rounded-[28px]': 'rounded-3xl',
    'rounded-md': 'rounded-lg',
}

def main():
    repl = {**TEXT, **RADIUS}
    # longest keys first to avoid partial overlaps
    keys = sorted(repl, key=len, reverse=True)
    files_changed, total = 0, 0
    for path in sorted(APP.rglob('*.tsx')):
        text = path.read_text()
        orig = text
        for k in keys:
            if k in text:
                n = text.count(k)
                text = text.replace(k, repl[k])
                total += n
        if text != orig:
            path.write_text(text)
            files_changed += 1
    print(f'files changed: {files_changed}, replacements: {total}')

if __name__ == '__main__':
    main()
