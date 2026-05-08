import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {};

export default withSentryConfig(nextConfig, {
  org: "sold2move",
  project: "saturn-os",
  silent: !process.env.CI,
  widenClientFileUpload: true,
  automaticVercelMonitors: true,
});
