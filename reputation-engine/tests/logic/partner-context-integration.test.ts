import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPartnerContext } from "../../lib/server/partner-context";
import type { SessionPayload } from "../../lib/auth";
const owner: SessionPayload = { role: "owner", exp: Date.now() + 60000 };
async function fixture(
  options: {
    ambiguous?: boolean;
    peerFailure?: boolean;
    session?: SessionPayload;
  } = {},
) {
  const oldFetch = globalThis.fetch,
    oldUrl = process.env.SUPABASE_URL,
    oldKey = process.env.SUPABASE_KEY;
  process.env.SUPABASE_URL = "https://context-fixture.invalid";
  process.env.SUPABASE_KEY = "fixture";
  const phone = "+14165551234",
    at = "2026-10-09T16:00:00Z";
  const leads = [
    {
      id: "handoff",
      deleted: false,
      data: {
        id: "handoff",
        name: "Realtor",
        phone,
        branch: "Toronto",
        partnerReferralContactId: "partner",
        primaryContactRole: "partner",
        stage: "contacted",
        handoffStatus: "in_progress",
        assignedRepUserId: "rep",
        assignedRepName: "Thelma",
        partnerHandoff: { acceptedAt: at },
        callLogs: [
          {
            id: "missed",
            type: "call",
            date: at,
            phone,
            direction: "inbound",
            notes: "Missed call",
            callOutcome: "no_answer",
          },
        ],
      },
    },
    {
      id: "job",
      deleted: false,
      data: {
        id: "job",
        name: "Client",
        phone: "+14165559999",
        branch: "Toronto",
        stage: "booked",
        primaryContactRole: "customer",
      },
    },
  ];
  globalThis.fetch = async (input, init) => {
    assert.equal(init?.method || "GET", "GET", "context must be read-only");
    const u = new URL(String(input)),
      table = u.pathname.split("/").at(-1);
    if (table === "market_contacts" && u.searchParams.has("phone")) {
      if (options.peerFailure)
        return new Response("unavailable", { status: 503 });
      return Response.json(
        options.ambiguous
          ? [{ id: "partner" }, { id: "other" }]
          : [{ id: "partner" }],
      );
    }
    if (table === "market_contacts")
      return Response.json([
        { id: "partner", name: "Realtor", phone, city: "Toronto" },
      ]);
    if (table === "partner_referrals")
      return Response.json([
        { id: "referral", crm_lead_id: "job" },
        { id: "duplicate", crm_lead_id: "job" },
      ]);
    if (table === "crm_leads")
      return Response.json(u.searchParams.has("id") ? [leads[1]] : [leads[0]]);
    if (table === "market_touches")
      return Response.json([
        {
          id: "touch",
          contact_id: "partner",
          created_at: at,
          channel: "sms",
          direction: "inbound",
          notes: "My client needs a mover",
          metadata: { twilioSid: "telnyx:one" },
        },
      ]);
    if (table === "sms_messages") {
      const rows = [
        {
          id: "dup",
          created_at: at,
          from_number: phone,
          to_number: "+14370000000",
          direction: "inbound",
          body: "My client needs a mover",
          twilio_sid: "one",
        },
        {
          id: "reply",
          created_at: "2026-10-09T17:00:00Z",
          from_number: "+14370000000",
          to_number: phone,
          direction: "outbound",
          body: "Sales replied",
        },
        {
          id: "client-sms",
          lead_id: "job",
          created_at: at,
          from_number: "+14165559999",
          direction: "inbound",
          body: "Client address",
        },
      ];
      // Respect query narrowing for ambiguous phones as the database would.
      return Response.json(
        options.ambiguous || options.peerFailure
          ? rows.filter((r) => r.lead_id)
          : rows,
      );
    }
    return Response.json([]);
  };
  try {
    return await loadPartnerContext(options.session || owner, "partner");
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_KEY;
    else process.env.SUPABASE_KEY = oldKey;
  }
}
test("context joins referral ledger, Sales replies and missed calls while counting one real booking", async () => {
  const c = await fixture();
  assert.equal(c.complete, true);
  assert.equal(c.outcomes.booked, 1);
  assert.equal(c.outcomes.referralChannels, 1);
  assert.equal(
    c.events.filter((e) => e.providerId?.replace("telnyx:", "") === "one")
      .length,
    1,
  );
  assert.ok(c.events.some((e) => e.text === "Sales replied"));
  assert.ok(
    c.events.some(
      (e) => e.text === "Client address" && e.audience === "client",
    ),
  );
  assert.ok(c.events.some((e) => e.status === "no_answer"));
  assert.equal(c.replyStatus, "sales_owned");
});
test("ambiguous or unavailable identity does not pull in unlinked Sales replies", async () => {
  for (const opt of [{ ambiguous: true }, { peerFailure: true }]) {
    const c = await fixture(opt);
    assert.equal(c.ambiguousPhone, true);
    assert.ok(!c.events.some((e) => e.text === "Sales replied"));
    if ("peerFailure" in opt) assert.equal(c.complete, false);
  }
});
test("branch-restricted context excludes another branch client conversations and jobs", async () => {
  const c = await fixture({
    session: { role: "manager", branch: "Windsor", exp: Date.now() + 60000 },
  });
  assert.equal(c.jobs.length, 0);
  assert.ok(!c.events.some((e) => e.text === "Client address"));
  assert.ok(!c.events.some((e) => e.status === "no_answer"));
});
