import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { DriverDispatch } from './pages/DriverDispatch';
import { PlannerEnhanced } from './pages/PlannerEnhanced';
import { LiveRunsBoard } from './pages/LiveRunsBoard';
import { PalletPlanningControl } from './pages/PalletPlanningControl';

export function E2eHarness() {
  return <BrowserRouter>
    <nav aria-label="E2E workflow navigation" style={{ display: 'flex', gap: 12, padding: 12 }}>
      <Link to="/">Planner</Link>
      <Link to="/pallet-control">Pallet Order</Link>
      <Link to="/driver-dispatch">Driver Dispatch</Link>
      <Link to="/operations-wallboard">Operations Wallboard</Link>
    </nav>
    <Routes>
      <Route path="/" element={<PlannerEnhanced />} />
      <Route path="/pallet-control" element={<PalletPlanningControl />} />
      <Route path="/driver-dispatch" element={<DriverDispatch />} />
      <Route path="/operations-wallboard" element={<LiveRunsBoard />} />
    </Routes>
  </BrowserRouter>;
}
