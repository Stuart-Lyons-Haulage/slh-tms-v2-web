# SLH TMS V2 standalone runtime

This is the clean local-server deployment path for V2. The live TMS, API and SQL database stay on the SLH server. Remote office access is provided without a VPN and without reopening the old Azure hosting stack.

## Runtime layout

```text
Office Microsoft account
        |
 Microsoft Entra ID
        |
   HTTPS public URL
        |
 Cloudflare Tunnel
 (outbound from SLH)
        |
   SLH Web / PWA
        |
     SLH API
        |
  Local SQL Server
```

- Web: V2 React portal and SLH Mobile PWA
- API: V2 .NET API
- SQL: local SQL Server database `SLH_TMS_V2`
- Authentication: Microsoft Entra only for Lyons office accounts
- Remote access: optional Cloudflare Tunnel using an outbound-only connection
- Secrets: runtime environment variables only
- Archive: optional mounted SLH server path

No individual TMS username/password is required or supported by the normal standalone deployment.

## Why the tunnel is used

The tunnel publishes only the web entry point. It does **not** provide remote users with network or VPN access to the SLH LAN.

The recommended production shape is:

- no router port-forwarding;
- no inbound firewall rule for the TMS;
- SQL remains private inside Docker;
- API remains private inside Docker and is reached through the web reverse proxy at `/tms-api`;
- the public hostname terminates at the tunnel;
- the application itself still requires a valid Lyons Microsoft Entra sign-in.

The host HTTP port binds to `127.0.0.1` by default. Set `TMS_BIND_ADDRESS=0.0.0.0` only if direct LAN access is deliberately required.

## Repository layout

Clone the canonical repositories as siblings:

```text
parent/
  slh-tms-v2-web/
  slh-tms-v2-api/
```

The start scripts accept either `API` or `slh-tms-v2-api` as the API sibling folder.

## First-time server setup

From the V2 Web repository on the SLH server:

**Windows / PowerShell**

```powershell
.\deploy\standalone\setup-server.ps1
```

**Linux**

```bash
bash deploy/standalone/setup-server.sh
```

The setup creates `.env.standalone` and generates the SQL password. It does not create a TMS user.

Populate these Microsoft values before starting:

```text
ENTRA_TENANT_ID=
ENTRA_WEB_CLIENT_ID=
ENTRA_API_AUDIENCE=api://<api-client-id>
ENTRA_API_SCOPE=api://<api-client-id>/Tms.Access
```

The Entra web app registration must contain the public SLH URL as a **Single-page application redirect URI**, for example:

```text
https://tms.example-company-domain.co.uk/
```

Because MSAL uses the current browser origin as the redirect URI, the registered value must exactly match the deployed HTTPS origin.

## Secure remote access

Create a named Cloudflare Tunnel and configure one public hostname to target:

```text
http://web:80
```

The hostname should be dedicated to the TMS, for example `tms.<company-domain>`.

Put the generated tunnel token only in the server's `.env.standalone`:

```text
COMPOSE_PROFILES=remote
CLOUDFLARE_TUNNEL_TOKEN=<secret token>
TMS_PUBLIC_URL=https://tms.<company-domain>
```

Do not commit the token.

The Docker `tunnel` service is disabled unless `COMPOSE_PROFILES=remote` is set.

## Start/update

**Windows**

```powershell
.\deploy\standalone\start-server.ps1
```

**Linux**

```bash
bash deploy/standalone/start-server.sh
```

The start script:

1. updates both canonical repositories from `main`;
2. refuses to start if the required Entra values are missing;
3. validates the tunnel token/public URL when the remote profile is enabled;
4. validates Docker Compose;
5. builds and starts the local stack;
6. checks the API health endpoint;
7. reports the local and public portal URLs.

## Mobile use

The installed PWA starts at:

```text
/mobile
```

Office users sign in with the same Microsoft account they use for Microsoft 365. The mobile interface provides driver/vehicle/run lookups, tracking, quick allocation changes and audited fuel PIN access.

## Security boundaries

- Do not expose SQL port 1433 externally.
- Do not expose the API container directly to the internet.
- Do not add router port forwarding for the TMS when the tunnel is enabled.
- Keep `.env.standalone` outside Git.
- Fuel PINs are requested through a restricted API call and are not included in the normal mobile snapshot.
- All write actions remain subject to the API's Entra policies and existing allocation/compliance rules.

## Archive safety

The API will not purge database rows merely because `ARCHIVE_ENABLED=true`.

The mounted archive root must contain:

```text
SLH_TMS_ARCHIVE_READY.txt
```

Create that marker only after the real archive mount has been verified. Each archive batch is written and verified before the corresponding SQL rows are removed.

## Clean database rule

Never restore the historic V1/Azure production database into this runtime. V2 should use the clean local database and explicitly reconciled/imported master data.
