import { NavLink } from 'react-router-dom';

export function MobileDock({ openMenu }: { openMenu: () => void }) {
  return <nav className="mobile-dock" aria-label="Mobile TMS navigation">
    <NavLink to="/mobile"><span>⌕</span><small>Mobile</small></NavLink>
    <NavLink to="/dashboard"><span>⌂</span><small>Dashboard</small></NavLink>
    <NavLink to="/" end><span>▦</span><small>Planner</small></NavLink>
    <NavLink to="/pallet-control"><span>▤</span><small>Pallets</small></NavLink>
    <button type="button" onClick={openMenu}><span>☰</span><small>More</small></button>
  </nav>;
}
