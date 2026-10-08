/** A reviewed job brief, separate from the partner's long-lived relationship. */
export type PartnerSalesHandoff = {
  version: 1;
  summary: string;
  knownDetails: string;
  missingDetails: string;
  johnContext: string;
  nextAction: string;
  callbackPermission: string;
  dueAt: string;
  sourceTouchId: string;
  reviewedThroughTouchId: string;
  reviewedAt: string;
  reviewedBy: string;
  acceptedAt?: string;
  acceptedBy?: string;
  outcome?: string;
  outcomeAt?: string;
  outcomeBy?: string;
};
export type HandoffTouch = {
  id: string;
  contact_id: string;
  channel: string;
  direction: string;
  notes: string | null;
  created_at: string;
  metadata?: Record<string, unknown> | null;
};
export const HANDOFF_STATES = [
  "new",
  "in_progress",
  "needs_partner_follow_up",
  "completed",
] as const;
export function requiredBriefText(
  value: unknown,
  label: string,
  max = 4000,
): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    throw new Error(`${label} is required (maximum ${max} characters).`);
  return value.trim();
}
export function validateHandoffBrief(
  input: Record<string, unknown>,
  now = new Date(),
) {
  const dueAt = requiredBriefText(input.dueAt, "Follow-up time", 40);
  if (
    !Number.isFinite(Date.parse(dueAt)) ||
    Date.parse(dueAt) < now.getTime() - 60000
  )
    throw new Error("Choose a current or future follow-up time.");
  if (!["partner", "customer"].includes(String(input.primaryContactRole)))
    throw new Error(
      "Choose whether the contact is the customer or referring partner.",
    );
  return {
    summary: requiredBriefText(input.summary, "Opportunity summary", 1200),
    knownDetails: requiredBriefText(input.knownDetails, "Known move details"),
    missingDetails: requiredBriefText(input.missingDetails, "Missing details"),
    johnContext: requiredBriefText(input.johnContext, "Conversation context"),
    nextAction: requiredBriefText(input.nextAction, "Next action", 1200),
    callbackPermission: requiredBriefText(
      input.callbackPermission,
      "Contact instructions",
      1200,
    ),
    dueAt: new Date(dueAt).toISOString(),
    sourceTouchId: requiredBriefText(
      input.sourceTouchId,
      "Source message",
      100,
    ),
    reviewedThroughTouchId: requiredBriefText(
      input.reviewedThroughTouchId,
      "Latest reviewed message",
      100,
    ),
  };
}
export function handoffIsOverdue(
  brief: PartnerSalesHandoff,
  status: string,
  now = Date.now(),
) {
  return status !== "completed" && Date.parse(brief.dueAt) < now;
}
export function safeRecordingLink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // Only the authenticated CRM playback endpoint. Never expose provider credentials/URLs.
  return value.startsWith("/api/sales/dialer/recording?key=") ? value : null;
}
export function currentHandoffCandidates(
  touches: HandoffTouch[],
  detect: (text: string | null) => { is_lead: boolean },
  now = Date.now(),
) {
  const candidates = new Map<string, HandoffTouch>();
  // Keep a concrete enquiry despite a subsequent acknowledgement. A later explicit
  // closure suppresses it. Every candidate still requires human review.
  const closed = new Set<string>();
  for (const t of [...touches].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  )) {
    if (
      t.direction !== "inbound" ||
      Date.parse(t.created_at) < now - 7 * 86400000 ||
      Date.parse(t.created_at) > now
    )
      continue;
    if (
      /^(?:Inbound SMS:\s*)?(?:stop|unsubscribe)\b|\b(?:no longer need|already (?:booked|found|hired)|move (?:is )?cancelled)\b/i.test(
        t.notes || "",
      )
    )
      closed.add(t.contact_id);
    if (
      !closed.has(t.contact_id) &&
      !candidates.has(t.contact_id) &&
      detect(t.notes).is_lead
    )
      candidates.set(t.contact_id, t);
  }
  return [...candidates.values()];
}
