import test from "node:test";
import assert from "node:assert/strict";
import { partnershipSalesFallbackXml } from "../../lib/server/partner-call-fallback";
test("Sales fallback respects configured roster and preserves recording/caller context", async () => {
  const original = globalThis.fetch;
  const before = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_KEY: process.env.SUPABASE_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  };
  Object.assign(process.env, {
    SUPABASE_URL: "https://fixture.invalid",
    SUPABASE_KEY: "fixture",
    NEXT_PUBLIC_APP_URL: "https://crm.example",
  });
  globalThis.fetch = async (input) =>
    new Response(
      JSON.stringify(
        String(input).includes("app_users")
          ? [{ id: "allowed" }, { id: "not-in-ring-group" }]
          : [{ value: { ringGroups: { salesUserIds: ["allowed"] } } }],
      ),
      { status: 200 },
    );
  try {
    const xml = await partnershipSalesFallbackXml(
      "+14165550100",
      "+14374650584",
    );
    assert.ok(xml?.includes("saturn-rep-allowed"));
    assert.ok(!xml?.includes("not-in-ring-group"));
    assert.ok(xml?.includes("salesFallback=1"));
    assert.ok(xml?.includes("customer=%2B14165550100"));
    assert.ok(xml?.includes("line=%2B14374650584"));
    assert.ok(!xml?.includes("<Number>"));
  } finally {
    globalThis.fetch = original;
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
