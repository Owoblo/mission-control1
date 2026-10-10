/** Keep automated customer copy in plain punctuation, including model-generated text. */
export function normalizeAutomatedCustomerText(text: string) {
  return text.replace(/[ \t]*[\u2014\u2013][ \t]*/g, ', ')
}
