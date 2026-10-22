export type BriefRow = Record<string, any>
const zone = 'America/Toronto'
function localParts(date: Date) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(p => [p.type, p.value]))
}
function localEight(date: string) {
  const guess = new Date(date + 'T12:00:00Z')
  const hour = Number(localParts(guess).hour)
  return new Date(guess.getTime() + (8 - hour) * 3600000)
}
export function dailyBriefWindow(now = new Date()) {
  const p = localParts(now)
  const day = `${p.year}-${p.month}-${p.day}`
  const prior = new Date(Date.parse(day + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10)
  return { day, due: p.hour === '08', from: localEight(prior).toISOString(), until: localEight(day).toISOString() }
}
export function isReaction(notes: string) {
  const s = notes.replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/^Inbound SMS:\s*/i, '').trim()
  return /^(Liked|Loved|Disliked|Laughed at|Emphasized|Questioned|Removed a reaction)\b/i.test(s) || /^.{1,12}\s+to\s+[“"「]/u.test(s) || /^[\p{Extended_Pictographic}\p{Emoji_Modifier}\uFE0F\s]+$/u.test(s)
}
export function substantiveTouch(t: BriefRow) {
  return ['sms', 'email'].includes(t.channel) && ['inbound', 'outbound'].includes(t.direction)
    && !/^SES event:/i.test(t.notes || '') && !['automatic_reply', 'system'].includes(t.metadata?.email_kind)
    && t.outcome_code !== 'email_automatic_reply' && t.metadata?.human_reply !== false
    && !['reserved', 'failed'].includes(t.metadata?.delivery_state)
}
function excerpt(value: unknown, max = 420) {
  return String(value || '').replace(/^Inbound SMS:\s*/i, '').split(/\n(?:From:|-----Original Message-----|On .+wrote:)/)[0].replace(/\s+/g, ' ').trim().slice(0, max)
}
function actionText(task: BriefRow) {
  try { const d = JSON.parse(task.description || '{}'); return excerpt(d.next_action || d.nextAction || d.next_step || d.latest_context || task.description, 700) } catch { return excerpt(task.description, 700) }
}
function time(value: string) { return new Date(value).toLocaleString('en-CA', { timeZone: zone, dateStyle: 'medium', timeStyle: 'short' }) }
export function renderDailyBrief(input: { day: string; from: string; until: string; contacts: BriefRow[]; touches: BriefRow[]; tasks: BriefRow[]; appointments: BriefRow[]; jobs: BriefRow[] }) {
  const contacts = new Map(input.contacts.map(c => [c.id, c]))
  const scoped = input.touches.filter(t => contacts.has(t.contact_id) && Date.parse(t.created_at) >= Date.parse(input.from) && Date.parse(t.created_at) < Date.parse(input.until))
  const activity = scoped.filter(substantiveTouch)
  const inbound = activity.filter(t => t.direction === 'inbound' && !isReaction(t.notes || ''))
  const reactions = activity.filter(t => t.direction === 'inbound' && isReaction(t.notes || ''))
  const outbound = activity.filter(t => t.direction === 'outbound')
  const ids = [...new Set(activity.map(t => t.contact_id))]
  const label = (id: string) => { const c = contacts.get(id); return c ? `${c.name || 'Unnamed contact'}${c.company ? ' — ' + c.company : ''}` : 'Unknown contact' }
  const lines = ['DEXA MOVERS — OTTAWA DAILY PARTNERSHIP BRIEF', `For Dr. Courage | ${input.day} | 8 a.m. Toronto time`, `Activity window: ${time(input.from)} to ${time(input.until)}`, '', `${new Set(inbound.map(t => t.contact_id)).size} people sent substantive replies; ${reactions.length} reactions; ${outbound.length} outbound message records.`, 'Outbound records are not proof of delivery. Proposed times are not confirmed appointments.', '', 'CONVERSATIONS AND ACTIONS']
  if (!ids.length) lines.push('No recorded SMS/email activity in this window.')
  for (const id of ids) {
    const ins = inbound.filter(t => t.contact_id === id).sort((a,b) => Date.parse(a.created_at)-Date.parse(b.created_at))
    const outs = outbound.filter(t => t.contact_id === id).sort((a,b) => Date.parse(a.created_at)-Date.parse(b.created_at))
    const latestIn = ins.at(-1), latestOut = outs.at(-1)
    lines.push('', label(id))
    if (latestIn) lines.push(`Latest substantive reply (${time(latestIn.created_at)}): ${excerpt(latestIn.notes)}`)
    if (latestOut) lines.push(`Latest outbound (${time(latestOut.created_at)}): ${excerpt(latestOut.notes)}`)
    if (!latestIn && reactions.some(t => t.contact_id === id)) lines.push('Reaction only in this window; not a new request or confirmed time.')
    if (latestIn && (!latestOut || Date.parse(latestIn.created_at) > Date.parse(latestOut.created_at))) lines.push('Review needed: latest substantive reply has no later outbound in this activity window. Check the live thread before replying.')
    lines.push(`Thread: https://go.quote2move.com/marketing/partners?tab=phone&contact=${id}`)
  }
  lines.push('', 'APPOINTMENTS RECORDED IN CRM')
  const appointments = input.appointments.filter(a => contacts.has(a.contact_id))
  if (!appointments.length) lines.push('No upcoming appointments recorded. Offered times may still appear in the follow-ups below.')
  for (const a of appointments) lines.push(`- ${label(a.contact_id)} | ${a.scheduled_at ? time(a.scheduled_at) : 'Time missing'} | recorded status: ${a.status || 'unknown'} | ${excerpt(a.title)}${a.location ? ' | '+excerpt(a.location) : ''}`)
  lines.push('', 'OPEN FOLLOW-UPS / OWNER DECISIONS')
  const tasks = input.tasks.filter(t => contacts.has(t.related_id) && ['open','in_progress'].includes(t.status))
  if (!tasks.length) lines.push('No open relationship tasks recorded.')
  for (const t of tasks) lines.push(`- ${label(t.related_id)} | ${t.title} | due ${t.due_at ? time(t.due_at) : 'not set'}\n  ${actionText(t)}`)
  lines.push('', 'SCHEDULED MESSAGES — NOT YET SENT')
  const jobs = input.jobs.filter(j => contacts.has(j.contact_id) && j.status === 'pending')
  if (!jobs.length) lines.push('No pending scheduled messages.')
  for (const j of jobs) lines.push(`- ${label(j.contact_id)} | ${j.channel} | ${j.scheduled_at ? time(j.scheduled_at) : 'time missing'}`)
  lines.push('', 'This brief reports recorded activity, not autonomous conclusions about bookings or revenue. Open the linked thread for the latest context. Existing instant reply alerts remain active.')
  return { subject: `Dexa Ottawa daily brief — ${input.day}`, text: lines.join('\n'), counts: { contacts: ids.length, humanReplies: inbound.length, reactions: reactions.length, outbound: outbound.length, tasks: tasks.length, appointments: appointments.length, scheduled: jobs.length } }
}
