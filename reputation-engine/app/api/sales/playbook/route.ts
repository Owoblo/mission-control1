import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'

export const dynamic = 'force-dynamic'

const DOCUMENTS = {
  full: {
    filename: 'Saturn-Star-CRM-Operating-Playbook.pdf',
    download: 'Saturn-Star-CRM-Operating-Playbook.pdf',
  },
  desk: {
    filename: 'Saturn-Star-CRM-Desk-Reference.pdf',
    download: 'Saturn-Star-CRM-Desk-Reference.pdf',
  },
} as const

export async function GET(request: Request) {
  const session = await getSessionUser()
  if (!session || !canAccessSalesWorkspace(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const key = url.searchParams.get('document') === 'desk' ? 'desk' : 'full'
  const document = DOCUMENTS[key]
  try {
    const body = await readFile(path.join(process.cwd(), 'docs', 'pdf', document.filename))
    return new Response(body, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${document.download}"`,
        'Cache-Control': 'private, max-age=300',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Documentation is unavailable in this deployment.' }, { status: 503 })
  }
}
