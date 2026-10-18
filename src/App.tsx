import { Component, lazy, Suspense, type ErrorInfo, type ReactNode, useEffect, useState } from 'react';
import { useIsAuthenticated, useMsal } from '@azure/msal-react';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';

const PlannerEnhanced = lazy(() => import('./pages/PlannerEnhanced').then(module => ({ default: module.PlannerEnhanced })));
const PalletPlanningControl = lazy(() => import('./pages/PalletPlanningControl').then(module => ({ default: module.PalletPlanningControl })));
const MasterDataHub = lazy(() => import('./pages/MasterDataHub').then(module => ({ default: module.MasterDataHub })));
const DashboardOperational = lazy(() => import('./pages/DashboardOperational').then(module => ({ default: module.DashboardOperational })));
const DailyCompliance = lazy(() => import('./pages/DailyCompliance').then(module => ({ default: module.DailyCompliance })));
const JobInvoiceHistory = lazy(() => import('./pages/JobInvoiceHistory').then(module => ({ default: module.JobInvoiceHistory })));
const StagingQueue = lazy(() => import('./pages/Pages').then(module => ({ default: module.StagingQueue })));
const OrderControl = lazy(() => import('./pages/OrderControl').then(module => ({ default: module.OrderControl })));
const DriverDispatchOperational = lazy(() => import('./pages/DriverDispatchOperational').then(module => ({ default: module.DriverDispatchOperational })));
const Staffing = lazy(() => import('./pages/Staffing').then(module => ({ default: module.Staffing })));
const AdminIntegrationSyncControls = lazy(() => import('./components/AdminIntegrationSyncControls').then(module => ({ default: module.AdminIntegrationSyncControls })));
const OrderIntakeMappingAdmin = lazy(() => import('./pages/OrderIntakeMappingAdmin').then(module => ({ default: module.OrderIntakeMappingAdmin })));
const MobileOperations = lazy(() => import('./pages/MobileOperations').then(module => ({ default: module.MobileOperations })));
const CustomerComms = lazy(() => import('./pages/CustomerComms').then(module => ({ default: module.CustomerComms })));
const WarehousePlanning = lazy(() => import('./pages/WarehousePlanning').then(module => ({ default: module.WarehousePlanning })));

import { apiScope, localTestAuthEnabled, useAccessToken } from './lib/auth';
import { request } from './lib/api';
import { connectPlanningEventStream } from './lib/planningEvents';
import { isDesktopApp } from './lib/desktop';
import { HeaderIntelligence } from './components/HeaderIntelligence';
import { MobileDock } from './components/MobileDock';
import { WorkingDateControl } from './components/WorkingDateControl';
import { setWorkingDate } from './lib/workingDate';

type NavItem = [string, string];
type NavGroup = { label: string; items: NavItem[] };

/** Daily screens, in the order the day runs: orders in, plan, dispatch, execute, people. */
const coreNavigation: NavItem[] = [
  ['/dashboard', 'Today'],
  ['/staging', 'Orders'],
  ['/', 'Planner'],
  ['/pallet-control', 'Pallet Order'],
  ['/driver-dispatch', 'Dispatch'],
  ['/warehouse', 'Warehouse'],
  ['/customer-comms', 'Customer Comms'],
  ['/staffing', 'Drivers'],
];

const navigationGroups: NavGroup[] = [
  { label: 'Compliance & Accounts', items: [
    ['/compliance', 'Vehicle checks'],
    ['/night-outs', 'Job history & invoicing'],
  ] },
  { label: 'Settings', items: [
    ['/master-data', 'Master data'],
    ['/admin/order-intake', 'Order intake'],
    ['/admin/integrations', 'System health'],
    ['/admin/imports', 'Imports'],
  ] },
];

function pathActive(current: string, path: string) {
  return path === '/' ? current === '/' : current === path || current.startsWith(`${path}/`);
}

function NavGroupMenu({ group, current }: { group: NavGroup; current: string }) {
  const active = group.items.some(([path]) => pathActive(current, path));
  return <details className={`top-nav-group ${active ? 'active' : ''}`}>
    <summary>{group.label}<span aria-hidden="true">⌄</span></summary>
    <div className="top-nav-menu">
      {group.items.map(([path, label]) => <NavLink key={path} to={path} onClick={event => event.currentTarget.closest('details')?.removeAttribute('open')}>{label}</NavLink>)}
    </div>
  </details>;
}

/** Keeps the shared working date in step with any ?date= link (e.g. from Today). */
function WorkingDateFromUrl() {
  const location = useLocation();
  useEffect(() => {
    const date = new URLSearchParams(location.search).get('date');
    if (date) setWorkingDate(date);
  }, [location.search]);
  return null;
}

function Shell() {
  const entraAuthenticated = useIsAuthenticated();
  const { instance, accounts } = useMsal();
  const accessToken = useAccessToken();
  const authenticated = localTestAuthEnabled || entraAuthenticated;
  const [open, setOpen] = useState(false);
  const [pendingOrderReviews, setPendingOrderReviews] = useState(0);
  const [pendingOrderReviewDates, setPendingOrderReviewDates] = useState('');
  const location = useLocation();
  const activeAccount = instance.getActiveAccount() || accounts[0];

  const signIn = async () => {
    const request = { scopes: apiScope ? [apiScope] : [] };
    if (!isDesktopApp()) {
      await instance.loginRedirect(request);
      return;
    }
    const result = await instance.loginPopup(request);
    if (result.account) instance.setActiveAccount(result.account);
  };

  const signOut = async () => {
    if (!isDesktopApp()) {
      await instance.logoutRedirect({ account: activeAccount });
      return;
    }
    await instance.logoutPopup({ account: activeAccount });
  };

  useEffect(() => { setOpen(false); }, [location.pathname]);

  useEffect(() => {
    if (!authenticated) return;
    const disconnect = connectPlanningEventStream(accessToken, {
      onAuthenticationRequired: error => {
        console.warn('Microsoft authentication is required for planning updates.', error);
      },
    });
    return disconnect;
  }, [accessToken, authenticated]);

  useEffect(() => {
    if (!authenticated) {
      setPendingOrderReviews(0);
      setPendingOrderReviewDates('');
      return;
    }

    let stopped = false;
    // Counts only (a few bytes) rather than downloading the waiting orders themselves.
    const refreshPendingOrderReviews = async () => {
      try {
        const today = new Date();
        const iso = (offset: number) => new Date(today.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
        const counts = await request<Record<string, number>>(`/api/v1/staging/queue/date-counts?from=${iso(-7)}&to=${iso(14)}`, await accessToken());
        if (stopped) return;
        const entries = Object.entries(counts).filter(([, count]) => count > 0).sort(([left], [right]) => left.localeCompare(right));
        setPendingOrderReviews(entries.reduce((sum, [, count]) => sum + count, 0));
        setPendingOrderReviewDates(entries
          .map(([date, count]) => `${new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' }).format(new Date(`${date}T12:00:00`))}: ${count}`)
          .join(' · '));
      } catch (error) {
        console.warn('Pending order review count could not be refreshed.', error);
      }
    };

    void refreshPendingOrderReviews();
    const interval = window.setInterval(() => void refreshPendingOrderReviews(), 60000);
    const onFocus = () => void refreshPendingOrderReviews();
    window.addEventListener('focus', onFocus);

    return () => {
      stopped = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [accessToken, authenticated]);

  const loadingContent = <section className="sign-in-panel" aria-live="polite"><p className="eyebrow">Loading</p><h1>Opening TMS screen…</h1></section>;

  return <div className={`app-shell ${authenticated ? 'with-system-strip top-navigation-shell' : ''}`}>
    <header className="top-app-header">
      <button className="menu" onClick={() => setOpen(!open)} aria-label="Toggle navigation" aria-expanded={open}>☰</button>
      <NavLink className="brand" to="/dashboard"><span>SLH</span><small>Transport management</small></NavLink>
      <div className="header-context">{authenticated ? <WorkingDateControl /> : <b>Daily transport control</b>}</div>
      <div className="header-actions">
        {authenticated
          ? <><span className="user">{activeAccount?.name || activeAccount?.username || 'Microsoft user'}</span><button onClick={() => void signOut()}>Sign out</button></>
          : <button className="primary" onClick={() => void signIn()} disabled={!apiScope}>Sign in with Microsoft</button>}
      </div>
    </header>

    {authenticated && <nav className={`top-navigation ${open ? 'mobile-open' : ''}`} aria-label="Primary TMS navigation">
      {coreNavigation.map(([path, label]) => {
        const hasPendingOrders = path === '/staging' && pendingOrderReviews > 0;
        const pendingLabel = pendingOrderReviews >= 200 ? '200+' : String(pendingOrderReviews);
        return <NavLink
          key={path}
          className={`top-nav-direct${hasPendingOrders ? ' orders-attention' : ''}`}
          to={path}
          end={path === '/'}
          aria-label={hasPendingOrders ? `${label}, ${pendingLabel} waiting for review` : label}
          title={hasPendingOrders ? `${pendingLabel} order${pendingOrderReviews === 1 ? '' : 's'} waiting for review${pendingOrderReviewDates ? ` · ${pendingOrderReviewDates}` : ''}` : undefined}
        >
          <span>{label}</span>
          {hasPendingOrders && <span className="nav-order-review-count" aria-hidden="true">{pendingLabel}</span>}
        </NavLink>;
      })}
      {navigationGroups.map(group => <NavGroupMenu key={group.label} group={group} current={location.pathname} />)}
    </nav>}

    {authenticated && <WorkingDateFromUrl />}
    {authenticated && <div className="system-strip"><HeaderIntelligence /></div>}

    <main>
      {authenticated ? <Suspense fallback={loadingContent}><RouteErrorBoundary key={location.pathname}><Routes>
        <Route path="/" element={<PlannerEnhanced />} />
        <Route path="/dashboard" element={<DashboardOperational />} />
        <Route path="/mobile" element={<MobileOperations />} />
        <Route path="/orders" element={<Navigate to="/staging?tab=add" replace />} />
        <Route path="/staging" element={<OrderControl />} />
        <Route path="/pallet-control" element={<PalletPlanningControl />} />
        <Route path="/bookings" element={<Navigate to="/pallet-control?tab=southbound" replace />} />
        <Route path="/driver-dispatch" element={<DriverDispatchOperational />} />
        <Route path="/customer-comms" element={<CustomerComms />} />
        <Route path="/warehouse" element={<WarehousePlanning />} />
        <Route path="/staffing" element={<Staffing />} />
        <Route path="/master-data" element={<MasterDataHub />} />
        <Route path="/drivers" element={<MasterDataHub initialSection="drivers" />} />
        <Route path="/fleet-assets" element={<MasterDataHub initialSection="vehicles" />} />
        <Route path="/fuel-cards" element={<MasterDataHub initialSection="fuel-cards" />} />
        <Route path="/customers" element={<MasterDataHub initialSection="customers" />} />
        <Route path="/sites" element={<MasterDataHub initialSection="sites" />} />
        <Route path="/markets" element={<MasterDataHub initialSection="markets" />} />
        <Route path="/fuel" element={<MasterDataHub initialSection="fuel-prices" />} />
        <Route path="/compliance" element={<DailyCompliance />} />
        <Route path="/night-outs" element={<JobInvoiceHistory />} />
        <Route path="/driver-assignments" element={<Navigate to="/staffing?tab=history" replace />} />
        <Route path="/driver-timesheets" element={<Navigate to="/staffing?tab=timesheets" replace />} />
        <Route path="/admin" element={<Navigate to="/admin/integrations" replace />} />
        <Route path="/admin/imports" element={<StagingQueue masterOnly />} />
        <Route path="/admin/integrations" element={<AdminIntegrationSyncControls />} />
        <Route path="/admin/order-intake" element={<OrderIntakeMappingAdmin />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes></RouteErrorBoundary></Suspense> : <section className="sign-in-panel">
        <p className="eyebrow">Secure operations portal</p>
        <h1>Sign in to Stuart Lyons Haulage TMS</h1>
        <p>Use your Lyons Microsoft account to open planning, master data and compliance.</p>
        <button className="primary" onClick={() => void signIn()} disabled={!apiScope}>Sign in with Microsoft</button>
      </section>}
    </main>

    {authenticated && <MobileDock openMenu={() => setOpen(true)} />}
  </div>;
}

type RouteErrorBoundaryState = { error?: Error };

class RouteErrorBoundary extends Component<{ children: ReactNode }, RouteErrorBoundaryState> {
  state: RouteErrorBoundaryState = {};
  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('TMS route failed', error, info); }
  render() {
    if (!this.state.error) return this.props.children;
    const error = this.state.error;
    return <section className="sign-in-panel">
      <p className="eyebrow">Application recovery</p>
      <h1>This screen hit an application error</h1>
      <p>The navigation shell is still available and you have not been signed out.</p>
      <div style={{ width: '100%', maxWidth: 900, textAlign: 'left', margin: '16px 0', padding: 16, border: '1px solid #d0d7de', borderRadius: 8, background: '#fff' }}>
        <strong>Error detail</strong>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginTop: 8 }}>{error.name}: {error.message}</pre>
      </div>
      <button className="primary" onClick={() => window.location.reload()}>Refresh screen</button>
    </section>;
  }
}

export function App() {
  return <BrowserRouter><Shell /></BrowserRouter>;
}
