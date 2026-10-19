import { NavLink } from 'react-router-dom';

/** Phone shortcuts to the screens used on the move; everything else is under More. */
export function MobileDock({ openMenu }: { openMenu: () => void }) {
  return <nav className="mobile-dock" aria-label="Mobile TMS navigation">
    <NavLink to="/dashboard"><span>⌂</span><small>Today</small></NavLink>
    <NavLink to="/mobile"><span>⌕</span><small>Lookup</small></NavLink>
    <NavLink to="/driver-dispatch"><span>▶</span><small>Dispatch</small></NavLink>
    <NavLink to="/warehouse"><span>▤</span><small>Warehouse</small></NavLink>
    <button type="button" onClick={openMenu}><span>☰</span><small>More</small></button>
  </nav>;
}
