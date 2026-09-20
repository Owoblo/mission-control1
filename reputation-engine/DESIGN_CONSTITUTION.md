# Saturn Design Constitution

Companion to the Saturn design vision (Sept 20, 2026). This is the enforced
source of truth. The system has teeth: `scripts/design-token-check.sh` fails
CI on any violation.

## The palette

Brand:
- `--brand-navy` `#071421` — structure, ink, primary text, dark surfaces
- `--brand-gold` `#C99700` — action, emphasis, never body text on light
- `--brand-gold-dark` `#8A6800` — gold text that passes contrast on light
- `--brand-ivory` `#F7F4ED` — warm backgrounds

Neutrals:
- `#667085` — secondary text
- `#E5E7EB` — hairlines
- `#F9FAFB` — cool wash surfaces
- `#FFFFFF` — panels

Functional:
- `--brand-success` `#0F6A53` / tint `#ECFDF3`
- `--brand-danger` `#B42318` / tint `#FEF2F2`
- `--brand-warning` `#92400E` / tint `#FFFAEB`
- `--brand-info` `#1D4ED8` / tint `#EFF6FF`

Exceptions (grandfathered, do not extend):
- `#1877F2` Facebook brand, `#25D366` WhatsApp brand — external logos only
- `#FDBA74`, `#93C5FD` — inside transactional email HTML only

Everything else that was here (153 distinct hexes, Sept 2026) was migrated.
No new hex enters `app/` without amending this file first.

## Type

Named Tailwind scale only, plus one floor:
- `text-[11px]` is the minimum functional size. Nothing smaller ships.
- No other arbitrary `text-[Npx]`.

## Radii

- `rounded` (4px) — tiny elements
- `rounded-lg` (8px) — components
- `rounded-xl` (12px) — raised components
- `rounded-2xl` (16px) — cards
- `rounded-3xl` (24px) — hero containers
- `rounded-full` — pills, avatars

No arbitrary `rounded-[Npx]`. Directional variants (`rounded-t-*` etc.) allowed.

## Voice

Short, plain, human. No exclamation marks on money pages. No jargon a
non-employee can see. Errors say what happened and what to do next, in that
order.

## Enforcement

```
./scripts/design-token-check.sh
```

Migration scripts (one-shot, kept for history):
- `scripts/migrate-design-tokens.py` — 153 hexes to 20
- `scripts/migrate-type-radius.py` — 22 text sizes and 24 radii consolidated
