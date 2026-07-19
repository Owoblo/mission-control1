import { redirect } from 'next/navigation'

export default function MarketingPage() {
  redirect('/marketing/partners?tab=today')
}
