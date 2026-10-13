export const handoffDraftFields = [
  "summary", "knownDetails", "missingDetails", "johnContext", "callbackPermission", "nextAction",
] as const;
export type HandoffDraftField = typeof handoffDraftFields[number];
export type HandoffDraft = Record<HandoffDraftField, string>;
export function mergeHandoffDraft(current: HandoffDraft, incoming: HandoffDraft, edited: ReadonlySet<string>): HandoffDraft {
  return Object.fromEntries(handoffDraftFields.map(key => [key, edited.has(key) ? current[key] : incoming[key]])) as HandoffDraft;
}
export function emptyHandoffDraft(): HandoffDraft {
  return Object.fromEntries(handoffDraftFields.map(key => [key, ""])) as HandoffDraft;
}
