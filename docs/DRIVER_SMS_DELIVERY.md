# Driver SMS Delivery

The portal sends a driver brief only through the SLH API. It never contains an SMS credential, sender number or Azure Communication Services connection string.

## Prerequisites

1. Create an Azure Communication Services resource and obtain an SMS-enabled sender number or sender ID approved for the intended destination countries.
2. Store the Communication Services connection string as a secret on the **API Container App**, not as a GitHub variable and not as a `VITE_` value.
3. Add the following API Container App environment settings:

```text
Integrations__AzureSms__Enabled=true
Integrations__AzureSms__ConnectionString=secretref:<your-secret-name>
Integrations__AzureSms__From=+44...  # approved sender in E.164 format
```

4. Add each driver mobile number through **Master data & CRM**, using E.164 format such as `+447700900123`, then approve it in Staging.

## Operational use

1. Allocate an approved driver and vehicle to a load.
2. Check the generated brief; it includes market, seller, stall, map link and driver instructions.
3. Select **Send Azure SMS** in the Planner. The API validates the allocation, driver number and SMS configuration before it sends anything.

The API marks a planned load as dispatched only after Azure Communication Services accepts the message. Azure delivery reports remain provider-side until a delivery-report webhook is configured.

## Safety

- Do not place the connection string in browser configuration, source code, Power Automate, or email.
- Use a dedicated production sender and restrict Container App secret access.
- Retain the existing copy-to-clipboard dispatch option as a fallback when SMS delivery is disabled or unavailable.
