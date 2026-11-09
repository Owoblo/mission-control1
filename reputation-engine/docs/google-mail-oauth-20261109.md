# Google mailbox OAuth setup — 2026-11-09

Project: `saturn-star-crm`. Client ID: `204971219349-ap2jn8l1v58526nijf3s4v2a5lfoqmol.apps.googleusercontent.com`.

Credentials imported from the owner-supplied Downloads JSON into `.env.google-mail.local` (Git ignored, mode 0600). No secrets are included here. The separate AES-256-GCM key must be backed up securely; losing it makes saved refresh tokens unusable.

## Google console

Register this exact Web client redirect URI:

`https://go.quote2move.com/api/marketing/google-mail/callback`

No JavaScript origin is needed for this server-side authorization-code flow. Enable Gmail API. Configure consent scopes: `openid`, `email`, `https://www.googleapis.com/auth/gmail.send`, `https://www.googleapis.com/auth/gmail.readonly`. ScaledMail must approve the client/scopes in each hosting tenant. Each mailbox grants consent separately. External Testing refresh tokens for these scopes normally expire after seven days; production publishing and applicable restricted-scope verification/exemptions must be resolved before unattended use.

## Local implementation and validation

Owner-only `/marketing/google-mail` page connects only the eight approved john/johnny addresses on the four new domains. The fifth Zoho/SES domain is excluded. Server flow uses same-origin POST, browser-bound state, PKCE, ten-minute expiry and an atomic one-time database claim. Callback verifies the actual Gmail profile address and both Gmail scopes. Refresh tokens are encrypted with mailbox-specific authenticated context. No access tokens or credentials are exposed to the browser. Refresh marks revoked grants as requiring reconnection.

Connections do not enable sending: a database check forces `campaign_enabled=false`. This is connection plumbing, not a Gmail campaign transport or reply-ingestion implementation. Those remain separate integration work.

Validation: four logic/integration tests passed, project typecheck passed, migration executed in local PGlite; RLS enabled and authenticated-role credential reads denied. No live mailbox consent, token exchange, send or reply test has occurred.

## Release remaining

The active workspace contains extensive unrelated edits. The repository release guard requires reviewed, committed source before production deployment. Move only the Google OAuth files, tests and migration into an isolated current-production checkout; include the email-infrastructure page link only if that page exists in the release. Validate there before release.

Apply `supabase/migrations/20261109000100_google_mail_oauth.sql`. Set server-only `GOOGLE_MAIL_CLIENT_ID`, `GOOGLE_MAIL_CLIENT_SECRET`, `GOOGLE_MAIL_TOKEN_KEY`, `GOOGLE_MAIL_ORIGIN=https://go.quote2move.com`, plus existing service-role Supabase configuration. Never place these in NEXT_PUBLIC variables. Deploy routes/page, then connect one pilot mailbox. Validate revocation/reconnection, token refresh and later actual send/reply authentication before expanding to eight. Mailivery uses its own authorization.

As of this work: no production database migration or deployment performed; console redirect/scopes and ScaledMail approval are not confirmed. The downloaded client credentials do not grant access to administer Google Cloud or consent on behalf of mailboxes.

Google reference: https://developers.google.com/identity/protocols/oauth2/web-server
