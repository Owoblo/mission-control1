import { withSentryConfig } from "@sentry/nextjs/config";

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    if (process.env.CRM_SYNTHETIC_PREVIEW !== '1') return [];
    return [{ source: '/:path*', headers: [
      { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'none'" },
      { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
      { key: 'Cache-Control', value: 'private, no-store' },
    ] }];
  },
  serverExternalPackages: ['ffmpeg-static'],
  outputFileTracingIncludes: {
    '/api/marketing/video-playback': ['./node_modules/ffmpeg-static/ffmpeg'],
    '/api/marketing/fulfilment': ['./public/partner-cards/*.pdf'],
    '/api/sales/playbook': ['./docs/pdf/Saturn-Star-CRM-Operating-Playbook.pdf', './docs/pdf/Saturn-Star-CRM-Desk-Reference.pdf'],
  },
};

export default withSentryConfig(nextConfig, {
  org: "sold2move",
  project: "saturn-os",
  silent: !process.env.CI,
  widenClientFileUpload: true,
  telemetry: process.env.CRM_SYNTHETIC_PREVIEW === '1' ? false : undefined,
  webpack: {
    automaticVercelMonitors: process.env.CRM_SYNTHETIC_PREVIEW !== '1',
  },
});
