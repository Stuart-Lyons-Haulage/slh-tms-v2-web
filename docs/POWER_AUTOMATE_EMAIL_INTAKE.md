# Email Order Intake

Production customer-order intake is owned by the Info mailbox Power Automate flow and the TMS order-intake API. The flow must submit the original email evidence to `POST /api/v1/order-intake/email`; it must not create planning orders directly. Pending Review remains the operational control gate before an order reaches Planner.

## Mailboxes

Monitor both sources while `info@lyonshaulage.com` is distributed into personal mailboxes:

1. The `info@lyonshaulage.com` shared mailbox, where available.
2. The authorised personal Inbox receiving the distribution-rule copy.

Accept messages where `info@lyonshaulage.com` is present through To, CC or distribution-group expansion. Use the Outlook message ID as the idempotent source identity so the same message received through both routes cannot create duplicate orders.

## Required flow sequence

1. Trigger when a new email arrives.
2. Capture message ID, Internet Message ID, conversation ID, sender, sender name, subject, received time, web link, To, CC, body HTML/text and mailbox source.
3. List every attachment. Do not discard `.xls`, `.xlsx` or `.xlsm` files.
4. For every normal file attachment, call **Get attachment content** and send its Base64 content to the TMS. Attachment name or metadata alone is not sufficient.
5. Exclude true inline signature images from transport-document parsing but retain their metadata if required for audit.
6. Preserve SharePoint/OneDrive reference attachment links. Reference attachments cannot be treated as normal Outlook file attachments and must be resolved asynchronously before intake if they contain the order document.
7. Submit the complete email once to `POST /api/v1/order-intake/email`. The TMS is responsible for parsing workbook rows, body tables, duplicate/version handling and creating Pending Review records.
8. Apply the category returned by the API: `TMS Imported` for successfully staged orders and `TMS Review` for mapping exceptions.
9. Do not parse workbook rows inside Power Automate and do not call `/api/v1/staging` once per spreadsheet row. Workbook interpretation is authoritative in the API so stale tabs, date validation and customer-specific formats are handled consistently.

## Attachment object contract

Each normal file attachment sent in the request must include at minimum:

```json
{
  "name": "Morrisons Aldi Bookings 29.08.2026.xlsm",
  "contentType": "application/vnd.ms-excel.sheet.macroenabled.12",
  "size": 59042,
  "isInline": false,
  "contentBase64": "<Get attachment content output>"
}
```

Legacy `.xls` files such as Vitacress `Collections WAITROSE.xls` must follow the same path. Do not restrict the content action to `.xlsx` only.

## Request path

```text
info@ / personal distribution copy
        -> Power Automate
        -> GET attachment content for each file
        -> POST /api/v1/order-intake/email
        -> Pending Review
        -> Review Orders
        -> approval
        -> Planner
```

## Date authority

Power Automate must pass source dates without attempting to rewrite workbook dates. The TMS validates workbook dates against the email subject, attachment name and message planning date. Historical worksheets inside a current workbook are deliberately excluded when they materially conflict with the current planning date.

## Duplicate and amendment handling

Always send the original Outlook message ID and Internet Message ID. Do not generate a new flow-level row identity. The TMS uses the source message plus parsed order identity to keep retries idempotent and to supersede older pending versions where appropriate.

## Failure handling

If attachment content retrieval times out or fails, do not submit a metadata-only version as though parsing succeeded. Route the message to an asynchronous attachment-retry child flow or queue and only submit once the required document content is available. If the email itself genuinely lacks sufficient transport information, allow the TMS to create a `TMS Review` mapping exception rather than silently dropping it.
