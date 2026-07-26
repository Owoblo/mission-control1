import { NextResponse } from 'next/server'

export async function GET(request: Request, props: { params: Promise<{ id: string; token: string }> }) {
  const { id, token } = await props.params
  const source = new URL(request.url)
  const destination = new URL('/quote-accept', source.origin)
  destination.searchParams.set('id', id)
  destination.searchParams.set('token', token)
  if (source.searchParams.get('fastlane') === '1') destination.searchParams.set('fastlane', '1')
  return NextResponse.redirect(destination, 307)
}
