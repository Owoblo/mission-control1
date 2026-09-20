import { Suspense } from 'react'
import type { Metadata } from 'next'
import { PartnerReferralForm } from '../partner-referral-form'

export const metadata: Metadata = {
  title: 'Refer a Moving Client | Saturn Star Movers',
  description: 'Submit a partner referral to Saturn Star Movers.',
}

export default async function PartnerCodePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#f9fafb]" />}>
      <PartnerReferralForm pathCode={decodeURIComponent(code)} />
    </Suspense>
  )
}
