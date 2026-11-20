import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, homeFor } from '../context/AuthContext';
import { errorMessage } from '../api/client';

const DEMO = [
  { label: 'Customer', email: 'aarav@example.com', password: 'Password@123' },
  { label: 'Bus operator', email: 'zing@bookyourtrip.com', password: 'Password@123' },
  { label: 'Admin', email: 'admin@bookyourtrip.com', password: 'Admin@123' },
];

export function AuthArt({ title, text }) {
  return (
    <aside className="auth-art">
      <div className="stub">
        Seat 14A
        <b>DEL → JAI</b>
        06:00, Zing Travels
      </div>
      <h2>{title}</h2>
      <p>{text}</p>
    </aside>
  );
}

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const user = await login(form.email, form.password);
      const from = location.state?.from;
      navigate(user.role === 'customer' && from ? from : homeFor(user.role), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <AuthArt title="Welcome back" text="Your tickets, changes and refunds are all in one place." />
      <div className="auth-form">
        <form onSubmit={submit} className="stack">
          <h1 style={{ fontSize: '2rem' }}>Log in</h1>
          {location.state?.from && <div className="notice info">Log in to continue with your booking.</div>}
          {error && <div className="notice bad">{error}</div>}
          <label className="field">
            <span>Email</span>
            <input className="input" type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </label>
          <label className="field">
            <span>Password</span>
            <input className="input" type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          </label>
          <button className="btn lg block" disabled={busy}>
            {busy ? 'Logging in…' : 'Log in'}
          </button>
          <p className="muted">
            New here? <Link to="/signup">Create an account</Link>
          </p>
          <div className="demo-accounts">
            <strong>Demo accounts</strong> (after running the seed script)
            <div className="row" style={{ marginTop: 6 }}>
              {DEMO.map((d) => (
                <button type="button" key={d.email} onClick={() => setForm({ email: d.email, password: d.password })}>
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
