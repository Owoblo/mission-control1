import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
const root = resolve('.')
const requiredMobile = ['auth/login','auth/me','caller-id','calls','contact-profile','contacts','conversations','lines','upload-media','partner-handoff']
const cron = JSON.parse(readFileSync('vercel.json', 'utf8')).crons
const routes = ['/api/sales/operations/phone','/api/sales/operations/token','/api/sales/operations/call-status','/api/sales/operations/recording','/api/sales/operations/recording-callback','/api/sales/operations/sms-status','/api/sales/operations/media','/api/marketing/google-mail/process','/api/marketing/google-mail/status','/api/marketing/google-mail/jobs','/api/marketing/sms/email-reply', '/api/marketing/sms/email-reply/ses', ...requiredMobile.map(route => `/api/mobile/${route}`), ...cron.map(job => job.path), '/api/marketing/email-events/ses', '/api/marketing/email-infrastructure', '/api/marketing/email-unsubscribe', '/api/marketing/outreach/send', '/api/marketing/contacts/[id]/send-email', '/api/marketing/next-steps', '/api/sales/twilio/sms-status', '/api/sales/recordings/process', '/api/sales/leads/[id]/attention']
const requiredFiles = ['lib/server/operations-phone.ts','lib/server/operations-twiml.ts','lib/server/voice-token.ts','lib/operations-phone.ts','supabase/migrations/20261109000200_operations_phone.sql','supabase/migrations/20261109003000_google_mail_dispatch.sql','lib/server/google-mail-dispatch.ts','lib/server/google-mail-worker.ts','lib/server/google-mail-queue.ts','supabase/migrations/20261026000100_sales_alert_recipients.sql','lib/server/lead-attention.ts','supabase/migrations/20261024000300_conversation_integrity.sql','supabase/migrations/20261024000200_inbound_call_handling.sql','supabase/migrations/20261024000100_relationship_next_step_journal.sql','lib/server/financial-command.ts','lib/server/dialer-access.ts','lib/server/alert-outbox.ts','lib/twilio-call-matching.ts','supabase/migrations/20261023000100_durable_financial_commands.sql','supabase/migrations/20261023000200_internal_alert_outbox.sql']
requiredFiles.push('supabase/migrations/20261027000400_prepared_email_dispatch.sql', 'lib/server/prepared-email-worker.ts', 'lib/partnership-core/prepared-email.mjs', 'supabase/migrations/20261027000300_website_intake_content_guard.sql', 'lib/website-submission-guard.ts', 'supabase/migrations/20261027000200_email_dispatch_freshness.sql', 'supabase/migrations/20261027000100_email_delivery_foundation.sql', 'lib/server/email-delivery.ts', 'lib/server/email-receipts.ts', 'lib/server/email-infrastructure.ts', 'app/components/sales/email-readiness.tsx', 'scripts/setup-email-foundation.mjs')
for (const route of routes) if (!existsSync(`app${route}/route.ts`)) throw new Error(`Scheduled/mobile route missing: ${route}`)
for (const file of requiredFiles) if (!existsSync(file)) throw new Error(`Release dependency missing: ${file}`)
if (process.argv.includes('--built')) {
 const manifest = JSON.parse(readFileSync('.next/server/app-paths-manifest.json', 'utf8'))
 for (const route of routes) if (!manifest[`${route}/route`]) throw new Error(`Route omitted from production output: ${route}`)
}
if (process.argv.includes('--tracked')) {
 for (const file of [...requiredFiles, 'scripts/check-release-contracts.mjs', 'scripts/production-release.mjs', 'mobile/src/phone-address.ts']) execFileSync('git', ['ls-files', '--error-unmatch', file], { stdio: 'pipe' })
 execFileSync('git', ['merge-base', '--is-ancestor', 'origin/master', 'HEAD'], { stdio: 'pipe' })
}
console.log(`Verified ${routes.length} deployed route contracts and ${requiredFiles.length} release dependencies.`)
