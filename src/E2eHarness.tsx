import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { DriverDispatch } from './pages/DriverDispatch';
import { PlannerEnhanced } from './pages/PlannerEnhanced';
import { PalletPlanningControl } from './pages/PalletPlanningControl';

export function E2eHarness() {
  return <BrowserRouter>
    <Routes>
      <Route path="/" element={<PlannerEnhanced />} />
      <Route path="/pallet-control" element={<PalletPlanningControl />} />
      <Route path="/driver-dispatch" element={<DriverDispatch />} />
    </Routes>
  </BrowserRouter>;
}
