import { notFound } from 'next/navigation'
export default function Preview() {
  if (process.env.CRM_SYNTHETIC_PREVIEW !== '1' || process.env.VERCEL_ENV === 'production') notFound()
  return <main className="mx-auto max-w-xl space-y-5 p-10"><h1 className="text-2xl font-bold">Protected synthetic CRM preview</h1><p>34,137 fictional contacts. No customer data. All writes, provider callbacks, payments, messaging and background work are disabled.</p>
    <p>Choose a synthetic role:</p>{[['owner', 'Owner — all markets'], ['windsor', 'Manager — Windsor'], ['toronto', 'Partnership manager — Toronto'], ['denied', 'Crew — access denied']].map(([role, label]) => <a className="block rounded border p-3" key={role} href={`/api/preview/session?role=${role}`}>{label}</a>)}
    <p>Use Contacts for paged server-side lookup. Comprehensive retains the original message/campaign/status matching. For the benchmark, add <code>&amp;legacyDirectory=1</code> to the inbox URL to run the original full-directory workflow.</p></main>
}
