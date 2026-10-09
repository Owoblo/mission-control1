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
    async function chunks<T>(
      ids: string[],
      read: (chunk: string[]) => Promise<T[]>,
    ) {
      const rows: T[] = [];
      // Bound DB pressure while avoiding hundreds of sequential round trips.
      for (let i = 0; i < ids.length; i += 400) {
        const work = Array.from(
          { length: Math.ceil(Math.min(400, ids.length - i) / 100) },
          (_, n) => ids.slice(i + n * 100, i + (n + 1) * 100),
        );
        rows.push(...(await Promise.all(work.map(read))).flat());
      }
      return rows;
    }
    const contacts = await chunks<Record<string, any>>(ids, (part) =>
      all("market_contacts", {
        id: `in.(${part.join(",")})`,
        select:
          "id,name,phone,city,owner_name,owner_email,assigned_manager_user_id",
      }),
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
    const scopedIds = scoped.map((c) => String(c.id));
    const leads = await chunks<{ id: string; data: CRMLead }>(
      scopedIds,
      (part) =>
        all("crm_leads", {
          "data->>partnerReferralContactId": `in.(${part.join(",")})`,
          deleted: "eq.false",
          select: "id,data",
        }),
    );
    const referrals = await chunks<{ crm_lead_id?: string }>(
      scopedIds,
      (part) =>
        all("partner_referrals", {
          contact_id: `in.(${part.join(",")})`,
          select: "id,crm_lead_id",
        }),
    );
    const known = new Set(leads.map((l) => l.id));
    const missing = [
      ...new Set(
        referrals
          .map((r) => r.crm_lead_id)
          .filter((id): id is string => !!id && !known.has(id)),
      ),
    ];
    leads.push(
      ...(await chunks<{ id: string; data: CRMLead }>(missing, (part) =>
        all("crm_leads", {
          id: `in.(${part.join(",")})`,
          deleted: "eq.false",
          select: "id,data",
        }),
      )),
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
