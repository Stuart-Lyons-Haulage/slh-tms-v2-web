# SLH TMS V2 desktop host

This folder hosts the existing V2 web application inside Electron. It does not contain a second TMS UI or a second API contract.

## Development on Windows

Run the V2 web app in one PowerShell window:

```powershell
pnpm install
pnpm dev
```

Then run the desktop host in a second PowerShell window:

```powershell
cd desktop
npm install
npm start
```

The development host connects to `http://localhost:5173`.

To point the desktop host at another V2 server for a test session:

```powershell
$env:SLH_TMS_URL = 'https://your-v2-server/'
npm start
```

The environment variable applies only to that PowerShell session.

## Design rules

- The React application in `src/` remains the single UI codebase.
- The .NET V2 API remains the single API contract.
- Microsoft Entra remains the identity provider.
- Node integration is disabled in the renderer.
- Context isolation and Electron sandboxing remain enabled.
- Desktop-only capabilities are exposed through `preload.cjs`.
- Provider credentials, SQL credentials and Microsoft secrets must never be stored in the desktop application.
- Production server discovery and installer/update delivery will be added after the development shell and authentication path have been verified.
