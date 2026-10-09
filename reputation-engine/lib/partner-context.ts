export type ContextEvent = {
  id: string;
  source: string;
  sourceId: string;
  at: string;
  channel: string;
  direction: string;
  text: string;
  audience: "partner" | "client";
  person: string;
  personId?: string;
  leadId?: string;
  providerId?: string;
  from?: string;
  to?: string;
  status?: string;
  playback?: string;
};
export function phoneKey(value: unknown) {
  const d = String(value || "").replace(/\D/g, "");
  return d.length === 10
    ? `1${d}`
    : d.length === 11 && d.startsWith("1")
      ? d
      : "";
}
export function deduplicateEvents(events: ContextEvent[]) {
  const map = new Map<string, ContextEvent>();
  for (const event of events) {
    // Text/time similarity is insufficient: legitimate repeated messages must survive.
    const key = event.providerId
      ? `${event.channel}:${event.providerId.replace(/^telnyx:/, "")}`
      : `${event.source}:${event.sourceId}`;
    const old = map.get(key);
    if (!old) map.set(key, event);
    else
      map.set(key, {
        ...old,
        direction:
          old.direction === "recorded" ? event.direction : old.direction,
        text: event.text.length > old.text.length ? event.text : old.text,
        playback: old.playback || event.playback,
        leadId: old.leadId || event.leadId,
        status: event.status || old.status,
        from: old.from || event.from,
        to: old.to || event.to,
      });
  }
  return [...map.values()].sort(
    (a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id),
  );
}
export type ResponseKind =
  | "substantive"
  | "reaction"
  | "automated"
  | "opt_out"
  | "acknowledgement";
export function responseKind(text: string): ResponseKind {
  const s = text.replace(/^Inbound SMS:\s*/i, "").trim();
  if (
    /^(stop|unsubscribe|remove me|do not contact me|don't contact me)[.!\s]*$/i.test(
      s,
    )
  )
    return "opt_out";
  if (
    /^(liked|loved|laughed at|emphasized|disliked|removed a reaction)\s+[“"‘]/i.test(
      s,
    ) ||
    /^[\s\u2000-\u200f\uFE0F👍❤️❤🙏😊]+$/.test(s) ||
    /^[\s\u2000-\u200f]*[👍❤❤️].*\bto\s+[“"]/.test(s)
  )
    return "reaction";
  if (
    /driving.*can't text|sent from my (car|rogue)|automatic reply|auto.?reply|i.m (just )?(the |a )?(friendly )?assistant.*leasing/i.test(
      s,
    )
  )
    return "automated";
  if (/^(thanks|thank you|ty|thanks!|thank you!)[.!\s]*$/i.test(s))
    return "acknowledgement";
  return "substantive";
}
export function responseSummary(events: ContextEvent[]) {
  const groups = new Map<string, Set<ResponseKind>>();
  for (const e of events.filter(
    (e) =>
      e.direction === "inbound" &&
      e.channel === "sms" &&
      e.audience === "partner",
  )) {
    const key = e.personId || phoneKey(e.from) || e.leadId || e.id;
    const set = groups.get(key) || new Set<ResponseKind>();
    set.add(responseKind(e.text));
    groups.set(key, set);
  }
  const sets = [...groups.values()];
  return {
    respondents: sets.length,
    substantive: sets.filter((s) => s.has("substantive")).length,
    reactionOnly: sets.filter((s) => s.size === 1 && s.has("reaction")).length,
    automatedOnly: sets.filter((s) => s.size === 1 && s.has("automated"))
      .length,
    acknowledgementOnly: sets.filter(
      (s) => s.size === 1 && s.has("acknowledgement"),
    ).length,
    optOut: sets.filter((s) => s.has("opt_out")).length,
  };
}
/** Scheduled-reply conversations are exempt; cold jobs must remain on their approved local day/window. */
export function campaignWindow(
  notes: unknown,
  scheduledAt: string,
  now = new Date(),
) {
  let c: Record<string, unknown>;
  try {
    c =
      typeof notes === "string" && notes.trim()
        ? JSON.parse(notes)
        : ((notes || {}) as Record<string, unknown>);
  } catch {
    return { allowed: false, reason: "invalid_campaign_window" };
  }
  if (!c || typeof c !== "object" || Array.isArray(c))
    return { allowed: false, reason: "invalid_campaign_window" };
  const zone = typeof c.timezone === "string" ? c.timezone : "America/Toronto";
  try {
    const parts = (d: Date) =>
      Object.fromEntries(
        new Intl.DateTimeFormat("en-CA", {
          timeZone: zone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        })
          .formatToParts(d)
          .map((p) => [p.type, p.value]),
      );
    const n = parts(now),
      s = parts(new Date(scheduledAt));
    const day = (p: Record<string, string>) => `${p.year}-${p.month}-${p.day}`;
    const hour = Number(n.hour) + Number(n.minute) / 60;
    const start = Number(c.startHour ?? 10),
      end = Number(c.endHour ?? 17);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end > 24 ||
      end <= start
    )
      return { allowed: false, reason: "invalid_campaign_window" };
    return day(n) !== day(s)
      ? { allowed: false, reason: "campaign_day_expired" }
      : hour >= end
        ? { allowed: false, reason: "campaign_window_closed" }
        : hour < start
          ? { allowed: false, reason: "campaign_window_not_open" }
          : { allowed: true, reason: "" };
  } catch {
    return { allowed: false, reason: "invalid_campaign_window" };
  }
}

export type OwnershipLead = {
  id: string;
  data: {
    partnerReferralContactId?: string;
    assignedRepName?: string;
    assignedRepUserId?: string;
    handoffStatus?: string;
    partnerHandoff?: { acceptedAt?: string };
  };
};
export function salesOwnership(leads: OwnershipLead[]) {
  const owners = new Map<string, { owner: string; leadId: string }>();
  const returned = new Set(
    leads
      .filter((l) => l.data.handoffStatus === "needs_partner_follow_up")
      .map((l) => l.data.partnerReferralContactId),
  );
  for (const { id, data: d } of leads)
    if (
      d.partnerReferralContactId &&
      !returned.has(d.partnerReferralContactId) &&
      d.partnerHandoff?.acceptedAt &&
      d.assignedRepUserId &&
      ["new", "in_progress"].includes(d.handoffStatus || "")
    )
      owners.set(d.partnerReferralContactId, {
        owner: d.assignedRepName || "Sales",
        leadId: id,
      });
  return owners;
}
export function referralOutcomes(
  jobs: Array<{
    id: string;
    stage?: string;
    role?: string;
    hasHandoff?: boolean;
  }>,
) {
  const unique = [...new Map(jobs.map((j) => [j.id, j])).values()];
  // A partner-role handoff is a channel, not a second customer move.
  const moves = unique.filter(
    (j) => j.role !== "partner" && (!j.hasHandoff || j.role === "customer"),
  );
  return {
    linkedRecords: unique.length,
    movingOpportunities: moves.length,
    referralChannels: unique.filter((j) => j.role === "partner").length,
    quoted: moves.filter((j) => j.stage === "quoted").length,
    booked: moves.filter((j) =>
      [
        "booked",
        "dispatched",
        "in_progress",
        "completed",
        "customer_success",
      ].includes(j.stage || ""),
    ).length,
    completed: moves.filter((j) =>
      ["completed", "customer_success"].includes(j.stage || ""),
    ).length,
  };
}

/** Failed submissions and system delivery events do not answer a person. */
export function latestPartnerMessage(events: ContextEvent[]) {
  return [...events]
    .filter(
      (e) =>
        e.audience === "partner" &&
        ["sms", "email"].includes(e.channel) &&
        ["inbound", "outbound"].includes(e.direction) &&
        !(
          e.direction === "outbound" &&
          [
            "failed",
            "undelivered",
            "rejected",
            "canceled",
            "cancelled",
          ].includes(e.status || "")
        ),
    )
    .sort((a, b) => a.at.localeCompare(b.at))
    .at(-1);
}
