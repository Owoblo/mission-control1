export interface SalesMessageDeliveryResult {
  deduped?: boolean
  result: Record<string, unknown>
}

export function wasSalesMessageDelivered(result: SalesMessageDeliveryResult) {
  return !result.deduped && !Boolean((result.result as { blocked?: boolean }).blocked)
}
