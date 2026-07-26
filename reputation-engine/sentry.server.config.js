// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://1119d15728f45d736d721503133584cd@o4510756974362624.ingest.us.sentry.io/4511349357215744",

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  enabled: process.env.NODE_ENV === "production",
  environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  tracesSampleRate: 0.1,

  // Enable logs to be sent to Sentry
  enableLogs: process.env.NODE_ENV === "production",

  // Enable sending user PII (Personally Identifiable Information)
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: false,
  beforeSend(event, hint) {
    const error = hint?.originalException;
    if (error?.code === "EPIPE") return null;
    return event;
  },
});
