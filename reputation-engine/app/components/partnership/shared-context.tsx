"use client";
import { useEffect, useState } from "react";
import type { ContextEvent } from "@/lib/partner-context";
type Data = {
  complete: boolean;
  errors: string[];
  ambiguousPhone: boolean;
  responsibility: string;
  replyStatus: string;
  events: ContextEvent[];
  jobs: Array<{
    id: string;
    name: string;
    role: string;
    kind: string;
    stage: string;
    owner?: string;
    nextAction?: string;
    dueAt?: string;
    moveDate?: string;
  }>;
  outcomes: {
    linkedRecords: number;
    movingOpportunities: number;
    referralChannels: number;
    quoted: number;
    booked: number;
    completed: number;
  };
};
export function SharedPartnerContext({ contactId }: { contactId: string }) {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [open, setOpen] = useState(false),
    [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    fetch(`/api/marketing/contacts/${encodeURIComponent(contactId)}/context`, {
      cache: "no-store",
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [contactId, version]);
  return (
    <section className="my-2 rounded-xl border border-slate-200 bg-white p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="font-semibold"
        >
          {open ? "▾" : "▸"} Shared Partnerships &amp; Sales context
        </button>
        <button
          type="button"
          onClick={() => setVersion((v) => v + 1)}
          className="text-blue-700"
        >
          Refresh
        </button>
      </div>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {!data && !error && <p>Checking conversations and ownership…</p>}
      {data && (
        <>
          <p className="mt-1">
            {data.responsibility} · {data.replyStatus.replaceAll("_", " ")}
          </p>
          {!data.complete && (
            <p role="alert" className="text-amber-800">
              Some history is unavailable. Review both inboxes before replying.
            </p>
          )}
          {data.ambiguousPhone && (
            <p className="text-amber-800">
              Shared phone: unlinked conversations were not merged.
            </p>
          )}
          <p className="text-slate-600">
            {data.outcomes.linkedRecords} linked records ·{" "}
            {data.outcomes.referralChannels} referral channels ·{" "}
            {data.outcomes.movingOpportunities} moving opportunities ·{" "}
            {data.outcomes.quoted} quoted · {data.outcomes.booked} booked or
            later · {data.outcomes.completed} completed
          </p>
          {open && (
            <>
              <div className="my-2 space-y-2">
                {data.jobs.map((j) => (
                  <div key={j.id} className="rounded border p-2">
                    <a
                      className="font-semibold text-blue-700"
                      href={`/sales/leads/${encodeURIComponent(j.id)}`}
                    >
                      {j.name}
                    </a>{" "}
                    ·{" "}
                    {j.kind === "own_move"
                      ? "Realtor’s own move"
                      : j.kind === "client_move"
                        ? "Client move"
                        : j.kind === "referral_channel"
                          ? "Referral channel"
                          : "Role not confirmed"}{" "}
                    · {j.stage}
                    <p>
                      {j.owner || "Owner unassigned"}
                      {j.moveDate ? ` · Move ${j.moveDate}` : ""}
                    </p>
                    {j.nextAction && <p>Next: {j.nextAction}</p>}
                    {j.dueAt && (
                      <p>Follow-up: {new Date(j.dueAt).toLocaleString()}</p>
                    )}
                  </div>
                ))}
              </div>
              <div className="max-h-96 space-y-3 overflow-y-auto">
                {data.events
                  .slice()
                  .reverse()
                  .map((e) => (
                    <article key={e.id} className="rounded bg-slate-50 p-2">
                      <p className="text-xs text-slate-600">
                        {e.source} ·{" "}
                        {e.audience === "client"
                          ? `Client: ${e.person}`
                          : `Realtor: ${e.person}`}{" "}
                        · {e.direction} · {new Date(e.at).toLocaleString()}
                      </p>
                      {(e.from || e.to) && (
                        <p className="text-xs text-slate-500">
                          {e.from} → {e.to}
                        </p>
                      )}
                      <p className="whitespace-pre-wrap break-words">
                        {e.text}
                      </p>
                      {e.playback && (
                        <audio
                          controls
                          preload="none"
                          src={e.playback}
                          className="mt-2 max-w-full"
                        />
                      )}
                      {e.leadId && (
                        <a
                          className="text-blue-700"
                          href={`/sales/leads/${encodeURIComponent(e.leadId)}`}
                        >
                          Open related move
                        </a>
                      )}
                    </article>
                  ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
