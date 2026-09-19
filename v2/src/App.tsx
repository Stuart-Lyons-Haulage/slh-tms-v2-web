import { NavLink, Route, Routes } from 'react-router-dom';
import { OverviewPage } from './pages/OverviewPage';
import { MasterDataPage } from './pages/MasterDataPage';
import { IntakeReviewPage } from './pages/IntakeReviewPage';
import { PlanningPage } from './pages/PlanningPage';
import { PalletControlPage } from './pages/PalletControlPage';
import './styles.css';

export function App() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">SLH</span>
          <div><strong>Transport Management</strong><small>V2 foundation</small></div>
        </div>
        <nav>
          <NavLink to="/">Overview</NavLink>
          <NavLink to="/master-data">Master Data</NavLink>
          <NavLink to="/intake">Intake Review</NavLink>
          <NavLink to="/planning">Planning</NavLink>
        </nav>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/master-data" element={<MasterDataPage />} />
          <Route path="/intake" element={<IntakeReviewPage />} />
          <Route path="/planning" element={<PlanningPage />} />
          <Route path="/planning/pallet-control" element={<PalletControlPage />} />
        </Routes>
      </main>
    </div>
  );
}
