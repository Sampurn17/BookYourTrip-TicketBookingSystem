import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiAlertTriangle, FiTrendingUp, FiTrendingDown, FiMinus } from 'react-icons/fi';
import { api, errorMessage } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Bars, Meter, Spinner, Empty } from '../../components/ui';
import { ModeIcon } from '../../utils/modes';
import { inr, prettyDate } from '../../utils/format';

export function InactiveNotice({ provider }) {
  if (!provider || provider.status === 'active') return null;
  const text = {
    pending: 'Your operator account is waiting for approval. You can complete your company profile meanwhile.',
    suspended: `Your account is suspended${provider.statusReason ? `: ${provider.statusReason}` : ''}. New sales are paused; existing tickets stay valid.`,
    discontinued: 'This operator account has been discontinued. All future trips were cancelled and refunded.',
  }[provider.status];
  return (
    <div className="notice">
      <FiAlertTriangle />
      <span>
        {text} <Link to="/profile">Open company profile</Link>
      </span>
    </div>
  );
}

const REC_ICON = { increase: FiTrendingUp, decrease: FiTrendingDown, hold: FiMinus };

export default function ProviderDashboard() {
  const { user } = useAuth();
  const toast = useToast();
  const [stats, setStats] = useState(null);
  const [perf, setPerf] = useState(null);
  const [error, setError] = useState('');
  const active = user.provider?.status === 'active';

  const load = useCallback(() => {
    Promise.all([api.get('/provider/stats?days=7'), api.get('/provider/performance')])
      .then(([s, p]) => {
        setStats(s.data.stats);
        setPerf(p.data.trips);
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  useEffect(() => {
    if (active) load();
  }, [active, load]);

  const apply = async (row) => {
    try {
      await api.patch(`/provider/trips/${row.tripId}`, { basePrice: row.recommendation.suggestedBasePrice });
      toast.success(`Base fare for ${row.route} set to ${inr(row.recommendation.suggestedBasePrice)}`);
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <h1>{user.provider?.companyName || 'Dashboard'}</h1>
          <p className="muted">Last 7 days of sales and the week ahead.</p>
        </div>
        {active && (
          <Link className="btn" to="/provider/trips">
            Manage trips
          </Link>
        )}
      </div>
      <InactiveNotice provider={user.provider} />
      {error && <div className="notice bad">{error}</div>}
      {active && !stats && !error && <Spinner />}
      {stats && (
        <>
          <div className="kpis">
            <div className="kpi">
              <span>Bookings</span>
              <b>{stats.totals.bookings}</b>
            </div>
            <div className="kpi">
              <span>Seats sold</span>
              <b>{stats.totals.seatsSold}</b>
            </div>
            <div className="kpi">
              <span>Net revenue</span>
              <b>{inr(stats.totals.revenue)}</b>
            </div>
            <div className="kpi">
              <span>Active trips</span>
              <b>{stats.totals.activeTrips}</b>
            </div>
          </div>
          <div className="grid-2" style={{ marginBottom: 24 }}>
            <section className="panel">
              <h3>Occupancy, next 7 days</h3>
              <p className="muted" style={{ margin: 0 }}>Share of seats sold across all departures</p>
              <Bars
                data={stats.occupancyNext7.map((d) => ({ ...d, short: prettyDate(d.date, { weekday: 'short' }) }))}
                valueKey="occupancy"
                labelKey="date"
                max={100}
                format={(v) => `${v}%`}
              />
            </section>
            <section className="panel">
              <h3>Net revenue, last 7 days</h3>
              <p className="muted" style={{ margin: 0 }}>By booking date, after refunds</p>
              <Bars
                alt
                data={stats.daily.map((d) => ({ ...d, short: prettyDate(d.date, { weekday: 'short' }) }))}
                valueKey="revenue"
                labelKey="date"
                format={(v) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : v)}
              />
            </section>
          </div>
          <section>
            <div className="spread" style={{ marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>Fare advice</h2>
            </div>
            {perf?.length === 0 ? (
              <Empty title="No active trips" action={<Link className="btn" to="/provider/trips">Add your first trip</Link>} />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Route</th>
                      <th>Booked, next 7 days</th>
                      <th className="num">Revenue 30d</th>
                      <th className="num">Base fare</th>
                      <th>Advice</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {perf?.map((r) => {
                      const Icon = REC_ICON[r.recommendation.action];
                      return (
                        <tr key={r.tripId}>
                          <td>
                            <div className="row" style={{ gap: 8 }}>
                              <ModeIcon mode={r.mode} />
                              <strong>{r.route}</strong>
                              <span className="faint">{r.departureTime}</span>
                            </div>
                          </td>
                          <td style={{ minWidth: 160 }}>
                            <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                              <Meter value={r.occupancyNext7} />
                              <span>{r.occupancyNext7}%</span>
                            </div>
                          </td>
                          <td className="num">{inr(r.revenue30d)}</td>
                          <td className="num">{inr(r.basePrice)}</td>
                          <td style={{ maxWidth: 320 }}>
                            <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                              <Icon aria-hidden="true" size={18} style={{ flex: 'none' }} />
                              <span className="muted" style={{ fontSize: '0.88rem' }}>
                                {r.recommendation.reason}
                              </span>
                            </span>
                          </td>
                          <td>
                            {r.recommendation.suggestedBasePrice && (
                              <button className="btn sm ghost" onClick={() => apply(r)}>
                                Set {inr(r.recommendation.suggestedBasePrice)}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
