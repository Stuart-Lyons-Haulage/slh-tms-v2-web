import { Component, lazy, Suspense, type ErrorInfo, type ReactNode, useEffect, useState } from 'react';
import { useIsAuthenticated, useMsal } from '@azure/msal-react';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';

const PlannerEnhanced = lazy(() => import('./pages/PlannerEnhanced').then(module => ({ default: module.PlannerEnhanced })));
const PalletPlanningControl = lazy(() => import('./pages/PalletPlanningControl').then(module => ({ default: module.PalletPlanningControl })));
const MasterDataHub = lazy(() => import('./pages/MasterDataHub').then(module => ({ default: module.MasterDataHub })));
const RoadrunnerSiteReview = lazy(() => import('./pages/RoadrunnerSiteReview').then(module => ({ default: module.RoadrunnerSiteReview })));
const DashboardOperational = lazy(() => import('./pages/DashboardOperational').then(module => ({ default: module.DashboardOperational })));
const DailyCompliance = lazy(() => import('./pages/DailyCompliance').then(module => ({ default: module.DailyCompliance })));
const NightOutReport = lazy(() => import('./pages/NightOutReport').then(module => ({ default: module.NightOutReport })));
const JobInvoiceHistory = lazy(() => import('./pages/JobInvoiceHistory').then(module => ({ default: module.JobInvoiceHistory })));
const DriverAssignments = lazy(() => import('./pages/Pages').then(module => ({ default: module.DriverAssignments })));
const Orders = lazy(() => import('./pages/Pages').then(module => ({ default: module.Orders })));
const StagingQueue = lazy(() => import('./pages/Pages').then(module => ({ default: module.StagingQueue })));
const DriverDispatchOperational = lazy(() => import('./pages/DriverDispatchOperational').then(module => ({ default: module.DriverDispatchOperational })));
const UserManagement = lazy(() => import('./pages/UserManagement').then(module => ({ default: module.UserManagement })));
const AdminIntegrationSyncControls = lazy(() => import('./components/AdminIntegrationSyncControls').then(module => ({ default: module.AdminIntegrationSyncControls })));

import { apiScope, getLocalAuthSession, localAuthEnabled, localLogin, localLogout, useAccessToken, type LocalAuthSession } from './lib/auth';
import { api } from './lib/api';
import { connectPlanningEventStream } from './lib/planningEvents';
import { isDesktopApp } from './lib/desktop';
import { HeaderIntelligence } from './components/HeaderIntelligence';
import { MobileDock } from './components/MobileDock';

type NavItem = [string, string];

const coreNavigation: NavItem[] = [
  ['/dashboard', 'Dashboard'],
  ['/orders', 'Order Entry'],
  ['/staging', 'Orders'],
  ['/', 'Planner Builder'],
  ['/pallet-control', 'Pallet Order'],
  ['/driver-dispatch', 'Driver Dispatch'],
  ['/master-data', 'Master Data'],
  ['/night-outs', 'Invoice / Job History'],
];

const complianceNavigation: NavItem[] = [
  ['/compliance', 'Compliance'],
  ['/driver-assignments', 'Driver History'],
];

const adminNavigation: NavItem[] = [
  ['/admin/integrations', 'Integrations'],
  ['/admin/staging', 'Import Reviews'],
  ['/master-data/roadrunner-review', 'RoadRunner Review'],
  ['/admin/users', 'Users'],
];

function pathActive(current: string, path: string) {
  return path === '/' ? current === '/' : current === path || current.startsWith(`${path}/`);
}

function ComplianceNav({ current }: { current: string }) {
  const active = complianceNavigation.some(([path]) => pathActive(current, path));
  return <details className={`top-nav-group ${active ? 'active' : ''}`}>
    <summary>Compliance<span aria-hidden="true">⌄</span></summary>
    <div className="top-nav-menu">
      {complianceNavigation.map(([path, label]) => <NavLink key={path} to={path}>{label}</NavLink>)}
    </div>
  </details>;
}

function AdminNav({ current }: { current: string }) {
  const active = adminNavigation.some(([path]) => pathActive(current, path));
  return <details className={`top-nav-group ${active ? 'active' : ''}`}>
    <summary>Admin<span aria-hidden="true">⌄</span></summary>
    <div className="top-nav-menu">
      {adminNavigation.map(([path, label]) => <NavLink key={path} to={path}>{label}</NavLink>)}
    </div>
  </details>;
}

function Shell() {
  const entraAuthenticated = useIsAuthenticated();
  const { instance, accounts } = useMsal();
  const accessToken = useAccessToken();
  const [localSession, setLocalSession] = useState<LocalAuthSession | null>(() => getLocalAuthSession());
  const authenticated = localAuthEnabled ? localSession !== null : entraAuthenticated;
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [signInError, setSignInError] = useState<string>();
  const [signingIn, setSigningIn] = useState(false);
  const [open, setOpen] = useState(false);
  const [pendingOrderReviews, setPendingOrderReviews] = useState(0);
  const location = useLocation();
  const isAdmin = localAuthEnabled && localSession?.role === 'TMS.Admin';

  const signIn = async () => {
    if (localAuthEnabled) {
      setSigningIn(true);
      setSignInError(undefined);
      try {
        const session = await localLogin(username, password);
        setLocalSession(session);
        setPassword('');
      } catch (error) {
        setSignInError(error instanceof Error ? error.message : 'Sign in failed.');
      } finally {
        setSigningIn(false);
      }
      return;
    }
    const request = { scopes: apiScope ? [apiScope] : [] };
    if (!isDesktopApp()) {
      await instance.loginRedirect(request);
      return;
    }
    const result = await instance.loginPopup(request);
    if (result.account) instance.setActiveAccount(result.account);
  };

  const signOut = async () => {
    if (localAuthEnabled) {
      localLogout();
      setLocalSession(null);
      return;
    }
    if (!isDesktopApp()) {
      await instance.logoutRedirect({ account: accounts[0] });
      return;
    }
    await instance.logoutPopup({ account: accounts[0] });
  };

  useEffect(() => { setOpen(false); }, [location.pathname]);

  useEffect(() => {
    if (!authenticated) return;
    const disconnect = connectPlanningEventStream(accessToken, {
      onAuthenticationRequired: error => {
        if (!localAuthEnabled) return;
        localLogout();
        setLocalSession(null);
        setSignInError(error.message || 'Your TMS sign-in has expired. Please sign in again.');
      },
    });
    return disconnect;
  }, [accessToken, authenticated]);

  useEffect(() => {
    if (!authenticated) {
      setPendingOrderReviews(0);
      return;
    }

    let stopped = false;
    const refreshPendingOrderReviews = async () => {
      try {
        const rows = await api.staging(await accessToken(), 'PendingReview', 'order', 200);
        if (!stopped) setPendingOrderReviews(rows.length);
      } catch (error) {
        console.warn('Pending order review count could not be refreshed.', error);
      }
    };

    void refreshPendingOrderReviews();
    const interval = window.setInterval(() => void refreshPendingOrderReviews(), 20000);
    const onFocus = () => void refreshPendingOrderReviews();
    window.addEventListener('focus', onFocus);

    return () => {
      stopped = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [accessToken, authenticated, location.pathname]);

  const loadingContent = <section className="sign-in-panel" aria-live="polite"><p className="eyebrow">Loading</p><h1>Opening TMS screen…</h1></section>;

  return <div className={`app-shell ${authenticated ? 'with-system-strip top-navigation-shell' : ''}`}>
    <header className="top-app-header">
      <button className="menu" onClick={() => setOpen(!open)} aria-label="Toggle navigation" aria-expanded={open}>☰</button>
      <NavLink className="brand" to="/dashboard"><span>SLH</span><small>Transport management</small></NavLink>
      <div className="header-context"><b>Daily transport control</b></div>
      <div className="header-actions">
        {authenticated
          ? <><span className="user">{localAuthEnabled ? localSession?.displayName : accounts[0]?.name}</span><button onClick={() => void signOut()}>Sign out</button></>
          : localAuthEnabled
            ? null
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
          title={hasPendingOrders ? `${pendingLabel} order${pendingOrderReviews === 1 ? '' : 's'} waiting for review` : undefined}
        >
          <span>{label}</span>
          {hasPendingOrders && <span className="nav-order-review-count" aria-hidden="true">{pendingLabel}</span>}
        </NavLink>;
      })}
      <ComplianceNav current={location.pathname} />
      {isAdmin && <AdminNav current={location.pathname} />}
    </nav>}

    {authenticated && <div className="system-strip"><HeaderIntelligence /></div>}

    <main>
      {authenticated ? <Suspense fallback={loadingContent}><RouteErrorBoundary key={location.pathname}><Routes>
        <Route path="/" element={<PlannerEnhanced />} />
        <Route path="/dashboard" element={<DashboardOperational />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/staging" element={<StagingQueue ordersOnly />} />
        <Route path="/pallet-control" element={<PalletPlanningControl />} />
        <Route path="/driver-dispatch" element={<DriverDispatchOperational />} />
        <Route path="/master-data" element={<MasterDataHub />} />
        <Route path="/master-data/roadrunner-review" element={isAdmin ? <RoadrunnerSiteReview /> : <Navigate to="/dashboard" replace />} />
        <Route path="/drivers" element={<MasterDataHub initialSection="drivers" />} />
        <Route path="/fleet-assets" element={<MasterDataHub initialSection="vehicles" />} />
        <Route path="/fuel-cards" element={<MasterDataHub initialSection="fuel-cards" />} />
        <Route path="/customers" element={<MasterDataHub initialSection="customers" />} />
        <Route path="/sites" element={<MasterDataHub initialSection="sites" />} />
        <Route path="/markets" element={<MasterDataHub initialSection="markets" />} />
        <Route path="/fuel" element={<MasterDataHub initialSection="fuel-prices" />} />
        <Route path="/compliance" element={<DailyCompliance />} />
        <Route path="/night-outs" element={<JobInvoiceHistory />} />
        <Route path="/driver-assignments" element={<DriverAssignments />} />
        <Route path="/admin/staging" element={isAdmin ? <StagingQueue /> : <Navigate to="/dashboard" replace />} />
        <Route path="/admin/integrations" element={isAdmin ? <AdminIntegrationSyncControls /> : <Navigate to="/dashboard" replace />} />
        <Route path="/admin/users" element={isAdmin ? <UserManagement /> : <Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes></RouteErrorBoundary></Suspense> : <section className="sign-in-panel">
        <p className="eyebrow">Secure operations portal</p>
        <h1>Sign in to Stuart Lyons Haulage TMS</h1>
        {localAuthEnabled ? <>
          <p>Use your individual TMS account.</p>
          <form onSubmit={event => { event.preventDefault(); void signIn(); }} style={{ width: '100%', maxWidth: 420, display: 'grid', gap: 12 }}>
            <label style={{ textAlign: 'left' }}>Username
              <input autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} required />
            </label>
            <label style={{ textAlign: 'left' }}>Password
              <input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required />
            </label>
            {signInError && <p role="alert">{signInError}</p>}
            <button className="primary" type="submit" disabled={signingIn || !username || !password}>{signingIn ? 'Signing in…' : 'Sign in'}</button>
          </form>
        </> : <>
          <p>Use your Lyons Microsoft account to open planning, master data and compliance.</p>
          <button className="primary" onClick={() => void signIn()} disabled={!apiScope}>Sign in with Microsoft</button>
        </>}
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
