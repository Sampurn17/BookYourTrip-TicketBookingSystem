import { useState } from 'react';
import { api, errorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { StatusBadge } from '../components/ui';
import { ModeIcon } from '../utils/modes';

function PersonalForm() {
  const { user, updateUser } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ name: user.name, phone: user.phone || '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = { name: form.name };
      if (form.phone) body.phone = form.phone;
      const { data } = await api.patch('/users/me', body);
      updateUser(data.user);
      toast.success('Profile saved');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel stack" onSubmit={save}>
      <h3>Personal details</h3>
      {error && <div className="notice bad">{error}</div>}
      <label className="field">
        <span>Full name</span>
        <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} />
      </label>
      <label className="field">
        <span>Email</span>
        <input className="input" value={user.email} disabled />
        <span className="hint">Email is your login and cannot be changed.</span>
      </label>
      <label className="field">
        <span>Mobile number</span>
        <input className="input" inputMode="numeric" pattern="[0-9]{10}" title="10 digit mobile number" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      </label>
      <div>
        <button className="btn" disabled={busy}>
          {busy ? 'Saving…' : 'Save details'}
        </button>
      </div>
    </form>
  );
}

function PasswordForm() {
  const { setSession } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { data } = await api.patch('/users/me/password', form);
      setSession({ token: data.token, user: data.user });
      setForm({ currentPassword: '', newPassword: '' });
      toast.success('Password changed. Other devices have been signed out.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel stack" onSubmit={save}>
      <h3>Password</h3>
      {error && <div className="notice bad">{error}</div>}
      <label className="field">
        <span>Current password</span>
        <input className="input" type="password" autoComplete="current-password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} required />
      </label>
      <label className="field">
        <span>New password</span>
        <input className="input" type="password" autoComplete="new-password" minLength={6} value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} required />
      </label>
      <div>
        <button className="btn ghost" disabled={busy}>
          {busy ? 'Changing…' : 'Change password'}
        </button>
      </div>
    </form>
  );
}

function CompanyForm() {
  const { user, updateUser } = useAuth();
  const toast = useToast();
  const p = user.provider || {};
  const [form, setForm] = useState({
    companyName: p.companyName || '',
    servicesOffered: p.servicesOffered || [],
    contactEmail: p.contactEmail || '',
    contactPhone: p.contactPhone || '',
    description: p.description || '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const toggle = (m) => setForm((f) => ({ ...f, servicesOffered: f.servicesOffered.includes(m) ? f.servicesOffered.filter((x) => x !== m) : [...f.servicesOffered, m] }));

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = Object.fromEntries(Object.entries(form).filter(([, v]) => (Array.isArray(v) ? v.length : v !== '')));
      const { data } = await api.patch('/provider/me', body);
      updateUser(data.user);
      toast.success('Company details saved');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel stack" onSubmit={save} style={{ gridColumn: '1 / -1' }}>
      <div className="spread">
        <h3>Company</h3>
        <StatusBadge status={p.status} />
      </div>
      {p.status === 'pending' && <div className="notice">Your application is waiting for admin approval. You can list trips once approved.</div>}
      {p.status === 'suspended' && <div className="notice bad">Your account is suspended{p.statusReason ? `: ${p.statusReason}` : ''}. Existing bookings are still honoured.</div>}
      {error && <div className="notice bad">{error}</div>}
      <div className="grid-2">
        <label className="field">
          <span>Company name</span>
          <input className="input" value={form.companyName} onChange={set('companyName')} required minLength={2} />
        </label>
        <div className="field">
          <span>Services</span>
          <div className="row" style={{ minHeight: 44 }}>
            {['bus', 'train', 'flight'].map((m) => (
              <label className="check" key={m}>
                <input type="checkbox" checked={form.servicesOffered.includes(m)} onChange={() => toggle(m)} />
                <ModeIcon mode={m} /> {m}
              </label>
            ))}
          </div>
        </div>
        <label className="field">
          <span>Support email</span>
          <input className="input" type="email" value={form.contactEmail} onChange={set('contactEmail')} />
        </label>
        <label className="field">
          <span>Support phone</span>
          <input className="input" inputMode="numeric" pattern="[0-9]{10}" value={form.contactPhone} onChange={set('contactPhone')} />
        </label>
      </div>
      <label className="field">
        <span>About your service</span>
        <textarea className="input" rows={3} maxLength={500} value={form.description} onChange={set('description')} />
      </label>
      <div>
        <button className="btn" disabled={busy}>
          {busy ? 'Saving…' : 'Save company details'}
        </button>
      </div>
    </form>
  );
}

export default function Profile() {
  const { user } = useAuth();
  return (
    <div className="container page" style={{ maxWidth: 980 }}>
      <div className="page-head">
        <div>
          <h1>{user.role === 'provider' ? 'Company profile' : 'Your profile'}</h1>
          <p className="muted">Signed in as {user.email}</p>
        </div>
      </div>
      <div className="grid-2">
        {user.role === 'provider' && <CompanyForm />}
        <PersonalForm />
        <PasswordForm />
      </div>
    </div>
  );
}
