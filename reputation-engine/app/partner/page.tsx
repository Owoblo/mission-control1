import { Suspense } from 'react'
import type { Metadata } from 'next'
import { PartnerReferralForm } from './partner-referral-form'

export const metadata: Metadata = {
  title: 'SSM Local Partner Network',
  description: 'Refer a moving client to Saturn Star Movers and track partner attribution.',
}

export default function PartnerPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#f6f8fb]" />}>
      <PartnerReferralForm />
    </Suspense>
  )
}
