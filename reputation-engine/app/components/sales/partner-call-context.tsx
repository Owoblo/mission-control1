"use client";
import { useEffect, useState } from "react";
type Opportunity = {
  id: string;
  name: string;
  summary: string;
  nextAction: string;
  contactInstructions: string;
  owner: string;
};
export function PartnerCallContext({ phone }: { phone: string }) {
  const [items, setItems] = useState<Opportunity[]>([]);
  useEffect(() => {
    setItems([]);
    const c = new AbortController();
    fetch(
      `/api/sales/partner-call-context?phone=${encodeURIComponent(phone)}`,
      { signal: c.signal },
    )
      .then(async (r) => {
        if (r.ok) {
          const d = await r.json();
          setItems(d.opportunities);
        }
      })
      .catch(() => {});
    return () => c.abort();
  }, [phone]);
  if (!items.length) return null;
  return (
    <div className="mt-3 w-full rounded border border-sky-300/30 bg-sky-500/10 p-3 text-left text-xs">
      <strong>
        Partnership context
        {items.length > 1 ? " — confirm which job they are calling about" : ""}
      </strong>
      {items.map((r) => (
        <div key={r.id} className="mt-2">
          <a
            href={`/sales/leads/${encodeURIComponent(r.id)}`}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            {r.name}: {r.summary}
          </a>
          <p>Owner: {r.owner}</p>
          <p>{r.nextAction}</p>
          <p>{r.contactInstructions}</p>
        </div>
      ))}
    </div>
  );
}
