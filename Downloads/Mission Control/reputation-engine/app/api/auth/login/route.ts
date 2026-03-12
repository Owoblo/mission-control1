import { NextResponse } from 'next/server'
import { createSessionToken, getSessionCookieName } from '@/lib/auth'

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { password?: string }
    const expectedPassword = process.env.AUTH_PASSWORD
    if (!expectedPassword) {
      return NextResponse.json({ error: 'Missing AUTH_PASSWORD' }, { status: 500 })
    }

    if (!payload.password || payload.password !== expectedPassword) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
    }

    const response = NextResponse.json({ ok: true })
    response.cookies.set(getSessionCookieName(), await createSessionToken(), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 12,
    })
    return response
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Login failed' },
      { status: 400 }
    )
  }
}
