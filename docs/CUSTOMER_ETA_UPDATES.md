# Customer ETA updates

## What is live in the portal

- A planner selects a driver and vehicle against a load; the approved driver mobile is shown immediately and is included at the top of the MightyText handoff.
- `Master data & CRM` holds customer ETA contacts against a customer code. New contacts go through the staging review queue before they are available.
- `Exports` provides a **Customer ETA update** CSV with customer, order, load, vehicle, driver, delivery stop, planned delivery window, planned ETA and a clear status.

## Sending customers automatically

Use the Customer ETA CSV as the controlled operational export until the customer-contact list is populated and approved. To automate email distribution, create a Power Automate scheduled cloud flow that:

1. Runs at the chosen customer-update times.
2. Retrieves the approved customer ETA export or its equivalent API data.
3. Matches each row to an active customer contact whose ETA updates are enabled.
4. Sends only that customer's rows to its approved email address.
5. Includes load reference, vehicle registration, driver, delivery window, planned ETA and status in the message.
6. Records the flow run and any failed recipients for the operations team to review.

Do not add personal email addresses to a flow until the contact has been approved in the portal. The portal deliberately does not send customer emails directly from the browser.

## Current ETA meaning

The CSV and dashboard use the planned stop ETA currently saved against the load. Once the DOT tracking feed is connected and returning live positions, the next integration step is to replace or supplement this with an actual vehicle-position ETA.
