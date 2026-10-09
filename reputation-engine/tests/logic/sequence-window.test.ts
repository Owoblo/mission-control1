import { test } from "node:test";
import assert from "node:assert/strict";
import { POST } from "../../app/api/marketing/sequence/process/route";
test("an overdue cold job is held without a provider request; unavailable context is not claimed", async () => {
  const oldFetch = globalThis.fetch,
    env = {
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_KEY: process.env.SUPABASE_KEY,
      CRON_SECRET: process.env.CRON_SECRET,
    };
  Object.assign(process.env, {
    SUPABASE_URL: "https://sequence-fixture.invalid",
    SUPABASE_KEY: "fixture",
    CRON_SECRET: "fixture",
  });
  try {
    for (const brokenContext of [false, true]) {
      const writes: Array<{ table: string; body: Record<string, unknown> }> =
        [];
      const job = {
        id: "job",
        channel: "sms",
        status: "pending",
        contact_id: "contact",
        batch_id: "campaign",
        scheduled_at: "2000-01-01T15:00:00Z",
        attempts: 0,
      };
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input));
        assert.equal(
          url.hostname,
          "sequence-fixture.invalid",
          "must never call a provider",
        );
        const table = url.pathname.split("/").at(-1)!;
        if (init?.method === "PATCH") {
          const body = JSON.parse(String(init.body));
          writes.push({ table, body });
          return Response.json(
            body.status === "running" ? [{ ...job, ...body }] : [],
          );
        }
        if (table === "sequence_jobs") return Response.json([job]);
        if (table === "market_contacts")
          return brokenContext
            ? new Response("unavailable", { status: 503 })
            : Response.json([{ id: "contact", phone: "+14165551234" }]);
        if (table === "market_campaigns")
          return Response.json([
            {
              id: "campaign",
              notes: JSON.stringify({ startHour: 10, endHour: 17 }),
            },
          ]);
        return Response.json([]);
      };
      const result = await POST(
        new Request("https://crm.invalid/api/marketing/sequence/process", {
          method: "POST",
          headers: { Authorization: "Bearer fixture" },
        }),
      );
      assert.equal(result.status, brokenContext ? 503 : 200);
      if (brokenContext)
        assert.ok(!writes.some((w) => w.body.status === "running"));
      else
        assert.ok(
          writes.some(
            (w) =>
              w.body.status === "failed" &&
              w.body.error === "campaign_day_expired" &&
              w.body.locked_at === null,
          ),
        );
    }
  } finally {
    globalThis.fetch = oldFetch;
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
