import { handoffDb } from "./partner-sales-handoff";
import { salesOwnership, type OwnershipLead } from "../partner-context";
export async function loadSalesOwnership(contactIds: string[]) {
  const rows: OwnershipLead[] = [];
  try {
    for (let i = 0; i < contactIds.length; i += 100) {
      const chunk = contactIds.slice(i, i + 100);
      const page = await handoffDb<OwnershipLead[]>("crm_leads", {
        deleted: "eq.false",
        "data->>partnerReferralContactId": `in.(${chunk.join(",")})`,
        "data->partnerHandoff": "not.is.null",
        select: "id,data",
        limit: "1000",
      });
      if (page.length === 1000)
        return {
          complete: false,
          owners: new Map<string, { owner: string; leadId: string }>(),
        };
      rows.push(...page);
    }
    return { complete: true, owners: salesOwnership(rows) };
  } catch {
    return {
      complete: false,
      owners: new Map<string, { owner: string; leadId: string }>(),
    };
  }
}
