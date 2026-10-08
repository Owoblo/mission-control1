"use client";
import { useState } from "react";
import type {
  HandoffTouch,
  PartnerSalesHandoff,
} from "@/lib/partner-sales-handoff";
type Lead = {
  id: string;
  data: {
    name: string;
    partnerLeadSummary?: string;
    handoffStatus?: string;
    assignedRepName?: string;
    partnerHandoff?: PartnerSalesHandoff;
  };
};
type Context = {
  history: HandoffTouch[];
  leads: Lead[];
  users: Array<{ id: string; name: string }>;
};
const fields = [
  ["summary", "Opportunity summary"],
  ["knownDetails", "Known move details"],
  ["missingDetails", "Still to confirm"],
  ["johnContext", "What John has already discussed or promised"],
  ["callbackPermission", "Who to contact, permission and timing"],
  ["nextAction", "What Sales should do next"],
] as const;
export function PartnerSalesHandoffButton({
  contactId,
}: {
  contactId: string;
}) {
  const [open, setOpen] = useState(false),
    [context, setContext] = useState<Context | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [sent, setSent] = useState(false);
  async function load(refresh = false) {
    if (!refresh) setContext(null);
    setReviewed(false);
    setError("");
    setOpen(true);
    try {
      const r = await fetch(
        `/api/marketing/contacts/${encodeURIComponent(contactId)}/sales-handoffs`,
      );
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setContext(d);
    } catch (e) {
      setError(String(e));
    }
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!context) return;
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const r = await fetch(
        `/api/marketing/contacts/${encodeURIComponent(contactId)}/sales-handoffs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...Object.fromEntries(f),
            separateJob: f.get("separateJob") === "on",
            dueAt: new Date(String(f.get("dueAt"))).toISOString(),
            reviewedThroughTouchId: context.history.at(-1)?.id,
          }),
        },
      );
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      if (d.canOpenSales === false) {
        setSent(true);
        setOpen(false);
      } else {
        window.location.assign(`/sales/leads/${encodeURIComponent(d.id)}`);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        className="rounded-lg border px-3 py-2 text-sm font-semibold"
        onClick={() => load()}
      >
        {sent ? "Sent to Sales — view handoff" : "Send to Sales"}
      </button>
      {open && (
        <div
          className="fixed inset-0 z-[100] overflow-y-auto bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Review Sales handoff"
        >
          <div className="mx-auto max-w-4xl rounded-xl bg-white p-5 text-slate-900">
            <div className="flex justify-between">
              <h2 className="text-lg font-bold">Review Sales handoff</h2>
              <button onClick={() => setOpen(false)}>Close</button>
            </div>
            <p className="my-2 text-sm">
              Create one opportunity per job. Confirm who Sales should contact
              and preserve any callback promised by John.
            </p>
            {error && (
              <p role="alert" className="my-2 text-red-700">
                {error}
              </p>
            )}
            {!context && !error && <p>Loading conversation…</p>}
            {context && (
              <>
                {context.leads.length > 0 && (
                  <div className="my-3 rounded border p-3">
                    <strong>
                      Existing opportunities — open the same job here
                    </strong>
                    {context.leads.map((l) => (
                      <div key={l.id} className="mt-2">
                        <a
                          className="text-blue-700 underline"
                          href={`/sales/leads/${encodeURIComponent(l.id)}`}
                        >
                          {l.data.partnerLeadSummary || l.data.name}
                        </a>
                        <p className="text-xs">
                          {l.data.assignedRepName} · {l.data.handoffStatus}{" "}
                          {l.data.partnerHandoff?.outcome &&
                            `· ${l.data.partnerHandoff.outcome}`}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
                <details open className="my-3">
                  <summary className="font-semibold">
                    Partnership conversation
                  </summary>
                  <button
                    type="button"
                    onClick={() => load(true)}
                    className="my-2 text-sm text-blue-700 underline"
                  >
                    Refresh conversation (keeps your draft)
                  </button>
                  <div className="mt-2 max-h-64 overflow-y-auto rounded border p-3">
                    {context.history.map((t) => (
                      <div key={t.id} className="mb-3 text-sm">
                        <div className="text-xs text-slate-500">
                          {new Date(t.created_at).toLocaleString()} ·{" "}
                          {t.direction} · {t.channel}
                        </div>
                        <p className="whitespace-pre-wrap">{t.notes}</p>
                      </div>
                    ))}
                  </div>
                </details>
                <form onSubmit={submit} className="space-y-3">
                  <label className="block text-sm">
                    Message or call that establishes this job
                    <select
                      required
                      name="sourceTouchId"
                      className="block w-full rounded border p-2"
                      defaultValue=""
                    >
                      <option value="">Select the source</option>
                      {context.history
                        .filter(
                          (t) =>
                            t.direction === "inbound" || t.channel === "call",
                        )
                        .slice()
                        .reverse()
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {new Date(t.created_at).toLocaleString()} —{" "}
                            {(t.notes || t.channel).slice(0, 140)}
                          </option>
                        ))}
                    </select>
                  </label>
                  {fields.map(([key, label]) => (
                    <label key={key} className="block text-sm">
                      {label}
                      <textarea
                        name={key}
                        required
                        maxLength={
                          [
                            "summary",
                            "nextAction",
                            "callbackPermission",
                          ].includes(key)
                            ? 1200
                            : 4000
                        }
                        rows={2}
                        className="block w-full rounded border p-2"
                      />
                    </label>
                  ))}
                  <div className="grid gap-3 sm:grid-cols-3">
                    <label className="text-sm">
                      Primary contact is
                      <select
                        name="primaryContactRole"
                        required
                        className="block w-full rounded border p-2"
                      >
                        <option value="partner">Referring partner</option>
                        <option value="customer">
                          The customer themselves
                        </option>
                      </select>
                    </label>
                    <label className="text-sm">
                      Sales owner
                      <select
                        name="assignedRepUserId"
                        required
                        defaultValue=""
                        className="block w-full rounded border p-2"
                      >
                        <option value="">Choose owner</option>
                        {context.users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-sm">
                      Follow up by (your local time)
                      <input
                        type="datetime-local"
                        name="dueAt"
                        required
                        className="block w-full rounded border p-2"
                      />
                    </label>
                  </div>
                  {context.leads.length > 0 && (
                    <label className="block text-sm">
                      <input type="checkbox" name="separateJob" required /> I
                      reviewed the existing opportunities. This is a separate
                      job.
                    </label>
                  )}
                  <label className="block text-sm">
                    <input
                      type="checkbox"
                      required
                      checked={reviewed}
                      onChange={(e) => setReviewed(e.target.checked)}
                    />{" "}
                    I reviewed the conversation and contact instructions.
                  </label>
                  <button
                    disabled={busy}
                    className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
                  >
                    {busy
                      ? "Creating…"
                      : "Create Sales opportunity and follow-up task"}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
