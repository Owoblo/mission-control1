# Saturn Star OS — Mission Control

## Repo layout

```
mission-control1/
  reputation-engine/   ← Next.js app (the only deployable project)
```

All source work happens inside `reputation-engine/`. Never create files at the repo root unless they are repo-wide config (`.github/`, `CLAUDE.md`, etc.).

## Branch rules — READ THIS FIRST

| Branch | Purpose |
|---|---|
| `master` | **Production.** Vercel deploys `go.quote2move.com` from this branch. |
| `prod-sync-master` | Active development branch. All feature work lands here first. |
| `fix/*` / `feature/*` | Short-lived branches cut from `master` for isolated fixes. |

### The rule that prevents downgrade disasters

**`master` must always be at or ahead of `prod-sync-master`.**

Every session, before pushing any change to `master`, run:

```bash
git log master..prod-sync-master --oneline
```

If that returns commits, **merge `prod-sync-master` into `master` first**, then add your changes on top. Never push a cherry-picked subset to `master` while `prod-sync-master` has unmerged work — it will downgrade production.

### Codex / Claude workflow

1. Do all experimental or feature work on `prod-sync-master`.
2. When ready to ship: merge `prod-sync-master → master`, resolve conflicts, push master.
3. For urgent hotfixes: cut a `fix/` branch off master, apply the minimal change, merge back into **both** `master` and `prod-sync-master`.
4. Never deploy by redeploying a previous Vercel deployment ID — always push the branch so git history stays canonical.

## Production deploy checklist

- [ ] `git log master..prod-sync-master --oneline` is empty (branches in sync)
- [ ] `npx tsc --noEmit` passes with no source errors
- [ ] `NEXT_PUBLIC_APP_URL`, `AUTH_SECRET`, `AUTH_PASSWORD`, `SUPABASE_URL`, `SUPABASE_KEY`, `RESEND_API_KEY` are all set in Vercel for production + preview + development

## Key env vars (Vercel project: `mission-control1-reputation-engine`)

See `.env.example` for the full list. Critical ones:

| Var | Notes |
|---|---|
| `AUTH_SECRET` | JWT signing key — **must be set for all 3 targets** (production, preview, development) or middleware throws on every request |
| `AUTH_PASSWORD` | Owner password-only login (no email required) |
| `ALLOW_LEGACY_OWNER_LOGIN` | Deprecated — no longer checked in code, can be removed |

## Architecture notes

- **Auth**: custom HMAC session tokens in `lib/auth.ts`. Cookie name: `mc_session`. 12h expiry for login route, 7d for session refresh.
- **Roles**: `owner` | `manager` | `sales_rep` | `operations_lead` | `crew`
- **Database**: Supabase (Postgres). All reads/writes go through `lib/server/sales-repository.ts`.
- **Email**: Resend API, sent from `business@starmovers.ca`.
- **SMS/Calls**: Twilio. Inbound SMS hits `/api/sales/twilio/sms`.
- **Middleware**: `middleware.ts` — protects all `/sales/*`, `/api/sales/*`, `/admin/*`, `/crew/*`, `/marketing/*` routes. Public exceptions listed in `PUBLIC_API_PATHS` and helper functions (`isPublicMarketingPath`, `isApprovalPath`).

## Manager approval flow (estimate overrides)

- Rep hits `POST /api/sales/leads/[id]/request-approval` (auth required)
- Sends email to `business@starmovers.ca` with one-click approve link
- Manager clicks `GET /api/sales/leads/[id]/approve-margin?token=xxx` (no auth — public endpoint)
- Token is a UUID stored on the lead; single-use
- Approval unlocks below-55%-margin overrides, Book Today discount, 10% spot discount in the estimate modal
