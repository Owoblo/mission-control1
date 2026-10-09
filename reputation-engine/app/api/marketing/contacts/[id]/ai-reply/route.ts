import { latestPartnerMessage } from "@/lib/partner-context";
import { loadPartnerContext } from "@/lib/server/partner-context";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/session";
import { requireSupabaseEnv } from "@/lib/server/runtime";
import {
  suggestPartnershipReply,
  type PartnershipAssistantContact,
  type PartnershipAssistantTouch,
} from "@/lib/server/partnership-reply-assistant";
import { partnershipRecordMatchesSession } from "@/lib/server/partnership-access";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionUser();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { url, headers } = requireSupabaseEnv();

  const contactRes = await fetch(
    `${url}/rest/v1/market_contacts?id=eq.${encodeURIComponent(id)}&select=id,name,company,title,email,phone,city,industry,stage,decision,affiliate_partner_id,tracking_code,owner_name,assigned_manager_user_id&limit=1`,
    { headers, cache: "no-store" },
  );

  if (!contactRes.ok)
    return NextResponse.json(
      { error: "Could not load partner" },
      { status: 500 },
    );
  const [contact] = (await contactRes.json()) as PartnershipAssistantContact[];
  if (!contact)
    return NextResponse.json({ error: "Partner not found" }, { status: 404 });
  if (
    !partnershipRecordMatchesSession(
      session,
      contact as unknown as Record<string, unknown>,
    )
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const shared = await loadPartnerContext(session, id);
  if (!shared.complete || shared.ambiguousPhone)
    return NextResponse.json(
      {
        error:
          "Review shared conversation history before drafting; some context is unavailable or ambiguous.",
      },
      { status: 409 },
    );
  if (shared.replyStatus === "sales_owned" || shared.replyStatus === "paused")
    return NextResponse.json(
      {
        error:
          shared.responsibility +
          ". Review the owner’s next action before sending another reply.",
      },
      { status: 409 },
    );
  const touches: PartnershipAssistantTouch[] = shared.events
    .filter((e) => e.audience === "partner")
    .map((e) => ({
      id: e.id,
      channel: e.channel,
      direction: e.direction,
      notes: e.text,
      created_by: e.source,
      created_at: e.at,
    }));
  const latestDirect = latestPartnerMessage(shared.events);
  if (latestDirect?.direction === "outbound")
    return NextResponse.json(
      {
        error:
          "A later reply already exists, including the Sales inbox. Review shared context before drafting again.",
      },
      { status: 409 },
    );
  const suggestion = await suggestPartnershipReply({
    contact,
    touches,
    relationshipContext: JSON.stringify({
      ownership: shared.responsibility,
      jobs: shared.jobs,
      clientHistory: shared.events
        .filter((e) => e.audience === "client")
        .slice(-12)
        .map((e) => ({
          person: e.person,
          direction: e.direction,
          at: e.at,
          text: e.text.slice(0, 3000),
        })),
    }),
  });

  return NextResponse.json({
    ok: true,
    contact_id: id,
    suggestion,
  });
}
