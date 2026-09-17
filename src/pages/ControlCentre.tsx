import { AdminIntegrationSyncControls } from '../components/AdminIntegrationSyncControls';
import { Admin } from './Pages';
import { OperationsControlClean } from './OperationsControlClean';
import { RoadrunnerCsvExport } from './RoadrunnerCsvExport';
import { TvDisplaySetup } from './TvDisplaySetup';

export function ControlCentre() {
  return <section className="control-centre-one-page">
    <div className="title-row">
      <div>
        <p className="eyebrow">Control & administration</p>
        <h1>Control centre</h1>
        <p className="intro">One continuous operational control page: operational reconciliation first, then integration health and administration. No duplicated switchable views.</p>
      </div>
    </div>

    <OperationsControlClean />

    <div className="control-centre-admin-divider">
      <p className="eyebrow">Integrations & administration</p>
      <h2>Platform controls</h2>
      <p className="hint">Use these only when an integration or platform control needs attention.</p>
    </div>
    <RoadrunnerCsvExport />
    <TvDisplaySetup />
    <AdminIntegrationSyncControls />
    <Admin />
  </section>;
}