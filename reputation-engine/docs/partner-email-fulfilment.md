# Partner email fulfilment

`/marketing/fulfilment` provides editable, individually sent email drafts with regional business-card PDFs, additional PDF uploads, explicit send review, and completion evidence. The Relationships page and marketing navigation link to it.

The reviewed September 9 email queue was imported separately into live `crm_tasks` (32 tasks). Recipient data is not bundled with the application. Tasks use category `partner_email_fulfilment`, relationship IDs, owner and due date. The structured draft is serialized in the task description; the shared task reader shows its human-readable note. These tasks must be edited through the fulfilment route; the generic task mutation endpoint directs the user there. This uses the existing task schema without representing drafts as sent messages.

The authenticated API checks partnership market access and current suppression before sending. Concurrent sends claim the task by its prior `updated_at` and status. Provider requests include an idempotency key. Ambiguous provider outcomes remain locked as sending for manual verification. Successful acceptance stores the provider receipt in the task and copies the actual email to contact history. Acceptance does not mean inbox delivery or recipient acknowledgement.

SSM uses the existing business@starmovers.ca sender and inbound reply routing. Dexa sending is disabled unless `DEXA_PARTNERSHIP_EMAIL_FROM` contains an explicitly verified sender, such as the address approved by the business. Never substitute the SSM sender for a Dexa email. The local Vercel environment export replaces secrets with `[SENSITIVE]` and cannot be used to test provider credentials.

Regional PDFs are the existing Sold2Move company business cards. Additional uploads are restricted to PDF files, at most three, totaling approximately 2 MB. List responses omit attachment contents; selecting a task loads them. Rate/insurance tasks remain waiting until the user supplies approved current documents and replaces placeholders. No recipient messages are sent by imports, saves, tests or deployment.

Validation: `node --test tests/integration/partner-fulfilment.cjs`, TypeScript and production build. Browser checks use local fixture tasks and mocked send responses, never a production session or real recipients.
