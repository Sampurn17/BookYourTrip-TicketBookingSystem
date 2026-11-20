import { useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { FiMenu, FiX, FiLogOut } from 'react-icons/fi';
import { useAuth } from '../context/AuthContext';

const LINKS = {
  guest: [{ to: '/', label: 'Search trips', end: true }],
  customer: [
    { to: '/', label: 'Search trips', end: true },
    { to: '/trips', label: 'My trips' },
    { to: '/profile', label: 'Profile' },
  ],
  provider: [
    { to: '/provider', label: 'Dashboard', end: true },
    { to: '/provider/trips', label: 'Trips' },
    { to: '/profile', label: 'Company' },
  ],
  admin: [
    { to: '/admin', label: 'Operators & health' },
    { to: '/profile', label: 'Profile' },
  ],
};

export default function Navbar() {
  const { user, role, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const onHero = pathname === '/';

  return (
    <header className={`nav${onHero ? ' on-hero' : ''}`}>
      <div className="container nav-inner">
        <Link to="/" className="brand" aria-label="BookYourTrip home">
          <span className="brand-mark">
            <i />
          </span>
          BookYourTrip
        </Link>
        <button className="btn quiet nav-toggle" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? <FiX size={22} /> : <FiMenu size={22} />}
        </button>
        <nav className={`nav-links${open ? ' open' : ''}`} onClick={() => setOpen(false)}>
          {LINKS[role].map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end}>
              {l.label}
            </NavLink>
          ))}
          {user ? (
            <div className="nav-user">
              <span>{user.name.split(' ')[0]}</span>
              <button
                className="btn ghost sm"
                onClick={() => {
                  logout();
                  navigate('/');
                }}
              >
                <FiLogOut aria-hidden="true" /> Log out
              </button>
            </div>
          ) : (
            <div className="nav-user">
              <Link to="/login">Log in</Link>
              <Link to="/signup" className="btn sm marigold">
                Sign up
              </Link>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}
