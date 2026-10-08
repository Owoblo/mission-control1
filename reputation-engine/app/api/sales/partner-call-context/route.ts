import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/session";
import { canHandleLeadCommunications } from "@/lib/server/sales-permissions";
import {
  handoffDb,
  type PartnerHandoffLead,
} from "@/lib/server/partner-sales-handoff";
import { normalizePhone } from "@/lib/sales-phones";
export async function GET(request: Request) {
  const session = await getSessionUser();
  if (
    !session ||
    !["owner", "manager", "sales_rep"].includes(session.role || "")
  )
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const phone = normalizePhone(new URL(request.url).searchParams.get("phone"));
  if (!/^\+1\d{10}$/.test(phone))
    return NextResponse.json({ opportunities: [] });
  try {
    const rows = await handoffDb<
      Array<{ id: string; data: PartnerHandoffLead }>
    >("crm_leads", {
      deleted: "eq.false",
      "data->>partnerReferralPhone": `eq.${phone}`,
      "data->partnerHandoff": "not.is.null",
      select: "id,data",
      limit: "50",
    });
    return NextResponse.json({
      opportunities: rows
        .filter(
          (r) =>
            canHandleLeadCommunications(session, r.data) &&
            r.data.handoffStatus !== "completed",
        )
        .map((r) => ({
          id: r.id,
          name: r.data.partnerReferralName,
          summary: r.data.partnerHandoff?.summary,
          nextAction: r.data.partnerHandoff?.nextAction,
          contactInstructions: r.data.partnerHandoff?.callbackPermission,
          owner: r.data.assignedRepName,
        })),
    });
  } catch {
    return NextResponse.json({ error: "Context unavailable" }, { status: 503 });
  }
}
