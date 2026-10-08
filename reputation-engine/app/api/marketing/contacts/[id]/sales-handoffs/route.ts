import { canAccessSalesWorkspace } from "@/lib/server/sales-permissions";
import { normalizePhone } from "@/lib/sales-phones";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/session";
import { partnershipRecordMatchesSession } from "@/lib/server/partnership-access";
import {
  handoffContact,
  handoffHistory,
  contactHandoffLeads,
  handoffSalesUsers,
  handoffDb,
} from "@/lib/server/partner-sales-handoff";
import { validateHandoffBrief } from "@/lib/partner-sales-handoff";
import { partnershipHandoffBranch } from "@/lib/partnership-handoff-branch";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
async function access(ctx: Context) {
  const session = await getSessionUser();
  const { id } = await ctx.params;
  if (!session)
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  const contact = await handoffContact(id);
  if (!contact || !partnershipRecordMatchesSession(session, contact))
    return {
      error: NextResponse.json(
        { error: "Contact unavailable" },
        { status: 403 },
      ),
    };
  return { session, contact, id };
}
export async function GET(_request: Request, ctx: Context) {
  try {
    const a = await access(ctx);
    if (a.error) return a.error;
    const [history, leads, users] = await Promise.all([
      handoffHistory(a.id),
      contactHandoffLeads(a.id, normalizePhone(a.contact.phone)),
      handoffSalesUsers(),
    ]);
    return NextResponse.json({
      contact: a.contact,
      history: history.map(({ metadata, ...t }) => t),
      leads: leads
        .filter((l) => !l.deleted)
        .map((l) => ({
          id: l.id,
          data: {
            name: l.data.name,
            partnerLeadSummary: l.data.partnerLeadSummary,
            handoffStatus: l.data.handoffStatus,
            assignedRepName: l.data.assignedRepName,
            partnerHandoff: l.data.partnerHandoff,
          },
        })),
      users: users
        .filter(
          (u) =>
            !a.session.branch || !u.branch || u.branch === a.session.branch,
        )
        .map(({ email, ...u }) => u),
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Unable to load handoff context" },
      { status: 500 },
    );
  }
}
export async function POST(request: Request, ctx: Context) {
  try {
    const a = await access(ctx);
    if (a.error) return a.error;
    const body = await request.json();
    const now = new Date().toISOString();
    const brief = {
      ...validateHandoffBrief(body),
      version: 1,
      reviewedAt: now,
      reviewedBy: a.session.name || a.session.userId || "CRM user",
    };
    if (a.contact.do_not_contact || a.contact.cross_channel_suppressed_at)
      return NextResponse.json(
        { error: "Contact is suppressed" },
        { status: 409 },
      );
    const users = await handoffSalesUsers();
    const rep = users.find(
      (u) =>
        u.id === body.assignedRepUserId &&
        (!a.session.branch || !u.branch || u.branch === a.session.branch),
    );
    if (!rep)
      return NextResponse.json(
        { error: "Choose an available Sales owner" },
        { status: 400 },
      );
    const id = `partner-handoff-${a.id}-${brief.sourceTouchId}`;
    const data = {
      id,
      name: a.contact.name,
      phone: a.contact.phone,
      email: a.contact.email,
      company: a.contact.company,
      stage: "new",
      leadKind: "partner_opportunity",
      primaryContactRole: body.primaryContactRole,
      source: "partner_referral",
      sourceDetail: "reviewed_partnership_handoff",
      partnerReferralContactId: a.id,
      partnerReferralName: a.contact.name,
      partnerReferralCompany: a.contact.company,
      partnerReferralPhone: normalizePhone(a.contact.phone),
      partnerReferralEmail: a.contact.email,
      partnerReferralLinkedAt: now,
      partnerLeadSummary: brief.summary,
      partnerHandoff: brief,
      handoffStatus: "new",
      automationStatus: "handoff",
      automationHandoffAt: now,
      automationHandoffReason: "Reviewed partnership opportunity: assigned rep owns the conversation.",
      handoffAt: now,
      assignedRep: rep.name,
      assignedRepName: rep.name,
      assignedRepUserId: rep.id,
      leadOwnerStatus: "assigned",
      branch: partnershipHandoffBranch(a.contact.city),
      followUpDate: brief.dueAt.slice(0, 10),
      followUpNote: brief.nextAction,
      notes: `Reviewed partnership handoff. Contact instructions: ${brief.callbackPermission}`,
      createdAt: now,
      updatedAt: now,
    };
    const task = {
      id: `handoff-task-${id}`,
      title: `Sales handoff: ${a.contact.name}`,
      description: `${brief.summary}\nNext: ${brief.nextAction}\nContact: ${brief.callbackPermission}`,
      due_at: brief.dueAt,
      owner_user_id: rep.id,
      owner_name: rep.name,
      created_by_user_id: a.session.userId,
      created_by_name: a.session.name,
    };
    const result = await handoffDb(
      "rpc/create_reviewed_partner_handoff",
      {},
      "POST",
      {
        p_contact: a.id,
        p_lead: data,
        p_task: task,
        p_separate_job: body.separateJob === true,
      },
    );
    return NextResponse.json({
      ...(result as Record<string, unknown>),
      canOpenSales: canAccessSalesWorkspace(a.session),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Handoff failed" },
      { status: 409 },
    );
  }
}
