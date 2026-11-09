export function xml(value:string) { return value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;') }
export function voiceResponse(body:string) { return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`,{headers:{'Content-Type':'text/xml'}}) }
export function operationsCallbacks(origin:string,phone:string,direction:string,callSid:string) {
  const query = new URLSearchParams({phone,direction,callSid}).toString()
  return { status:`${origin}/api/sales/operations/call-status?${query}`,recording:`${origin}/api/sales/operations/recording-callback?${query}` }
}
export function recordingAttributes(url:string) { return `record="record-from-answer" trim="do-not-trim" recordingStatusCallback="${xml(url)}" recordingStatusCallbackMethod="POST" recordingStatusCallbackEvent="completed"` }
