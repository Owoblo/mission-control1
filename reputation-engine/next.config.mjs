import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingIncludes: {
    '/api/sales/playbook': ['./docs/pdf/Saturn-Star-CRM-Operating-Playbook.pdf', './docs/pdf/Saturn-Star-CRM-Desk-Reference.pdf'],
  },
};

export default withSentryConfig(nextConfig, {
  org: "sold2move",
  project: "saturn-os",
  silent: !process.env.CI,
  widenClientFileUpload: true,
  webpack: {
    automaticVercelMonitors: true,
  },
});
