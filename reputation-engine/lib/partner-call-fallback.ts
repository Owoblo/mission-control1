export function partnershipCallNeedsFallback(input: {
  dialStatus: string;
  direction: string;
  alreadyFallback: boolean;
}) {
  return (
    !input.alreadyFallback &&
    !input.direction.startsWith("outbound") &&
    ["no-answer", "busy", "failed", "canceled"].includes(input.dialStatus)
  );
}
