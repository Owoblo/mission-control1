import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/session";
import { canHandleLeadCommunications } from "@/lib/server/sales-permissions";
import {
  handoffDb,
  type PartnerHandoffLead,
} from "@/lib/server/partner-sales-handoff";
export const dynamic = "force-dynamic";
export async function GET() {
  const session = await getSessionUser();
  if (
    !session ||
    !["owner", "manager", "sales_rep"].includes(session.role || "")
  )
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  try {
    const rows = await handoffDb<
      Array<{ id: string; data: PartnerHandoffLead }>
    >("crm_leads", {
      deleted: "eq.false",
      "data->partnerHandoff": "not.is.null",
      select: "id,data",
      order: "updated_at.desc",
      limit: "1000",
    });
    return NextResponse.json({
      leads: rows
        .filter((r) => canHandleLeadCommunications(session, r.data))
        .map((r) => ({
          id: r.id,
          name: r.data.name,
          summary: r.data.partnerHandoff?.summary,
          owner: r.data.assignedRepName,
          status: r.data.handoffStatus,
          brief: r.data.partnerHandoff,
        })),
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Unable to load opportunities" },
      { status: 500 },
    );
  }
}
