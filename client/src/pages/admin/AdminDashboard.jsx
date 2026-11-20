import { useCallback, useEffect, useState } from 'react';
import { FiCheckCircle, FiShield, FiAlertOctagon } from 'react-icons/fi';
import { api, errorMessage } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { Bars, Empty, Modal, Spinner, StatusBadge } from '../../components/ui';
import { ModeIcon } from '../../utils/modes';
import { inr, prettyDate } from '../../utils/format';

const FILTERS = [
  ['pending', 'Awaiting approval'],
  ['active', 'Active'],
  ['suspended', 'Suspended'],
  ['discontinued', 'Discontinued'],
  ['', 'All'],
];

const ACTIONS = {
  pending: [['approve', 'Approve'], ['discontinue', 'Reject']],
  active: [['suspend', 'Suspend'], ['discontinue', 'Discontinue']],
  suspended: [['reactivate', 'Reactivate'], ['discontinue', 'Discontinue']],
  discontinued: [],
};

const CONFIRM_COPY = {
  approve: 'The operator can list trips immediately and they appear in search.',
  suspend: 'Their trips disappear from search. Existing tickets remain valid.',
  reactivate: 'Their trips become bookable again.',
  discontinue: 'All of their trips are cancelled and every customer with a future booking is refunded in full. This cannot be undone.',
};

function Integrity() {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await api.get('/admin/integrity');
      setResult(data.integrity);
    } catch (err) {
      setResult({ error: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel">
      <div className="spread">
        <div>
          <h3>Booking integrity</h3>
          <p className="muted" style={{ margin: 0 }}>
            Checks every seat inventory against confirmed bookings for double-sold seats and overbooking.
          </p>
        </div>
        <button className="btn ghost" onClick={run} disabled={busy}>
          <FiShield aria-hidden="true" /> {busy ? 'Checking…' : 'Run check'}
        </button>
      </div>
      {result?.error && <div className="notice bad" style={{ marginTop: 16 }}>{result.error}</div>}
      {result && !result.error && (
        <div className={`notice ${result.ok ? 'info' : 'bad'}`} style={{ marginTop: 16, marginBottom: 0 }}>
          {result.ok ? <FiCheckCircle /> : <FiAlertOctagon />}
          <span>
            {result.ok
              ? `All clear. ${result.inventoriesChecked} departures checked, ${result.seatsSold} seats sold, no seat sold twice and no departure over capacity.`
              : `${result.issues.length} problem(s) found: ${[...new Set(result.issues.map((i) => i.type))].join(', ')}`}
          </span>
        </div>
      )}
    </section>
  );
}

export default function AdminDashboard() {
  const toast = useToast();
  const [stats, setStats] = useState(null);
  const [filter, setFilter] = useState('pending');
  const [providers, setProviders] = useState(null);
  const [pending, setPending] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadStats = () => api.get('/admin/stats').then((r) => setStats(r.data.stats)).catch((err) => setError(errorMessage(err)));
  const loadProviders = useCallback(() => {
    setProviders(null);
    api
      .get(`/admin/providers${filter ? `?status=${filter}` : ''}`)
      .then((r) => setProviders(r.data.providers))
      .catch((err) => setError(errorMessage(err)));
  }, [filter]);

  useEffect(() => {
    loadStats();
  }, []);
  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  const act = async () => {
    setBusy(true);
    try {
      const { data } = await api.patch(`/admin/providers/${pending.provider._id}/${pending.action}`, { reason: reason || undefined });
      const imp = data.impact;
      toast.success(
        pending.action === 'discontinue' && imp
          ? `${pending.provider.companyName} discontinued. ${imp.tripsCancelled} trips cancelled, ${imp.bookingsCancelled} bookings refunded (${inr(imp.totalRefunded)}).`
          : `${pending.provider.companyName} is now ${data.provider.status}.`,
      );
      setPending(null);
      setReason('');
      loadProviders();
      loadStats();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <h1>Operators and platform health</h1>
          <p className="muted">Approve new operators, pause or remove existing ones, and verify bookings.</p>
        </div>
      </div>
      {error && <div className="notice bad">{error}</div>}
      {!stats && !error && <Spinner />}
      {stats && (
        <>
          <div className="kpis">
            <div className="kpi">
              <span>Bookings today</span>
              <b>{stats.bookings.today}</b>
            </div>
            <div className="kpi">
              <span>Confirmed bookings</span>
              <b>{stats.bookings.confirmed}</b>
            </div>
            <div className="kpi">
              <span>Net revenue</span>
              <b>{inr(stats.revenue)}</b>
            </div>
            <div className="kpi">
              <span>Customers / active operators</span>
              <b>
                {stats.users.customer || 0} / {stats.providers.active || 0}
              </b>
            </div>
          </div>
          <div className="grid-2" style={{ marginBottom: 24 }}>
            <section className="panel">
              <h3>Bookings, last 7 days</h3>
              <Bars data={stats.daily.map((d) => ({ ...d, short: prettyDate(d.date, { weekday: 'short' }) }))} valueKey="bookings" labelKey="date" />
            </section>
            <Integrity />
          </div>
        </>
      )}
      <div className="spread" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Operators</h2>
        <div className="segmented" role="tablist">
          {FILTERS.map(([id, label]) => (
            <button key={id || 'all'} aria-pressed={filter === id} onClick={() => setFilter(id)}>
              {label}
              {id === 'pending' && stats?.providers.pending ? ` (${stats.providers.pending})` : ''}
            </button>
          ))}
        </div>
      </div>
      {!providers && <Spinner />}
      {providers?.length === 0 && <Empty title="No operators here">{filter === 'pending' ? 'New operator applications will show up here.' : null}</Empty>}
      {providers?.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Contact</th>
                <th>Services</th>
                <th className="num">Active trips</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p._id}>
                  <td>
                    <strong>{p.companyName}</strong>
                    <div className="faint" style={{ fontSize: '0.85rem' }}>
                      Applied {new Date(p.createdAt).toLocaleDateString('en-IN')}
                    </div>
                  </td>
                  <td>
                    {p.user?.name}
                    <div className="faint" style={{ fontSize: '0.85rem' }}>
                      {p.user?.email}
                    </div>
                  </td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      {p.servicesOffered.map((m) => (
                        <span key={m} title={m}>
                          <ModeIcon mode={m} />
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="num">{p.activeTrips}</td>
                  <td>
                    <StatusBadge status={p.status} />
                    {p.statusReason && (
                      <div className="faint" style={{ fontSize: '0.8rem' }}>
                        {p.statusReason}
                      </div>
                    )}
                  </td>
                  <td>
                    <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                      {ACTIONS[p.status].map(([action, label]) => (
                        <button
                          key={action}
                          className={`btn sm ${action === 'approve' || action === 'reactivate' ? '' : action === 'discontinue' ? 'quiet' : 'ghost'}`}
                          style={action === 'discontinue' ? { color: 'var(--red)' } : undefined}
                          onClick={() => setPending({ provider: p, action, label })}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pending && (
        <Modal
          title={`${pending.label} ${pending.provider.companyName}?`}
          onClose={() => setPending(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setPending(null)}>
                Go back
              </button>
              <button className={`btn ${pending.action === 'discontinue' ? 'danger' : ''}`} disabled={busy} onClick={act}>
                {busy ? 'Working…' : pending.label}
              </button>
            </>
          }
        >
          <p>{CONFIRM_COPY[pending.action]}</p>
          {pending.action !== 'approve' && (
            <label className="field">
              <span>Reason shared with the operator (optional)</span>
              <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
            </label>
          )}
        </Modal>
      )}
    </div>
  );
}
