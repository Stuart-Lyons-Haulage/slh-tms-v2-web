import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MsalProvider } from '@azure/msal-react';
import { PublicClientApplication } from '@azure/msal-browser';
import { App } from './App';
import { E2eHarness } from './E2eHarness';
import { DataIntegrityBoundary } from './components/DataIntegrityBoundary';
import { DispatchCalculatedStartsPortal } from './pages/DispatchCalculatedStartsPortal';
import { cacheLocationForRoute, isPublicTvLink, isTvRoute } from './tvBootstrap';
import { installOperationalUiEnhancements } from './operationalUiEnhancements';
import { installPollingPolicy } from './lib/pollingPolicy';
import { installPerformanceTelemetry } from './lib/performanceTelemetry';
import './styles.css';
import './orders.css';
import './fuel-top.css';
import './management.css';
import './operational-status.css';
import './navigation-scroll.css';
import './intelligence.css';
import './dashboard-command.css';
import './mobile.css';
import './ops-cleanup.css';
import './mobile-v2.css';
import './mobile-planner.css';
import './mobile-operations.css';
import './master-fleet.css';
import './live-vehicle-popup.css';
import './operations-housekeeping.css';
import './pallet-control.css';
import './source-email-evidence.css';
import './ui-navigation-refresh.css';
import './table-header-viewport-fix.css';
import './driver-timesheets.css';

installPollingPolicy();
installPerformanceTelemetry();

if (window.location.pathname === '/' || window.location.pathname === '/tracking' || window.location.pathname === '/planner') {
  void import('azure-maps-control/dist/atlas.min.css');
}
installOperationalUiEnhancements();

const clientId = import.meta.env.VITE_ENTRA_CLIENT_ID;
const tenantId = import.meta.env.VITE_ENTRA_TENANT_ID;
const e2eAuth = import.meta.env.VITE_E2E_AUTH === 'true';
const localTestMode = import.meta.env.VITE_LOCAL_TEST_MODE === 'true';
const isTvRoutePath = isTvRoute(window.location.pathname);
const publicTvLink = isPublicTvLink(window.location.pathname, window.location.search);
const msal = new PublicClientApplication({ auth: { clientId: clientId || '00000000-0000-0000-0000-000000000000', authority: `https://login.microsoftonline.com/${tenantId || 'common'}`, redirectUri: window.location.origin }, cache: { cacheLocation: cacheLocationForRoute(window.location.pathname) } });

function installLocalTestBanner() {
  if (!localTestMode || document.getElementById('slh-local-test-banner')) return;
  document.documentElement.style.setProperty('--slh-local-test-banner-height', '38px');
  document.body.style.paddingTop = '38px';
  const banner = document.createElement('div');
  banner.id = 'slh-local-test-banner';
  banner.textContent = 'SLH TMS LOCAL TEST SYSTEM — NO PRODUCTION WRITES';
  Object.assign(banner.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    right: '0',
    height: '38px',
    zIndex: '2147483647',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'Arial, sans-serif',
    fontSize: '14px',
    fontWeight: '800',
    letterSpacing: '0.04em',
    background: '#fff3cd',
    color: '#5f4500',
    borderBottom: '1px solid #d9b650'
  });
  document.body.appendChild(banner);
}

function renderApp() {
  const root = document.getElementById('root');
  if (!root) throw new Error('TMS root element is missing.');
  const content = e2eAuth ? <E2eHarness /> : <><App /><DispatchCalculatedStartsPortal /></>;
  createRoot(root).render(<StrictMode><MsalProvider instance={msal}><DataIntegrityBoundary>{content}</DataIntegrityBoundary></MsalProvider></StrictMode>);
  installLocalTestBanner();
}

function showStartupFailure(error: unknown) {
  console.error('TMS startup failed', error);
  const root = document.getElementById('root');
  if (!root) return;
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  root.innerHTML = `<main style="font-family:Arial,sans-serif;padding:32px;background:#f7f8fa;min-height:100vh;color:#172033"><section style="max-width:760px;margin:40px auto;background:white;border:1px solid #d7dde5;border-radius:12px;padding:28px"><p style="font-weight:700">SLH OPERATIONS WALLBOARD</p><h1>TV wallboard could not start</h1><p>The display has not lost its planning data. Reload this page once. If the message remains, report the detail below.</p><pre style="white-space:pre-wrap;overflow-wrap:anywhere;background:#f2f4f7;padding:14px;border-radius:8px">${detail.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre></section></main>`;
}

async function start() {
  try {
    if (localTestMode) { renderApp(); return; }
    if (e2eAuth) { renderApp(); return; }
    if (isTvRoutePath && (window as Window & { __SLH_TV_COMPATIBILITY__?: boolean }).__SLH_TV_COMPATIBILITY__) return;
    if (isTvRoutePath) (window as Window & { __SLH_TV_REACT_STARTED__?: boolean }).__SLH_TV_REACT_STARTED__ = true;
    if (publicTvLink) { renderApp(); void msal.initialize().catch(error => console.warn('MSAL unavailable in keyed TV mode; continuing with TV-key access.', error)); return; }
    await msal.initialize();
    let redirect;
    try { redirect = await msal.handleRedirectPromise(); } catch (error) { console.error('Microsoft sign-in callback failed', error); }
    const account = redirect?.account || msal.getAllAccounts()[0];
    if (account) msal.setActiveAccount(account);
    renderApp();
  } catch (error) { showStartupFailure(error); }
}

void start();
