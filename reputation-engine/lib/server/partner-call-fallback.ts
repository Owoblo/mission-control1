import { handoffDb } from "./partner-sales-handoff";
import { getDialerSettings } from "./dialer-settings";
import { xmlEscape } from "./carrier-voice";
import { getAppBaseUrl } from "./runtime";
/** A second ring attempt to the configured Sales apps, within the same caller session. */
export async function partnershipSalesFallbackXml(
  customer: string,
  line: string,
) {
  const [users, settings] = await Promise.all([
    handoffDb<Array<{ id: string }>>("app_users", {
      role: "in.(owner,manager,sales_rep)",
      select: "id",
      limit: "200",
    }),
    getDialerSettings(),
  ]);
  const configured = settings?.ringGroups?.salesUserIds;
  const allowed = users.filter(
    (u) => !configured?.length || configured.includes(u.id),
  );
  const targets = allowed
    .slice(0, 10)
    .map(
      (u) =>
        `<Client><Identity>saturn-rep-${xmlEscape(u.id)}</Identity><Parameter name="DisplayName" value="${xmlEscape(customer)} — Partnership call" /></Client>`,
    )
    .join("");
  if (!targets) return null;
  const action = new URL("/api/marketing/dialer/call-status", getAppBaseUrl());
  action.searchParams.set("salesFallback", "1");
  const recording = new URL(
    "/api/marketing/dialer/recording-callback",
    getAppBaseUrl(),
  );
  recording.searchParams.set("customer", customer);
  recording.searchParams.set("line", line);
  recording.searchParams.set("direction", "inbound");
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Please hold while we connect you with our sales team.</Say><Dial timeout="25" record="record-from-answer" recordingStatusCallback="${xmlEscape(recording.toString())}" recordingStatusCallbackMethod="POST" recordingStatusCallbackEvent="completed" action="${xmlEscape(action.toString())}" method="POST">${targets}</Dial></Response>`;
}
