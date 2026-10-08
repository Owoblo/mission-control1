import { requireSupabaseEnv } from "./runtime";
import type {
  HandoffTouch,
  PartnerSalesHandoff,
} from "../partner-sales-handoff";
import type { CRMLead } from "../types";
export type PartnerHandoffLead = CRMLead & {
  partnerHandoff?: PartnerSalesHandoff;
};
export type HandoffContact = {
  id: string;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  category: string | null;
  do_not_contact?: boolean;
  cross_channel_suppressed_at?: string | null;
  [key: string]: unknown;
};
export async function handoffDb<T>(
  table: string,
  query: Record<string, string> = {},
  method = "GET",
  body?: unknown,
): Promise<T> {
  const { url, headers } = requireSupabaseEnv();
  const r = await fetch(
    `${url}/rest/v1/${table}?${new URLSearchParams(query)}`,
    {
      method: method === "POST_IGNORE" ? "POST" : method,
      headers: {
        ...headers,
        Prefer:
          method === "POST_IGNORE"
            ? "resolution=ignore-duplicates,return=representation"
            : "return=representation",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!r.ok) {
    const detail = await r.text();
    throw new Error(`Handoff storage ${r.status}: ${detail.slice(0, 250)}`);
  }
  return r.status === 204 ? ([] as T) : r.json();
}
export async function handoffContact(id: string) {
  const [contact] = await handoffDb<HandoffContact[]>("market_contacts", {
    id: `eq.${id}`,
    select: "*",
  });
  return contact || null;
}
export async function handoffHistory(id: string) {
  const touches: HandoffTouch[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await handoffDb<HandoffTouch[]>("market_touches", {
      contact_id: `eq.${id}`,
      select: "id,contact_id,channel,direction,notes,created_at,metadata",
      order: "created_at.asc,id.asc",
      limit: "500",
      offset: String(offset),
    });
    touches.push(...page);
    if (page.length < 500) return touches;
    if (touches.length >= 10000)
      throw new Error("Conversation requires a separate history review.");
  }
}
export async function contactHandoffLeads(id: string, phone?: string | null) {
  return handoffDb<
    Array<{ id: string; data: PartnerHandoffLead; deleted: boolean }>
  >("crm_leads", {
    ...(phone && /^\+1\d{10}$/.test(phone)
      ? {
          or: `(data->>partnerReferralContactId.eq.${id},data->>phone.eq.${phone},data->>phone.eq.${phone.slice(1)},data->>phone.eq.${phone.slice(2)})`,
        }
      : { "data->>partnerReferralContactId": `eq.${id}` }),
    select: "id,data,deleted",
    order: "updated_at.desc",
    limit: "500",
  });
}
export async function handoffSalesUsers() {
  return handoffDb<
    Array<{
      id: string;
      name: string;
      role: string;
      branch?: string;
      email?: string;
    }>
  >("app_users", {
    role: "in.(owner,manager,sales_rep)",
    select: "id,name,role,branch,email",
    order: "name.asc",
  });
}

export async function handoffRecordings(history: HandoffTouch[]) {
  const ids = [
    ...new Set(
      history
        .flatMap((t) => [
          t.metadata?.callSid,
          t.metadata?.call_sid,
          ...(t.notes?.match(/CA[a-fA-F0-9]{32}/g) || []),
        ])
        .filter(
          (v): v is string =>
            typeof v === "string" && /^CA[a-fA-F0-9]{32}$/.test(v),
        ),
    ),
  ].slice(-100);
  if (!ids.length) return [];
  const rows = await handoffDb<
    Array<{
      twilio_call_sid: string;
      cloudflare_object_key: string | null;
      transcript: string | null;
      summary: string | null;
      created_at: string;
    }>
  >("call_recordings", {
    twilio_call_sid: `in.(${ids.join(",")})`,
    select:
      "twilio_call_sid,cloudflare_object_key,transcript,summary,created_at",
    order: "created_at.asc",
  });
  return rows.map((r) => ({
    callId: r.twilio_call_sid,
    createdAt: r.created_at,
    transcript: r.transcript,
    summary: r.summary,
    playback: r.cloudflare_object_key
      ? `/api/sales/dialer/recording?key=${encodeURIComponent(r.cloudflare_object_key)}`
      : null,
  }));
}
export async function queueHandoffInbound(
  contactId: string,
  eventId: string,
  notes: string,
) {
  if (!eventId) return;
  const leads = (await contactHandoffLeads(contactId)).filter(
    (l) =>
      !l.deleted &&
      l.data.partnerHandoff &&
      l.data.handoffStatus !== "completed",
  );
  if (!leads.length) return;
  const owners = [
    ...new Set(leads.map((l) => l.data.assignedRepUserId).filter(Boolean)),
  ];
  const first = leads[0].data;
  const key = `handoff-inbound-${contactId}-${eventId}`;
  await handoffDb("crm_tasks", { on_conflict: "source_key" }, "POST_IGNORE", {
    id: key,
    source_key: key,
    title: `Partner reply / call: ${first.partnerReferralName || first.name}`,
    description: `${notes}\nReview before contacting; preserve promised callback times.\n${leads.map((l) => `/sales/leads/${l.id} — ${l.data.partnerHandoff?.summary}`).join("\n")}`,
    status: "open",
    priority: "high",
    category: "sales",
    source: "condition",
    owner_user_id: owners.length === 1 ? owners[0] : null,
    owner_name: owners.length === 1 ? first.assignedRepName : "John",
    related_type: "lead",
    related_id: leads[0].id,
    related_label: first.name,
    branch: first.branch,
    due_at: new Date(Date.now() + 30 * 60000).toISOString(),
  });
}
