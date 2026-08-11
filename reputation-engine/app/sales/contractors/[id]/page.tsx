import Partner360Dashboard from '@/app/components/partner-360-dashboard'
export default async function PartnerPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <Partner360Dashboard endpoint={`/api/sales/subcontractors/${id}`} backHref="/sales/contractors"/> }
