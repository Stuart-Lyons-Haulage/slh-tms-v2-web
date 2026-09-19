import { NavLink, Route, Routes } from 'react-router-dom';
import { OverviewPage } from './pages/OverviewPage';
import { MasterDataPage } from './pages/MasterDataPage';
import { IntakeReviewPage } from './pages/IntakeReviewPage';
import './styles.css';

export function App() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">SLH</span>
          <div><strong>Transport Management</strong><small>V2 audited foundation</small></div>
        </div>
        <nav>
          <NavLink to="/">Overview</NavLink>
          <NavLink to="/master-data">Master Data</NavLink>
          <NavLink to="/intake">Intake Review</NavLink>
        </nav>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/master-data" element={<MasterDataPage />} />
          <Route path="/intake" element={<IntakeReviewPage />} />
        </Routes>
      </main>
    </div>
  );
}
