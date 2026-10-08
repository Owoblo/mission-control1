import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/session";
import {
  canEditLead,
  canHandleLeadCommunications,
} from "@/lib/server/sales-permissions";
import {
  handoffDb,
  handoffHistory,
  handoffRecordings,
  type PartnerHandoffLead,
} from "@/lib/server/partner-sales-handoff";
import { HANDOFF_STATES, requiredBriefText } from "@/lib/partner-sales-handoff";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
async function access(ctx: Context) {
  const session = await getSessionUser();
  if (!session)
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  const { id } = await ctx.params;
  const [row] = await handoffDb<
    Array<{ id: string; data: PartnerHandoffLead }>
  >("crm_leads", { id: `eq.${id}`, deleted: "eq.false", select: "id,data" });
  if (!row || !canHandleLeadCommunications(session, row.data))
    return {
      error: NextResponse.json(
        { error: "Opportunity unavailable" },
        { status: 403 },
      ),
    };
  return { session, id, lead: row.data };
}
export async function GET(_request: Request, ctx: Context) {
  try {
    const a = await access(ctx);
    if (a.error) return a.error;
    const history = a.lead.partnerReferralContactId
      ? await handoffHistory(a.lead.partnerReferralContactId)
      : [];
    return NextResponse.json({
      lead: a.lead,
      canEdit: canEditLead(a.session, a.lead),
      history: history.map(({ metadata, ...t }) => t),
      recordings: await handoffRecordings(history),
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Unable to load handoff" },
      { status: 500 },
    );
  }
}
export async function PATCH(request: Request, ctx: Context) {
  try {
    const a = await access(ctx);
    if (a.error) return a.error;
    if (!canEditLead(a.session, a.lead))
      return NextResponse.json(
        { error: "Only the assigned rep or manager can update this handoff" },
        { status: 403 },
      );
    const body = await request.json();
    const brief = a.lead.partnerHandoff;
    if (!brief) throw new Error("No reviewed handoff exists");
    if (JSON.stringify(body.expected) !== JSON.stringify(brief))
      return NextResponse.json(
        { error: "Handoff changed. Reload before updating" },
        { status: 409 },
      );
    const now = new Date().toISOString();
    const actor = a.session.name || a.session.userId || "CRM user";
    const status =
      body.action === "accept" ? "in_progress" : String(body.status);
    if (!HANDOFF_STATES.includes(status as (typeof HANDOFF_STATES)[number]))
      throw new Error("Choose a valid handoff status");
    const updated =
      body.action === "accept"
        ? {
            ...brief,
            acceptedAt: brief.acceptedAt || now,
            acceptedBy: brief.acceptedBy || actor,
          }
        : {
            ...brief,
            outcome: requiredBriefText(body.outcome, "Outcome"),
            outcomeAt: now,
            outcomeBy: actor,
            nextAction: requiredBriefText(body.nextAction, "Next action", 1200),
            dueAt: body.dueAt,
          };
    if (
      !Number.isFinite(Date.parse(updated.dueAt)) ||
      (body.action !== "accept" &&
        status !== "completed" &&
        Date.parse(updated.dueAt) < Date.now() - 60000)
    )
      throw new Error("Choose a current or future follow-up time");
    await handoffDb("rpc/update_reviewed_partner_handoff", {}, "POST", {
      p_id: a.id,
      p_expected: brief,
      p_brief: updated,
      p_status: status,
      p_actor: actor,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Update failed" },
      { status: 409 },
    );
  }
}
