# Order intake automation authority

Production customer-order intake is owned by the Info mailbox Power Automate flow and the TMS staging/review workflow.

Authoritative path:

`info@lyonshaulage.com -> Power Automate -> POST /api/v1/order-intake/email -> PendingReview -> Review orders -> approval -> Planner`

The web application must not read the SharePoint mailbox queue, pull mailbox messages directly with Microsoft Graph, or auto-approve staged orders. SharePoint/List based intake is legacy only and must not be reintroduced as an order-authority path.

The TMS review queue is available at `/staging` and approval remains mandatory before an order enters live planning.
