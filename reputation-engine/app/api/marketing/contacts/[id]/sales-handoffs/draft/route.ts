import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/session";
import { partnershipRecordMatchesSession } from "@/lib/server/partnership-access";
import { normalizePhone } from "@/lib/sales-phones";
import { handoffContact, handoffHistory, handoffRecordings, contactHandoffLeads } from "@/lib/server/partner-sales-handoff";
import { generateHandoffDraft } from "@/lib/server/handoff-draft";
export const maxDuration = 60;
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { id } = await ctx.params;
    const contact = await handoffContact(id);
    if (!contact || !partnershipRecordMatchesSession(session, contact))
      return NextResponse.json({ error: "Contact unavailable" }, { status: 403 });
    const body = await request.json();
    const [history, leads] = await Promise.all([handoffHistory(id), contactHandoffLeads(id, normalizePhone(contact.phone))]);
    const sourceTouchId = typeof body.sourceTouchId === "string" ? body.sourceTouchId : "";
    if (sourceTouchId && !history.some(t => t.id === sourceTouchId && (t.direction === "inbound" || t.channel === "call")))
      return NextResponse.json({ error: "Choose a source from this conversation" }, { status: 400 });
    if (!history.length) return NextResponse.json({ error: "No conversation is available to draft from yet." }, { status: 409 });
    const recordings = await handoffRecordings(history);
    const jobs = leads.filter(l => !l.deleted).map(({ id, data: d }) => ({
      id, name: d.name, stage: d.stage, summary: d.partnerLeadSummary, handoff: d.partnerHandoff,
      moveDate: d.moveDate, originAddress: d.originAddress, destAddress: d.destAddress,
      originAccess: d.originAccess, destAccess: d.destAccess, inventory: d.inventory,
      notes: d.notes, nextAction: d.followUpNote, owner: d.assignedRepName,
    }));
    const draft = await generateHandoffDraft({
      contact: { name: contact.name, company: contact.company, phone: contact.phone, email: contact.email,
        city: contact.city, suppressed: Boolean(contact.do_not_contact || contact.cross_channel_suppressed_at) },
      history: history.map(({ metadata, ...touch }) => touch), jobs,
      recordings: recordings.map(({ playback, ...recording }) => recording), sourceTouchId,
    });
    return NextResponse.json({ draft, basedOnTouchId: history.at(-1)?.id }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Handoff draft failed", error instanceof Error ? error.name : "Unknown error");
    return NextResponse.json({ error: "Unable to prepare the AI draft. Retry or fill in the fields manually." }, { status: 503 });
  }
}
