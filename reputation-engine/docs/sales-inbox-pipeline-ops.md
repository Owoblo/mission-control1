# Sales Inbox, Pipeline, and Rep Access Notes

Date: 2026-04-21

## Recommended Inbox Model

- Treat `Lead Inbox` as the live communications queue for new or active inbound activity.
- Inbox should emphasize:
  - new inbound calls
  - missed calls
  - new inbound SMS
  - new inbound email replies
  - unclaimed or freshly active conversations
- Once a lead is claimed or already owned, the inbox should still show the latest inbound activity, but it should not become the only place a rep can continue the conversation.

## Recommended Pipeline Model

- The pipeline should remain the operating workspace for the lead lifecycle.
- Reps should be able to open any lead from the pipeline and continue:
  - SMS
  - email
  - call logging
  - estimate work
  - follow-up scheduling
- The lead page should show the conversation context clearly enough that a rep does not need to bounce back to Inbox just to continue a thread.

## Suggested Division of Responsibility

- `Inbox` = triage, alerts, newest inbound activity, unworked communication.
- `Lead page` = full working file for that customer.
- `Pipeline` = stage management and workload prioritization.

## UI Recommendation For Message Visibility

- On the lead timeline:
  - keep a living log of every important event
  - include short SMS and email previews instead of only `SMS sent`
  - avoid dumping full message bodies inline unless expanded
- On the lead page:
  - keep full SMS thread in the SMS tab
  - keep full email thread in the Email tab
  - keep timeline entries concise and scannable

## Notification Recommendation

- Add visible unread indicators in three places:
  - Inbox rows
  - pipeline cards
  - lead page tabs for SMS and Email
- Badge logic should prioritize inbound unread activity, not just message counts.

## Email Recommendation

- Email should be treated like SMS:
  - outbound message logged
  - inbound reply captured
  - thread shown on the lead page
- The key check is not only “did we send email?” but also “did a reply come back and get attached to the correct lead?”

## SMS UI Recommendation

- Match the visual language of the main Inbox more closely.
- Current recommendation:
  - lighter surfaces
  - clearer unread distinction
  - branch identity visible near outbound messages
  - less visually heavy dark-message treatment

## Branch + Conversation Recommendation

- Branch identity should stay obvious everywhere:
  - inbox row
  - lead page
  - SMS thread
  - call logs
  - estimate context
- Outbound replies should continue using the same branch number the customer contacted.

## Rep Access Recommendation

- `owner`
  - full visibility
  - user management
  - pricing oversight
  - audit visibility
  - automation controls
- `manager`
  - can see all leads, all estimates, all communications
  - can reassign leads
  - can audit rep behavior
  - can review pricing decisions
- `sales_rep`
  - can work leads, quotes, SMS, email, and calls
  - should usually see the broader pipeline
  - should not manage users or core system settings
  - should not silently rewrite historic audit data
- `crew`
  - no CRM sales access
  - job execution only

## Visibility Recommendation For Reps

- Reps should generally be able to view other reps’ work.
- Reason:
  - quoting consistency
  - easier handoff
  - easier coaching
  - easier auditing
- Restrict editing rights before restricting visibility.

## Audit Recommendation

- Track at minimum:
  - who sent each SMS
  - who sent each email
  - who changed stage
  - who changed quote totals
  - who applied discounts or overrides
  - who confirmed booking
- Discount and override actions should be especially visible in audit logs.

## Workflow Recommendation

- Best default:
  1. inbound activity lands in Inbox
  2. rep opens or claims lead
  3. active work continues on the lead page
  4. pipeline reflects stage and follow-up state
  5. inbox continues to surface fresh inbound messages and missed calls

## Open Product Decisions

- Should claimed leads disappear from Inbox entirely, or remain visible while they still have unread inbound activity?
- Should pipeline cards show the last inbound message preview, or only an unread badge?
- Should every sales rep be able to edit every quote, or only view others’ quotes unless reassigned?

## Current Direction

- Recommended default:
  - Inbox stays as the live triage queue.
  - Lead page becomes the place where conversations continue.
  - Pipeline stays focused on stage, workload, and follow-up.
