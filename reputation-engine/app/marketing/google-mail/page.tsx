import { getSessionUser } from '@/lib/server/session'
import { googleMailConfig, listGoogleMail } from '@/lib/server/google-mail-oauth'
import { GOOGLE_MAILBOXES } from '@/lib/google-mail-oauth'
export const dynamic = 'force-dynamic'
export default async function GoogleMailPage({ searchParams }: { searchParams: Promise<{ result?: string }> }) {
  const user = await getSessionUser()
  if (user?.role !== 'owner' || !user.userId) return <main className="p-6">Owner access required.</main>
  const { result } = await searchParams
  let ready = false
  let rows: { email: string; status: string }[] = []
  try { googleMailConfig(); rows = await listGoogleMail(); ready = true } catch { /* Show a recoverable setup state, not credentials. */ }
  return <main className="mx-auto max-w-3xl space-y-5 p-6">
    <a className="underline" href="/marketing">← Marketing</a>
    <h1 className="text-2xl font-bold">Google mailboxes</h1>
    <p>Connect each mailbox with its Google account. Connections are saved for setup; campaign sending remains disabled.</p>
    {!ready && <p role="alert">Google mailbox setup is not available yet. Server credentials and database setup must be completed.</p>}
    {result === 'connected' && <p role="status">Mailbox connected. Authentication and send/reply testing are still required.</p>}
    {result === 'failed' && <p role="alert">Connection was not saved. Use the selected mailbox, allow both Gmail permissions, and try again. ScaledMail may need to approve the app.</p>}
    {GOOGLE_MAILBOXES.map(email => <form key={email} method="post" action="/api/marketing/google-mail/start" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
      <input type="hidden" name="email" value={email} />
      <div><p>{email}</p><p className="text-sm">{rows.find(r => r.email === email)?.status || 'Not connected'}</p></div>
      <button disabled={!ready} className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-40">{rows.some(r => r.email === email) ? 'Reconnect Google' : 'Connect Google'}</button>
    </form>)}
  </main>
}
