# Saturn Sales Phone Map

Date: 2026-04-21

## Live Number Directory

- `226-773-2993` — Windsor / central sales tower / direct mail tracking line
- `226-242-3319` — Kitchener / Waterloo branch line
- `226-605-5767` — Kitchener / Waterloo branch line
- `613-519-3236` — Ottawa branch line
- `548-488-3245` — London branch line

## Operational Notes

- `226-773-2993` stays the default Saturn Star fallback number for the dialer, quotes, and central follow-up messaging.
- For attribution, `226-773-2993` should be treated as the `direct_mail` tracking number.
- This does not change routing. Calls and SMS still flow through Twilio and Mission Control first, then continue through the existing forwarding pipeline.
- Branch routing remains:
  - Windsor operations label for `226-773-2993`
  - Waterloo operations label for both Kitchener numbers
  - Ottawa operations label for the Ottawa number
  - London operations label for the London number

## Product Intent

- Keep `branch` and `tracking source` separate.
- Example:
  - `226-773-2993` = branch `Windsor`
  - `226-773-2993` = tracking source `Direct Mail`
- This lets the UI and reporting show both:
  - who handled the line operationally
  - why that number was published in the first place
