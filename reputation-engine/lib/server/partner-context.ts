import type { SessionPayload } from "../auth";
import { canHandleLeadCommunications } from "./sales-permissions";
import {
  contactHandoffLeads,
  handoffContact,
  handoffDb,
  handoffHistory,
} from "./partner-sales-handoff";
import {
  deduplicateEvents,
  latestPartnerMessage,
  phoneKey,
  responseSummary,
  type ContextEvent,
  salesOwnership,
  referralOutcomes,
} from "../partner-context";
type Row = Record<string, any>;
export async function loadPartnerContext(
  session: SessionPayload,
  contactId: string,
) {
  const contact = await handoffContact(contactId);
  if (!contact) throw new Error("Contact unavailable");
  const errors: string[] = [];
  async function all(table: string, query: Record<string, string>) {
    const rows: Row[] = [];
    try {
      for (let offset = 0; offset < 10000; offset += 500) {
        const p = await handoffDb<Row[]>(table, {
          ...query,
          limit: "500",
          offset: String(offset),
          order: query.order || "id.asc",
        });
        rows.push(...p);
        if (p.length < 500) return rows;
      }
      errors.push(`${table}: history limit reached`);
    } catch {
      errors.push(`${table}: unavailable`);
    }
    return rows;
  }
  const candidates = await contactHandoffLeads(contactId, contact.phone);
  if (candidates.length >= 500) errors.push("crm_leads: history limit reached");
  const referrals = await all("partner_referrals", {
    contact_id: `eq.${contactId}`,
    select: "id,crm_lead_id",
  });
  const referralIds = [
    ...new Set(
      referrals
        .map((r) => r.crm_lead_id)
        .filter((id): id is string => typeof id === "string"),
    ),
  ];
  for (let i = 0; i < referralIds.length; i += 100) {
    const more = await all("crm_leads", {
      id: `in.(${referralIds.slice(i, i + 100).join(",")})`,
      select: "id,data,deleted",
    });
    for (const row of more)
      if (!candidates.some((c) => c.id === row.id))
        candidates.push(row as (typeof candidates)[number]);
  }
  const leads = candidates.filter(
    (l) => !l.deleted && canHandleLeadCommunications(session, l.data),
  );
  if (
    candidates.some(
      (l) => !l.deleted && !canHandleLeadCommunications(session, l.data),
    )
  )
    errors.push("Some Sales history is outside your access");
  const allowed = new Set(leads.map((l) => l.id));
  const phone = phoneKey(contact.phone),
    variants = phone ? [`+${phone}`, phone, phone.slice(1)] : [];
  const peers = variants.length
    ? await all("market_contacts", {
        phone: `in.(${variants.join(",")})`,
        select: "id",
      })
    : [];
  const ambiguous =
    errors.some((e) => e.startsWith("market_contacts:")) ||
    peers.some((c) => c.id !== contactId);
  const explicit = leads.filter(
    (l) =>
      l.data.partnerReferralContactId === contactId ||
      referralIds.includes(l.id),
  );
  const linked = explicit.map((l) => l.id);
  const raw = await handoffHistory(contactId);
  const events: ContextEvent[] = raw.map((t) => ({
    id: `touch:${t.id}`,
    source: "Partnerships",
    sourceId: t.id,
    at: t.created_at,
    channel: t.channel === "call" ? "phone" : t.channel,
    direction: t.direction,
    text: t.notes || "",
    audience: "partner",
    person: contact.name,
    personId: contactId,
    providerId:
      String(
        t.metadata?.twilioSid ||
          t.metadata?.messageSid ||
          t.metadata?.provider_message_id ||
          t.metadata?.callSid ||
          t.metadata?.call_sid ||
          "",
      ) || undefined,
    from: String(t.metadata?.from || ""),
    to: String(t.metadata?.to || ""),
    status: String(t.metadata?.delivery_state || t.metadata?.status || ""),
  }));
  const phoneFilter = variants.flatMap((p) => [
    `from_number.eq.${p}`,
    `to_number.eq.${p}`,
  ]);
  const clauses = [
    ...(!ambiguous ? phoneFilter : []),
    ...(linked.length ? [`lead_id.in.(${linked.join(",")})`] : []),
  ];
  const sms = clauses.length
    ? await all("sms_messages", { or: `(${clauses.join(",")})`, select: "*" })
    : [];
  function audience(leadId: string | undefined, from?: string, to?: string) {
    const direct = phone && [from, to].some((p) => phoneKey(p) === phone);
    if (leadId && !allowed.has(leadId)) return null;
    if (direct && !ambiguous)
      return {
        audience: "partner" as const,
        person: contact!.name,
        personId: contactId,
      };
    const l = explicit.find((l) => l.id === leadId);
    if (!l) return null;
    return {
      audience:
        phoneKey(l.data.phone) === phone
          ? ("partner" as const)
          : ("client" as const),
      person: l.data.name,
      personId: phoneKey(l.data.phone) === phone ? contactId : l.id,
    };
  }
  for (const s of sms) {
    const who = audience(s.lead_id, s.from_number, s.to_number);
    if (!who) continue;
    events.push({
      id: `sms:${s.id}`,
      source: "Sales SMS",
      sourceId: s.id,
      at: s.created_at,
      channel: "sms",
      direction: s.direction,
      text: s.body || "",
      ...who,
      leadId: s.lead_id,
      providerId: s.twilio_sid,
      from: s.from_number,
      to: s.to_number,
      status: s.status,
    });
  }
  const callClauses = [
    ...(!ambiguous ? variants.map((p) => `phone_number.eq.${p}`) : []),
    ...(linked.length ? [`lead_id.in.(${linked.join(",")})`] : []),
  ];
  const calls = callClauses.length
    ? await all("call_recordings", {
        or: `(${callClauses.join(",")})`,
        select: "*",
      })
    : [];
  for (const c of calls) {
    const who = audience(c.lead_id, c.phone_number);
    if (!who) continue;
    events.push({
      id: `call:${c.id}`,
      source: "Call recording",
      sourceId: c.id,
      at: c.created_at,
      channel: "phone",
      direction: "recorded",
      text:
        c.transcript || c.summary || "Recorded call; transcript unavailable",
      ...who,
      leadId: c.lead_id,
      providerId: c.twilio_call_sid,
      status: c.recording_status,
      playback: c.cloudflare_object_key
        ? `/api/sales/dialer/recording?key=${encodeURIComponent(c.cloudflare_object_key)}`
        : undefined,
    });
  }
  const emails = linked.length
    ? await all("crm_emails", {
        "data->>leadId": `in.(${linked.join(",")})`,
        deleted: "eq.false",
        select: "id,data",
      })
    : [];
  for (const row of emails) {
    const e = row.data;
    const lead = explicit.find((l) => l.id === e.leadId);
    if (!lead) continue;
    events.push({
      id: `email:${row.id}`,
      source: "Sales email",
      sourceId: row.id,
      at: e.sentAt,
      channel: "email",
      direction: e.direction,
      text: `${e.subject}\n${e.body}`,
      audience: phoneKey(lead.data.phone) === phone ? "partner" : "client",
      person: lead.data.name,
      leadId: lead.id,
      from: e.from,
      to: e.to,
      status: e.status,
    });
  }
  for (const lead of leads)
    for (const log of lead.data.callLogs || []) {
      const who = audience(lead.id, log.phone || lead.data.phone);
      if (!who) continue;
      events.push({
        id: `log:${lead.id}:${log.id}`,
        source: "Sales activity",
        sourceId: `${lead.id}:${log.id}`,
        at: log.date,
        channel: log.type === "call" ? "phone" : "note",
        direction: log.direction || "note",
        text: log.notes || "",
        ...who,
        leadId: lead.id,
        providerId: log.callSid,
        from: log.direction === "inbound" ? log.phone : log.branchNumber,
        to: log.direction === "inbound" ? log.branchNumber : log.phone,
        status: log.callOutcome,
      });
    }
  const timeline = deduplicateEvents(events);
  const jobs = explicit.map((l) => ({
    id: l.id,
    name: l.data.name,
    role: l.data.primaryContactRole || "unconfirmed",
    hasHandoff: !!l.data.partnerHandoff,
    kind:
      l.data.primaryContactRole === "partner"
        ? "referral_channel"
        : l.data.primaryContactRole === "customer"
          ? phoneKey(l.data.phone) === phone
            ? "own_move"
            : "client_move"
          : "unconfirmed",
    stage: l.data.stage,
    owner: l.data.assignedRepName,
    accepted: !!l.data.partnerHandoff?.acceptedAt,
    handoffStatus: l.data.handoffStatus,
    nextAction: l.data.partnerHandoff?.nextAction || l.data.followUpNote,
    dueAt: l.data.partnerHandoff?.dueAt,
    moveDate: l.data.moveDate,
    bookedAt: l.data.bookedAt,
  }));
  const handoff = salesOwnership(explicit).get(contactId);
  const pauseRequested =
    /customer_will_initiate|no_followup|inactive_realtor/.test(
      String(contact.sequence_paused_reason || ""),
    );
  const last = latestPartnerMessage(timeline);
  const reviewed = raw.find((t) => t.id === last?.sourceId)?.metadata
    ?.partnership_review as { reply_required?: boolean } | undefined;
  const quiet =
    pauseRequested &&
    (last?.direction !== "inbound" || reviewed?.reply_required === false);
  return {
    contact: { id: contact.id, name: contact.name, phone: contact.phone },
    complete: errors.length === 0,
    errors,
    ambiguousPhone: ambiguous,
    responsibility: quiet
      ? "Customer will initiate"
      : handoff
        ? `Sales owns follow-up: ${handoff.owner || "assigned rep"}`
        : "Partnerships review",
    replyStatus: quiet
      ? "paused"
      : handoff
        ? "sales_owned"
        : last?.direction === "inbound" && reviewed?.reply_required !== false
          ? "review_needed"
          : "no_unanswered_message",
    jobs,
    events: timeline,
    engagement: responseSummary(timeline),
    outcomes: referralOutcomes(jobs),
    generatedAt: new Date().toISOString(),
  };
}
