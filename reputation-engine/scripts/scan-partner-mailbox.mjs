// Read-only mailbox discovery. No sends, marking read, or CRM writes.
const form = new URLSearchParams({ grant_type: 'refresh_token', client_id: process.env.ZOHO_PARTNERSHIP_CLIENT_ID, client_secret: process.env.ZOHO_PARTNERSHIP_CLIENT_SECRET, refresh_token: process.env.ZOHO_PARTNERSHIP_REFRESH_TOKEN })
const tokenResponse = await fetch(process.env.ZOHO_PARTNERSHIP_ACCOUNTS_URL + '/oauth/v2/token', { method: 'POST', body: form })
const token = await tokenResponse.json()
if (!token.access_token) throw Error('Mailbox authorization failed')
const base = process.env.ZOHO_PARTNERSHIP_MAIL_URL + '/api/accounts/' + process.env.ZOHO_PARTNERSHIP_ACCOUNT_ID
async function get(path) {
  const r = await fetch(base + path, { headers: { Authorization: 'Zoho-oauthtoken ' + token.access_token }, signal: AbortSignal.timeout(25000) })
  const d = await r.json()
  if (!r.ok || d.status?.code !== 200) throw Error('Zoho request failed ' + r.status)
  return d.data
}
if (process.argv[2] === 'folders') {
  console.log(JSON.stringify(await get('/folders')))
} else if (process.argv[2] === 'content') {
  for (const pair of process.argv.slice(3)) {
    const [folder, id] = pair.split(':')
    const d = await get(`/folders/${folder}/messages/${id}/content`)
    console.log(JSON.stringify({ id, content: String(d.content || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0,14000) }))
  }
} else {
  const groups = new Map()
  const historical = process.argv[2] === 'historical'
  const lower = Date.parse('2026-01-01T00:00:00-05:00')
  const upper = Date.parse('2026-08-01T00:00:00-04:00')
  let inRange = 0
  let examined = 0, oldest = Infinity, ended = false
  for (let start = 1; start <= (historical ? 40000 : 4000); start += 200) {
    const folder = historical ? process.argv[3] : undefined
    if (folder && !/^\d+$/.test(folder)) throw Error('Invalid folder')
    const rows = await get(`/messages/view?start=${start}&limit=200${folder ? '&folderId=' + folder + '&includeto=true' : ''}`)
    examined += rows.length
    for (const m of rows) {
      const date = Number(m.receivedTime || m.receivedtime || 0)
      if (date) oldest = Math.min(oldest, date)
      if (historical && (date < lower || date >= upper)) continue
      inRange++
      const from = String(folder === '430781000000002022' ? m.toAddress || '' : m.fromAddress || '').toLowerCase()
      if (/(?:@(?:starmovers|saturnstarmovers|sold2move)\.ca|no.?reply|notifications@|mailer-daemon|dmarc|postmaster|shiply|@.*(?:facebook|linkedin|google|amazon|stripe|interac|paypal|vercel|github|zoho|marriott|outsourcerecruiter)\.)/.test(from)) continue
      const text = `${m.subject} ${m.summary}`
      if (!/mov(?:e|ing|er)|referr|partner|staging|storage|relocat|shipment|delivery|realt|broker|property|tenant|packing|logistic/i.test(text)) continue
      const group = groups.get(from) || { from, count: 0, messages: [] }
      group.count++
      if (group.messages.length < (historical ? 8 : 4)) group.messages.push({ id: m.messageId, folder: m.folderId, subject: m.subject, date: new Date(date).toISOString(), summary: m.summary })
      groups.set(from, group)
    }
    if (rows.length < 200) { ended = true; break }
  }
  console.log(JSON.stringify({ examined, inRange, oldest: Number.isFinite(oldest) ? new Date(oldest).toISOString() : null, ended, candidates: [...groups.values()] }))
}
