# Subcontractor dispatch rollout

## Release order

1. Apply `20260728170000_subcontractor_offer_portal.sql` on databases that do not yet have the three subcontractor tables.
2. Apply `20260811090000_subcontractor_offer_workflow_upgrade.sql` in every environment. It is safe after either the original or expanded portal migration.
3. Apply `20260811100000_partner_operations_communications.sql` and `20260811110000_partner_organization_foundation.sql`.
4. Deploy the application and confirm `/sales/contractors` and `/sales/partner-operations` are visible to owner, manager, and operations-lead accounts.
5. Configure Twilio webhook `+1 226-774-6581` to `/api/sales/operations/sms` and verify signature validation through the production hostname.
6. Add one internal test contractor with controlled phone/email values and verified insurance.
7. Open a booked, deposit-paid job in Operations, choose **Offer to contractors**, and send a low-risk test offer.
8. Verify offer responses, award, crew briefing, portal chat, inbound/outbound Operations SMS, field reports, change-order creation, acknowledgements, cancellation, assignment, and ledger creation before adding the production partner pool.

## Operating rules

- Offers disclose cities and scope only. Full addresses and customer details are sent only through the post-award crew dispatch packet.
- Inactive, blocked, out-of-territory, under-capacity, truck-mismatched, skill-mismatched, and uninsured contractors cannot receive offers.
- Use first-acceptance for ordinary work and manual selection for specialty or high-payout jobs.
- Correct `send_failed` recipients before resending. A policy-blocked SMS is treated as a failed delivery.
- Cancelling an offer prevents all later acceptance attempts.

## Initial metrics

Review weekly: offers sent, delivery failures, median response time, acceptance rate, no-response rate, declines, cancellations, awarded payout, completion rate, and contractor issues. The directory already stores completed/cancelled counts and average rating for the later ranking feedback loop.
