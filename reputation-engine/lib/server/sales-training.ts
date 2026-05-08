/**
 * Saturn Star Movers — Sales Process Context
 * Injected into AI intelligence prompts so coaching is calibrated to our
 * exact process, not generic sales advice.
 */

export const SATURN_STAR_SALES_PROCESS = `
## SATURN STAR SALES PROCESS

### Core Philosophy
- Customer is buying: protection, peace of mind, expertise, reliability, a binding estimate
- Rep mindset: "doctor doing a consultation" — confident, expert, not apologetic about price
- We do NOT compete on price. There will always be someone cheaper. That is not our customer.
- Golden Rule: NEVER end a call without a booking OR a tentative reservation. Every single call.

### The 8-Step Call Framework
1. WARM OPENER — thank them for calling, get them talking
2. CAPTURE INFO FIRST — name, number, email BEFORE the estimate. Always give a reason for asking.
   - Email reason: "I'm going to send you everything we discussed plus your full estimate by email"
   - Number reason: "In case we get disconnected"
   - NEVER deliver an estimate without capturing email + number first — if they hang up, you have nothing
3. MLS SCAN — "Let me pull up the listing for that address in our system." AI reads photos to measure furniture automatically. If no MLS: send photo link by text or offer video walk-through right now.
4. INVENTORY REVIEW — go through rooms out loud, confirm items. Write down anything specific they mention (piano, antique, fragile items) — use it in the close.
5. UPSELL QUESTIONS (ask all three, every call):
   - Packing: "Do you need any help packing your boxes before move day?"
   - Junk removal: "Is there anything you're leaving behind that needs to be removed?"
   - Specialty: "Any pianos, safes, large gym equipment, or anything that needs extra care?"
6. DELIVER ESTIMATE + PAINT THE FULL PICTURE — walk them through move day BEFORE the number.
   - Movers arrive 8-9am, quilt-pad and wrap every piece, disassemble bed frames, load truck, drive, unload, reassemble, place everything exactly where they want it
   - "You don't have to lift a finger. By the time they're done, you're standing in your new home with everything in place."
   - Then: binding estimate = no fuel surcharges, no stair fees, no surprises. Fully insured.
   - Then deliver the price. PAUSE. Let it land. Do not fill the silence.
   - Use what they told you: "Because you mentioned the piano, I've already built in extra time and the right equipment."
7. ROLL INTO THE RESERVATION (assume the sale — NEVER ask yes/no):
   - "Visa or Mastercard?" OR "Morning or afternoon slot?" OR "I'll send your move confirmation — what's the best email?"
   - NEVER say: "How does that sound?" / "Do you want to book?" / "What do you think?" — these create decision points
8. SEND ESTIMATE + ASK FOR DEPOSIT — 10% deposit locks in the date and price. "If anything changes, we can always adjust."

### The 5 Closing Tactics
1. TENTATIVE RESERVATION — most powerful tactic for "let me think about it"
   - No deposit, no obligation, no commitment. Just holds the date while they decide.
   - Psychology: customer now has to actively CANCEL instead of just not calling back. Most won't cancel.
   - Script: "No problem — I can set you up on a tentative reservation. No obligation, no deposit, just a courtesy hold. I just need your addresses to hold the spot."
   - Tag as Tentative in pipeline. Follow up next day — that's a CLOSE ATTEMPT, not a check-in.

2. REBUTTALS AT YOUR DESK — every objection is a request for reassurance, not a rejection
   - Keep the objection table visible during every call. Never improvise — use the prepared response.

3. ROLL INTO THE RESERVATION — remove the decision, replace it with a detail
   - Two paths, both lead to booking. Visa or Mastercard. Morning or afternoon. Never a yes/no question.

4. AUTHORITY TAKEOVER — use on jobs $1,500+ when stuck on price or after standard rebuttal hasn't moved them
   - Rep to customer: "Let me check with my manager — can I call you back in 10 minutes?"
   - John calls back: "Hi [Name], this is John, I'm the manager. [Rep] told me you're looking to move to [dest] on [date]. What's it going to take for us to earn your business today?"
   - Flag immediately in pipeline with full notes.

5. TENTATIVE TO FIRM — next-day follow-up on all tentative reservations is a CLOSE ATTEMPT
   - "Hey [Name], following up on your tentative reservation for [date] — that date is starting to fill in. Were you able to think it over?"
   - If still hesitating: offer 10% book-today discount (confirm on call only, not in writing)

### Key Objection Responses
- "Too expensive" → "That includes everything — no fuel, no stair fees, no surprises. It's a binding estimate, you'll never pay more. Cheaper movers often add on fees at the end. Are you looking for the cheapest option or the one with the most peace of mind?"
- "Let me think about it" → Ask what specifically. If still needs time: Tentative Reservation immediately.
- "Need to talk to my partner" → Send estimate now so they have numbers. Set tentative reservation. Ask when they'll decide.
- "Got a cheaper quote" → "It's not apples-to-apples — binding estimate, fully insured, trained crew. Are you looking for cheapest or most peace of mind?"
- "Can you do cheaper?" → "10% off if you confirm today — that's the only time I can offer that."
- "Not ready to book yet" → Tentative Reservation + date scarcity: "Our dates for [month] are filling up — let me at least hold the spot while you decide."
- "Three more companies to call" → Tentative Reservation so their date is held while they shop around.

### Pricing Reference
- Full move: $315/hr (4 movers) — AI-estimated hours
- Labour only: $150/hr, 3-hour minimum ($450 starting point)
- Deposit: 10% of total (locks date + price)
- Book-today discount: 10% off — ONLY offered on the call, never in writing
- Junk removal (under ~100 lbs): free on move day
- Specialty items (piano, safe): quoted separately — ask every call

### Follow-Up Cadence
- Same day (evening): SMS — "Just following up on the quote I sent you earlier. Happy to answer any questions — just reply here or give me a call."
- Day 2: CALL — if tentative reservation, this is a CLOSE ATTEMPT not a check-in. If no answer: voicemail.
- Day 4-5: SMS — "Just checking in on your move. Availability for [date] is getting tight — happy to hold your spot if you're still interested."
- Day 7+: Flag as Nurture — platform handles automated follow-up.

### Process Quality Checks (what AI should flag as missed)
- Email captured BEFORE estimate was delivered?
- Number captured before estimate?
- All three upsell questions asked (packing, junk removal, specialty)?
- Full move day picture painted before the price?
- Rep rolled into reservation (vs asked a yes/no question)?
- Tentative reservation offered when customer didn't book?
- Specific details from conversation used in the close (piano, antique, specific concern)?
- If stuck on price: Authority Takeover flagged for John?
`.trim()
