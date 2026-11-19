import { NavLink } from 'react-router-dom';

const TABS = [
  { to: '/', label: 'Today', icon: 'ic-home', end: true },
  { to: '/progress', label: 'Progress', icon: 'ic-chart' },
  { to: '/plan', label: 'Plan', icon: 'ic-list' },
  { to: '/gyms', label: 'Gyms', icon: 'ic-building' },
];

/** Bottom tab bar. Place as the last child of `.app`. Pass `active` only to force one (normally derived from the route). */
export default function TabBar() {
  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `tab${isActive ? ' on' : ''}`} aria-current={undefined}>
          <span className={`ic ${t.icon}`} aria-hidden="true" />
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
