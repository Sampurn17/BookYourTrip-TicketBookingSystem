import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth, homeFor } from '../context/AuthContext';
import { errorMessage } from '../api/client';
import { AuthArt } from './Login';
import { ModeIcon } from '../utils/modes';

export default function Signup() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [role, setRole] = useState(params.get('role') === 'provider' ? 'provider' : 'customer');
  const [form, setForm] = useState({ name: '', email: '', password: '', phone: '', companyName: '', servicesOffered: [] });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const toggleService = (m) =>
    setForm((f) => ({ ...f, servicesOffered: f.servicesOffered.includes(m) ? f.servicesOffered.filter((x) => x !== m) : [...f.servicesOffered, m] }));

  const submit = async (e) => {
    e.preventDefault();
    if (role === 'provider' && !form.servicesOffered.length) {
      setError('Choose at least one service you operate.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const payload = { name: form.name, email: form.email, password: form.password, role };
      if (form.phone) payload.phone = form.phone;
      if (role === 'provider') Object.assign(payload, { companyName: form.companyName, servicesOffered: form.servicesOffered });
      const user = await signup(payload);
      navigate(homeFor(user.role), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <AuthArt
        title={role === 'provider' ? 'Sell seats on your routes' : 'Book in under a minute'}
        text={role === 'provider' ? 'List recurring trips, watch occupancy and get pricing advice. Our team approves new operators within a day.' : 'Pick your exact seat, pay, and change plans later if you need to.'}
      />
      <div className="auth-form">
        <form onSubmit={submit} className="stack">
          <h1 style={{ fontSize: '2rem' }}>Create an account</h1>
          <div className="segmented" role="group" aria-label="Account type">
            <button type="button" aria-pressed={role === 'customer'} onClick={() => setRole('customer')}>
              I am travelling
            </button>
            <button type="button" aria-pressed={role === 'provider'} onClick={() => setRole('provider')}>
              I run a transport company
            </button>
          </div>
          {error && <div className="notice bad">{error}</div>}
          <label className="field">
            <span>Full name</span>
            <input className="input" value={form.name} onChange={set('name')} required minLength={2} autoComplete="name" />
          </label>
          <div className="grid-2">
            <label className="field">
              <span>Email</span>
              <input className="input" type="email" value={form.email} onChange={set('email')} required autoComplete="email" />
            </label>
            <label className="field">
              <span>Phone (optional)</span>
              <input className="input" inputMode="numeric" pattern="[0-9]{10}" title="10 digit mobile number" value={form.phone} onChange={set('phone')} />
            </label>
          </div>
          <label className="field">
            <span>Password</span>
            <input className="input" type="password" value={form.password} onChange={set('password')} required minLength={6} autoComplete="new-password" />
            <span className="hint">At least 6 characters.</span>
          </label>
          {role === 'provider' && (
            <>
              <label className="field">
                <span>Company name</span>
                <input className="input" value={form.companyName} onChange={set('companyName')} required minLength={2} />
              </label>
              <div className="field">
                <span>Services you operate</span>
                <div className="row">
                  {['bus', 'train', 'flight'].map((m) => (
                    <label className="check" key={m}>
                      <input type="checkbox" checked={form.servicesOffered.includes(m)} onChange={() => toggleService(m)} />
                      <ModeIcon mode={m} /> {m[0].toUpperCase() + m.slice(1)}
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}
          <button className="btn lg block" disabled={busy}>
            {busy ? 'Creating account…' : role === 'provider' ? 'Apply as operator' : 'Create account'}
          </button>
          <p className="muted">
            Already registered? <Link to="/login">Log in</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
