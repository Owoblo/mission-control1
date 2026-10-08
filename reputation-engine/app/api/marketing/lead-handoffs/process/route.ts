import { NextResponse } from "next/server";
import { detectPartnershipLeadSignal } from "@/lib/server/partnership-lead-detection";
import { isAuthorizedCronRequest } from "@/lib/server/cron-auth";
import {
  handoffDb,
  handoffContact,
  contactHandoffLeads,
} from "@/lib/server/partner-sales-handoff";
import {
  currentHandoffCandidates,
  type HandoffTouch,
} from "@/lib/partner-sales-handoff";
import { isPartnershipSenderNumber } from "@/lib/partnership-lines";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
// Detection creates review work only. A reviewed handoff creates a Sales lead.
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const touches = await handoffDb<HandoffTouch[]>("market_touches", {
      direction: "eq.inbound",
      channel: "eq.sms",
      created_at: `gte.${new Date(Date.now() - 7 * 86400000).toISOString()}`,
      select: "id,contact_id,channel,direction,notes,created_at,metadata",
      order: "created_at.desc",
      limit: "5000",
    });
    const candidates = currentHandoffCandidates(
      touches.filter((t) =>
        isPartnershipSenderNumber(
          String(
            t.metadata?.to ||
              t.metadata?.To ||
              t.metadata?.to_number ||
              t.metadata?.toNumber ||
              "",
          ),
        ),
      ),
      detectPartnershipLeadSignal,
    );
    let reviewed = 0;
    for (const t of candidates) {
      const contact = await handoffContact(t.contact_id);
      if (
        !contact ||
        contact.do_not_contact ||
        contact.cross_channel_suppressed_at
      )
        continue;
      const leads = await contactHandoffLeads(t.contact_id);
      // Existing/deleted opportunities need deliberate review, never resurrection or reset.
      if (
        leads.some(
          (l) =>
            l.deleted ||
            !l.data.partnerHandoff ||
            Date.parse(l.data.partnerHandoff.reviewedAt) >=
              Date.parse(t.created_at),
        )
      )
        continue;
      const id = `partner-handoff-review-${t.id}`;
      await handoffDb(
        "crm_tasks",
        { on_conflict: "source_key" },
        "POST_IGNORE",
        {
          id,
          source_key: id,
          title: `Review possible Sales opportunity: ${contact.name}`,
          description: `Review the conversation before assigning Sales.\n${t.notes}\n/marketing/partners?contact=${contact.id}`,
          status: "open",
          priority: "high",
          category: "partnership",
          related_type: "partner",
          related_id: contact.id,
          related_label: contact.name,
          source: "condition",
          owner_name: contact.owner_name || "John",
          owner_user_id: contact.assigned_manager_user_id || null,
        },
      );
      reviewed++;
    }
    return NextResponse.json({
      ok: true,
      scanned: touches.length,
      candidates: candidates.length,
      reviewTasksEnsured: reviewed,
      createdSalesLeads: 0,
    });
  } catch (e) {
    console.error("Handoff review processor:", e);
    return NextResponse.json(
      { error: "Handoff review failed" },
      { status: 500 },
    );
  }
}
