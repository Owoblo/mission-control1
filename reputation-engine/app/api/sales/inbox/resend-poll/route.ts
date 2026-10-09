export async function POST() {
  return Response.json({ error: 'Retired. Incoming CRM replies are received through SES.' }, { status: 410 })
}
export const GET = POST
