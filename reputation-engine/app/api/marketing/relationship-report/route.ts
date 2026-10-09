import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/session";
import { handoffDb } from "@/lib/server/partner-sales-handoff";
import { partnershipRecordMatchesSession } from "@/lib/server/partnership-access";
import {
  phoneKey,
  responseSummary,
  referralOutcomes,
  type ContextEvent,
} from "@/lib/partner-context";
import { canHandleLeadCommunications } from "@/lib/server/sales-permissions";
import type { CRMLead } from "@/lib/types";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request) {
  const session = await getSessionUser();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const days = new URL(request.url).searchParams.get("days") === "1" ? 1 : 14;
  const since = new Date(Date.now() - days * 86400000).toISOString();
  try {
    let complete = true;
    async function all<T>(
      table: string,
      query: Record<string, string>,
      max = 20000,
    ) {
      const rows: T[] = [];
      for (let offset = 0; offset < max; offset += 500) {
        const p = await handoffDb<T[]>(table, {
          ...query,
          limit: "500",
          offset: String(offset),
          order: query.order || "id.asc",
        });
        rows.push(...p);
        if (p.length < 500) return rows;
      }
      complete = false;
      return rows;
    }
    const touches = await all<{
      id: string;
      contact_id: string;
      direction: string;
      channel: string;
      notes: string;
      created_at: string;
    }>("market_touches", {
      created_at: `gte.${since}`,
      channel: "eq.sms",
      direction: "in.(inbound,outbound)",
      select: "id,contact_id,direction,channel,notes,created_at",
    });
    const ids = [...new Set(touches.map((t) => t.contact_id))];
    const contacts: Array<Record<string, any>> = [];
    for (let i = 0; i < ids.length; i += 100)
      contacts.push(
        ...(await all<Record<string, any>>("market_contacts", {
          id: `in.(${ids.slice(i, i + 100).join(",")})`,
          select:
            "id,name,phone,city,owner_name,owner_email,assigned_manager_user_id",
        })),
      );
    const scoped = contacts.filter((c) =>
      partnershipRecordMatchesSession(session, c),
    );
    const byId = new Map(scoped.map((c) => [c.id, c]));
    const events: ContextEvent[] = touches
      .filter((t) => byId.has(t.contact_id))
      .map((t) => {
        const c = byId.get(t.contact_id)!;
        return {
          id: t.id,
          source: "Partnerships",
          sourceId: t.id,
          at: t.created_at,
          channel: t.channel,
          direction: t.direction,
          text: t.notes || "",
          audience: "partner",
          person: c.name,
          personId: phoneKey(c.phone) || c.id,
        };
      });
    const leads: Array<{ id: string; data: CRMLead }> = [];
    // Outcomes describe records linked to people active in this period, not a claimed outreach conversion rate.
    for (let i = 0; i < scoped.length; i += 100)
      leads.push(
        ...(await all<{ id: string; data: CRMLead }>("crm_leads", {
          "data->>partnerReferralContactId": `in.(${scoped
            .slice(i, i + 100)
            .map((c) => c.id)
            .join(",")})`,
          deleted: "eq.false",
          select: "id,data",
        })),
      );
    const permitted = leads.filter((l) =>
      canHandleLeadCommunications(session, l.data),
    );
    return NextResponse.json({
      since,
      through: new Date().toISOString(),
      complete,
      engagement: responseSummary(events),
      outboundPeople: new Set(
        events.filter((e) => e.direction === "outbound").map((e) => e.personId),
      ).size,
      outcomes: referralOutcomes(
        permitted.map((l) => ({
          id: l.id,
          stage: l.data.stage,
          role: l.data.primaryContactRole,
          hasHandoff: !!l.data.partnerHandoff,
        })),
      ),
      definition:
        "Activity in the selected rolling period, across all permitted markets. Responses include earlier outreach; this is not a batch conversion rate. Outcomes are current stages of linked records.",
    });
  } catch {
    return NextResponse.json(
      { error: "Report unavailable; no totals inferred." },
      { status: 503 },
    );
  }
}
