import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Saturn Star OS',
    short_name: 'Saturn Star',
    description: 'Saturn Star Moving — Sales & Operations Command Centre',
    start_url: '/sales/pipeline',
    display: 'standalone',
    background_color: '#f0f2f5',
    theme_color: '#1a2744',
    orientation: 'portrait-primary',
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any maskable',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any maskable',
      },
    ],
    categories: ['business', 'productivity'],
    shortcuts: [
      {
        name: 'Pipeline',
        url: '/sales/pipeline',
        description: 'View sales pipeline',
      },
      {
        name: 'Inbox',
        url: '/sales/inbox',
        description: 'New lead inbox',
      },
      {
        name: 'Operations',
        url: '/sales/operations',
        description: 'Job board',
      },
    ],
  }
}
