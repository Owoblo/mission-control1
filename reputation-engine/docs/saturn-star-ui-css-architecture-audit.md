# Saturn Star OS UI/CSS Architecture Audit

**Audit date:** July 19, 2026  
**Scope:** React application styles, Tailwind theme and utilities, shared UI primitives, customer-facing flows, and legacy standalone HTML tools in `public/`.

> Saturn Star OS should feel like a calm operational command centre. The interface must absorb complexity, keep context attached to action, make exceptions visible, and make the next safe action obvious.

## Executive finding

The product had a sound operational layout underneath an inconsistent visual system. The main failure was not one page: several inherited design languages were active at once. The code mixed unofficial navy and gold values, green as a generic primary action, large SaaS-style corner radii, gradient decoration, shadow-led hierarchy, and three unrelated typography stacks. Those choices weakened hierarchy and made dense operating screens feel less deliberate.

This pass corrected the shared foundation and mechanically normalized the recurring violations across the internal product. It deliberately preserves semantic colour, compact operational density, status pills, circular phone controls, avatars, progress indicators, and customer-facing surfaces where softer geometry supports trust.

## Evidence collected

- 1 global application stylesheet audited: `app/globals.css`
- Tailwind design configuration and root layout audited
- 75 React/TypeScript UI style sources inventoried
- Standalone HTML interfaces in `public/` included in the brand-colour sweep
- 5,146 JSX class/style declarations inspected
- 705 initial candidates involving gradients, oversized rounding, heavy shadows, animation, or pills
- 52 application files initially contained legacy navy/gold values
- 596 uses of legacy `#1A2744` and 54 uses of legacy `#F5A623` were identified in the wider source inventory

## Corrections completed

### 1. One official token system

The canonical interface tokens now derive from the master brand system:

| Role | Value |
| --- | --- |
| Deep Navy | `#071421` |
| Warm Gold | `#C99700` |
| Dark Gold | `#8A6800` |
| Soft Ivory | `#F7F4ED` |
| Charcoal | `#111827` |
| Muted Gray | `#667085` |
| Light Border | `#E5E7EB` |

Legacy Tailwind aliases now resolve to this palette so older screens inherit the correct brand without creating a second visual language. Semantic green, amber, red, and blue remain reserved for completion, attention, failure, and information.

### 2. Typography aligned to the playbook

- Manrope is used for headings and display text.
- Inter is used for body copy and controls.
- Existing system fallbacks remain in place for resilience.
- Text rendering and smoothing are normalized globally.

### 3. Operational geometry normalized

- Structural surfaces use restrained 8–12 px rounding.
- Inputs and ordinary buttons use 12 px rounding.
- Oversized 20–28 px internal panels were reduced.
- Pill geometry is reserved for statuses, tags, counts, avatars, indicators, and phone controls.
- Internal gradients and heavy `xl`/`2xl` elevation were removed from audited operational routes.

### 4. Action hierarchy made calmer

- The standard primary action is Deep Navy.
- Gold is available as an earned emphasis, not a universal CTA.
- Generic green primary buttons were removed from the shared CRM primitive.
- Hover feedback uses colour and border change rather than scale movement or added shadow.
- Red remains limited to destructive, blocked, or urgent states.

### 5. Accessibility and physical-use safeguards

- A consistent visible gold focus indicator now applies to interactive elements.
- Reduced-motion preferences suppress nonessential animation and transition.
- The global rule that hid all touch-device scrollbars was removed.
- Minimum 44 px control targets remain enforced inside the CRM application frame.
- Existing responsive record composition remains one column on small screens, action/context split at desktop, and three-zone record layout on wide screens.

## Architectural assessment

| Dimension | Before | After this pass |
| --- | ---: | ---: |
| Orientation | 4/5 | 4/5 |
| Context | 4/5 | 4/5 |
| Priority | 3/5 | 4/5 |
| Action clarity | 3/5 | 4/5 |
| Continuity | 4/5 | 4/5 |
| Memory | 4/5 | 4/5 |
| Efficiency | 3/5 | 4/5 |
| Error prevention | 3/5 | 4/5 |
| Recovery | 3/5 | 3/5 |
| Feedback | 3/5 | 3/5 |
| Accessibility | 2/5 | 4/5 |
| Emotional load | 2/5 | 4/5 |
| Visual composition | 2/5 | 4/5 |
| Role fit | 4/5 | 4/5 |
| Mobile fit | 3/5 | 4/5 |
| **Total** | **48/75** | **58/75** |

The product moves from significant visual friction to a consistent, usable operational foundation. A score above 60 requires workflow observation and page-specific usability validation, not more cosmetic styling.

## Deliberate exceptions

- Status badges and tags remain pills because they encode state rather than action.
- Avatars, notification dots, timeline markers, progress bars, and call controls remain circular where shape communicates function.
- Customer quote, survey, receipt, and review surfaces may retain slightly softer composition than dense internal tools.
- Semantic colours are not forced into the navy/gold palette.
- Shadows may remain for true overlays, floating dialer elevation, and modal separation; they should not define normal page hierarchy.

## Remaining product-level work

These items cannot be solved safely through global CSS alone:

1. Validate the highest-complexity screens with real operators: partner workspace, lead record, inbox, estimate composer, operations, and dispatch.
2. Reduce duplicated actions and repeated summaries in the lead record; this is an information-architecture issue, not a colour issue.
3. Standardize confirmation, undo, autosave, and failure feedback across mutations.
4. Audit keyboard order, screen-reader naming, 200% zoom, and high-contrast mode through browser automation and manual assistive testing.
5. Measure task time for lead response, quote send, booking readiness, transfer, dispatch exception, and payment recovery.
6. Migrate standalone `public/` tools into shared React primitives over time; colour normalization alone cannot give isolated HTML tools the same interaction contracts.

## Non-negotiable CSS rules going forward

1. Use the shared CSS variables or semantic Tailwind colours; do not add new brand hex values to a component.
2. Use gold only for selected state, meaningful priority, milestone, or earned emphasis.
3. Use a pill only for state, tag, count, identity, or a genuinely capsule-shaped segmented control.
4. Use borders, spacing, and tone before shadows.
5. Do not add gradients to operational screens.
6. Keep ordinary controls at least 44 px on touch surfaces.
7. Every new interaction must have visible focus, disabled, loading, success, and error behavior.
8. Honour reduced motion and never hide scroll affordance globally.
9. Preserve one dominant action per decision surface.
10. Judge every style choice by whether it makes the current state and next safe action easier to understand.

