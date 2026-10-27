import { emailHash, emailStorage } from '@/lib/server/email-delivery'
export const dynamic='force-dynamic'
function token(request:Request) { const value=new URL(request.url).searchParams.get('token') || ''; return /^[a-f0-9]{64}$/.test(value) ? value : null }
const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Type':'text/html; charset=utf-8','X-Robots-Tag':'noindex'}
export async function GET(request:Request) {
  if(!token(request)) return new Response('Invalid unsubscribe link',{status:400,headers})
  // Link previews and security scanners must never unsubscribe someone on GET.
  return new Response('<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Saturn Star Movers email preferences</title><body style="font:16px Arial;max-width:480px;margin:60px auto;padding:20px"><h1>Stop outreach emails</h1><p>Use the button below to stop partnership outreach from Saturn Star Movers. Emails about a move you requested are handled separately.</p><form method="post"><button type="submit" style="padding:12px 20px">Unsubscribe from outreach</button></form></body></html>',{headers})
}
export async function POST(request:Request) {
  const value=token(request);if(!value) return new Response('Invalid unsubscribe link',{status:400,headers})
  try {
    const found=await emailStorage<boolean>('rpc/unsubscribe_crm_email',{p_hash:emailHash(value)})
    return new Response(found?'You are unsubscribed from Saturn Star Movers outreach.':'This unsubscribe link could not be found.',{status:found?200:404,headers})
  } catch { return new Response('We could not save your preference. Please try again.',{status:503,headers}) }
}
