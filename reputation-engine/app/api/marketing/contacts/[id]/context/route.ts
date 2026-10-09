import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/session";
import {
  handoffContact,
  contactHandoffLeads,
} from "@/lib/server/partner-sales-handoff";
import { partnershipRecordMatchesSession } from "@/lib/server/partnership-access";
import { canHandleLeadCommunications } from "@/lib/server/sales-permissions";
import { loadPartnerContext } from "@/lib/server/partner-context";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getSessionUser();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!/^[a-f0-9-]{36}$/i.test(id))
    return NextResponse.json({ error: "Invalid contact" }, { status: 400 });
  try {
    const c = await handoffContact(id);
    if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const accessible =
      partnershipRecordMatchesSession(session, c) ||
      (await contactHandoffLeads(id)).some(
        (l) => !l.deleted && canHandleLeadCommunications(session, l.data),
      );
    if (!accessible)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json(await loadPartnerContext(session, id));
  } catch {
    return NextResponse.json(
      {
        error:
          "Shared context unavailable; review both inboxes before sending.",
      },
      { status: 503 },
    );
  }
}
