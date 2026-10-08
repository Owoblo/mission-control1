"use client";
import { useEffect, useState } from "react";
import {
  handoffIsOverdue,
  type PartnerSalesHandoff,
  type HandoffTouch,
} from "@/lib/partner-sales-handoff";
type Data = {
  lead: {
    primaryContactRole?: string;
    partnerHandoff?: PartnerSalesHandoff;
    handoffStatus?: string;
    assignedRepName?: string;
    partnerReferralContactId?: string;
  };
  history: HandoffTouch[];
  recordings: Array<{
    callId: string;
    playback: string | null;
    transcript: string | null;
    summary: string | null;
  }>;
  canEdit: boolean;
};
export function PartnerHandoffPanel({ leadId }: { leadId: string }) {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    const r = await fetch(
      `/api/sales/leads/${encodeURIComponent(leadId)}/partner-handoff`,
    );
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    setData(d);
  }
  useEffect(() => {
    setData(null);
    void load().catch((e) => setError(String(e)));
  }, [leadId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function update(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(
        `/api/sales/leads/${encodeURIComponent(leadId)}/partner-handoff`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...body,
            expected: data?.lead.partnerHandoff,
          }),
        },
      );
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const b = data?.lead.partnerHandoff;
  return (
    <section className="m-3 rounded-xl border border-sky-200 bg-sky-50 p-4 md:mx-8">
      <h2 className="font-bold">Partnership handoff</h2>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {b && (
        <>
          <p className="mt-2 font-semibold">{b.summary}</p>
          <p className="text-sm">
            Primary contact:{" "}
            {data?.lead.primaryContactRole === "customer"
              ? "the customer themselves"
              : "the referring partner"}
          </p>
          <p className="my-2 text-sm">
            Owner: {data?.lead.assignedRepName} ·{" "}
            {b.acceptedAt
              ? `Accepted by ${b.acceptedBy}`
              : "Awaiting acceptance"}{" "}
            · {data?.lead.handoffStatus}
            <br />
            Due: {new Date(b.dueAt).toLocaleString()}{" "}
            {handoffIsOverdue(b, data?.lead.handoffStatus || "new") && (
              <strong className="text-red-700"> — Overdue</strong>
            )}
          </p>
          <dl className="space-y-2 text-sm">
            {[
              ["Known details", b.knownDetails],
              ["Still to confirm", b.missingDetails],
              ["John’s conversation", b.johnContext],
              ["Contact instructions", b.callbackPermission],
              ["Next action", b.nextAction],
              ["Latest outcome", b.outcome],
            ].map(
              ([k, v]) =>
                v && (
                  <div key={k}>
                    <dt className="font-semibold">{k}</dt>
                    <dd className="whitespace-pre-wrap">{v}</dd>
                  </div>
                ),
            )}
          </dl>
          {data?.canEdit && (
            <div className="mt-3">
              {!b.acceptedAt && (
                <button
                  disabled={busy}
                  onClick={() => update({ action: "accept" })}
                  className="rounded bg-slate-900 px-3 py-2 text-sm text-white"
                >
                  Accept handoff
                </button>
              )}
              <details className="mt-3">
                <summary className="cursor-pointer font-semibold">
                  Record outcome / next step
                </summary>
                <form
                  className="mt-2 space-y-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void update({
                      ...Object.fromEntries(f),
                      dueAt: new Date(String(f.get("dueAt"))).toISOString(),
                    });
                  }}
                >
                  <label className="block text-sm">
                    Outcome
                    <textarea
                      required
                      name="outcome"
                      maxLength={4000}
                      className="block w-full rounded border p-2"
                    />
                  </label>
                  <label className="block text-sm">
                    Next action
                    <input
                      required
                      name="nextAction"
                      maxLength={1200}
                      defaultValue={b.nextAction}
                      className="block w-full rounded border p-2"
                    />
                  </label>
                  <label className="block text-sm">
                    Follow-up time
                    <input
                      required
                      type="datetime-local"
                      name="dueAt"
                      className="block rounded border p-2"
                    />
                  </label>
                  <select
                    name="status"
                    defaultValue="in_progress"
                    className="rounded border p-2"
                  >
                    <option value="in_progress">In progress</option>
                    <option value="needs_partner_follow_up">
                      Needs partnership follow-up
                    </option>
                    <option value="completed">Handoff completed</option>
                  </select>
                  <button
                    disabled={busy}
                    className="ml-2 rounded bg-slate-900 px-3 py-2 text-white"
                  >
                    Save outcome
                  </button>
                  <p className="text-xs">
                    Completing the handoff does not mark the move booked or won.
                  </p>
                </form>
              </details>
            </div>
          )}
        </>
      )}
      {data?.recordings?.map((r) => (
        <details key={r.callId} className="mt-3">
          <summary className="cursor-pointer font-semibold">
            Call recording and transcript
          </summary>
          {r.playback && (
            <audio controls preload="none" src={r.playback} className="mt-2" />
          )}
          <p className="text-sm">{r.summary}</p>
          <p className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-sm">
            {r.transcript || "Transcript not available."}
          </p>
        </details>
      ))}
      {data && (
        <details className="mt-3">
          <summary className="cursor-pointer font-semibold">
            Full partnership conversation
          </summary>
          <div className="mt-2 max-h-80 overflow-y-auto bg-white p-3">
            {data.history.map((t) => (
              <div key={t.id} className="mb-3 text-sm">
                <p className="text-xs text-slate-500">
                  {new Date(t.created_at).toLocaleString()} · {t.direction} ·{" "}
                  {t.channel}
                </p>
                <p className="whitespace-pre-wrap">{t.notes}</p>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
