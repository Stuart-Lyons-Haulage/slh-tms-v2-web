import { NavLink } from 'react-router-dom';
import { useMsal } from '@azure/msal-react';
import { IntakeHealthPanel } from '../components/IntakeHealthPanel';

function rolesFromClaims(claims: Record<string, unknown> | undefined) {
  const roles = Array.isArray(claims?.roles) ? claims?.roles : [];
  return roles.filter((value): value is string => typeof value === 'string').sort();
}

export function AdminHub() {
  const { instance, accounts } = useMsal();
  const account = instance.getActiveAccount() || accounts[0];
  const roles = rolesFromClaims(account?.idTokenClaims as Record<string, unknown> | undefined);
  const adminSections = [
    {
      to: '/admin/integrations',
      title: 'Integrations & system sync',
      detail: 'RoadTech, TachoMaster, Sage HR, Fleetio, Samsara and Microsoft Graph runtime status and controlled refresh actions.'
    },
    {
      to: '/admin/order-intake',
      title: 'Order intake rules',
      detail: 'Customer sender mappings and route rules used by the Microsoft Graph Info mailbox intake.'
    },
    {
      to: '/admin/staging',
      title: 'Import reviews',
      detail: 'Full staging queue for master-data and non-order imports. Normal transport orders remain in Order Review.'
    },
    {
      to: '/master-data/roadrunner-review',
      title: 'RoadRunner review',
      detail: 'Reconcile RoadRunner site identities to the canonical SQL Site Master.'
    },
    {
      to: '/master-data',
      title: 'Master Data governance',
      detail: 'Drivers, vehicles, trailers, fuel cards, sites, customers, markets, geofences and fuel prices.'
    },
    {
      to: '/driver-timesheets',
      title: 'Timesheet evidence',
      detail: 'Check the TachoMaster, RoadTech and Sage HR evidence used for employed and agency timesheets.'
    }
  ];

  return <section>
    <div className="title-row">
      <div>
        <p className="eyebrow">Administration</p>
        <h1>TMS Admin</h1>
        <p className="hint">One control point for access, integrations, order intake, import governance and operational master-data health.</p>
      </div>
    </div>

    <section className="panel" style={{ marginBottom: 18 }}>
      <div className="title-row">
        <div>
          <p className="eyebrow">Microsoft Entra</p>
          <h2>Signed-in access</h2>
        </div>
        <span className="integration-state ready">Authenticated</span>
      </div>
      <div className="admin-grid">
        <article className="admin-card">
          <span>Account</span>
          <h3>{account?.name || account?.username || 'Microsoft user'}</h3>
          <small>{account?.username || 'Microsoft Entra account'}</small>
        </article>
        <article className="admin-card">
          <span>App roles in token</span>
          <h3>{roles.length ? roles.join(' · ') : 'No TMS app role claim'}</h3>
          <small>Backend policies remain authoritative even when an Admin link is visible.</small>
        </article>
      </div>
    </section>

    <div className="admin-grid" style={{ marginBottom: 18 }}>
      {adminSections.map(section => <article className="admin-card" key={section.to}>
        <h3>{section.title}</h3>
        <p>{section.detail}</p>
        <NavLink className="primary" to={section.to}>Open</NavLink>
      </article>)}
    </div>

    <IntakeHealthPanel />

    <section className="panel">
      <p className="eyebrow">Administration boundaries</p>
      <h2>What remains outside the TMS</h2>
      <p className="hint">User creation, Microsoft account lifecycle and assignment of Entra application roles are Microsoft Entra administration tasks. The TMS reads those claims and enforces API policies; it should not maintain a competing user directory.</p>
    </section>
  </section>;
}
