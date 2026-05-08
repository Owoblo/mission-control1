import { NextResponse } from 'next/server'
import { requireSupabaseEnv } from '@/lib/server/runtime'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new Response(null, { status: 200, headers: corsHeaders })
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = (searchParams.get('q') || '').trim()

  if (q.length < 3) {
    return NextResponse.json([], { headers: corsHeaders })
  }

  try {
    const { url, headers } = requireSupabaseEnv()
    const encoded = encodeURIComponent(`%${q}%`)
    const res = await fetch(
      `${url}/rest/v1/listings?address=ilike.${encoded}&select=zpid,address,city&order=address.asc&limit=7`,
      { headers, cache: 'no-store' }
    )

    if (!res.ok) {
      return NextResponse.json([], { headers: corsHeaders })
    }

    const rows = (await res.json()) as Array<{ zpid: string; address: string; city: string }>
    return NextResponse.json(rows, { headers: corsHeaders })
  } catch {
    return NextResponse.json([], { headers: corsHeaders })
  }
}
