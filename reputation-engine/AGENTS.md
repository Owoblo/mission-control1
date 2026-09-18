# Reputation Engine Engineering Rules

## Default Branch and Task Setup

- The repository default branch is `master`. Treat `origin/master` as the accepted baseline unless the repository is intentionally renamed.
- Never implement changes directly on `master`.
- Before editing, fetch `origin`, confirm the worktree is clean, and confirm no merge, rebase, cherry-pick, or revert is unfinished.
- Start each coherent task from the latest `origin/master` on a dedicated branch such as `feature/...`, `fix/...`, or `chore/...`.
- If unexpected changes already exist, preserve them and report them. Never reset, clean, discard, overwrite, or force-push them without explicit approval.

## Change Safety

- Read the relevant implementation and tests before editing.
- State which existing behavior must remain unchanged.
- Prefer targeted edits over replacing complete components.
- Do not modify unrelated files or silently remove code, routes, fields, migrations, UI states, permissions, or tests.
- Keep one coherent product or infrastructure change per branch and pull request.
- If two implementations conflict or product intent is unclear, stop and report the decision instead of guessing.

## Required Validation

Before committing or opening a pull request:

1. Review the complete diff and inspect deleted lines.
2. Run `npm run typecheck`.
3. Run `npm run test:logic`.
4. Run `npm run build`.
5. Manually test the affected workflow when an environment is available.
6. Confirm generated artifacts, secrets, and unrelated files are absent from the diff.

There is currently no standalone lint script. Do not claim that lint ran; Next.js performs its configured validation during `npm run build`.

## Pull Requests

- Push only the task branch and open a pull request against `master`.
- Do not merge the pull request unless explicitly requested.
- Include purpose, implementation summary, affected files, database changes, environment-variable changes, validation results, manual test steps, screenshots for visual changes, and known risks.
- Use the Vercel preview for acceptance testing before production merge when a preview is available.

## Supabase and Secrets

- Store schema changes as ordered files under `supabase/migrations/` and include them with the dependent application code.
- Do not change the production schema for experimental work.
- Regenerate committed database types when a schema change affects them.
- Never commit `.env` files, service-role keys, provider credentials, access tokens, or customer-sensitive exports.

## Generated Files

- Do not commit `.tmp-logic-tests/`, `.next/`, `test-results/`, `supabase/.temp/`, `*.tsbuildinfo`, or local Vercel state.
- Treat generated reports, campaign exports, rendered assets, and customer deliverables as separate artifacts unless a task explicitly requires versioning them.
