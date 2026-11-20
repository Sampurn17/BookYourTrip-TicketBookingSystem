import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiPlus, FiUsers, FiEdit2, FiSlash } from 'react-icons/fi';
import { api, errorMessage } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Empty, Meter, Modal, Spinner, StatusBadge } from '../../components/ui';
import { ModeIcon } from '../../utils/modes';
import { addDays, inr, todayIST, duration } from '../../utils/format';
import TripForm from './TripForm';
import { InactiveNotice } from './ProviderDashboard';

const DAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export default function ProviderTrips() {
  const { user } = useAuth();
  const toast = useToast();
  const [date, setDate] = useState(todayIST());
  const [trips, setTrips] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [busy, setBusy] = useState(false);
  const active = user.provider?.status === 'active';

  const load = useCallback(() => {
    api
      .get(`/provider/trips?date=${date}`)
      .then((r) => setTrips(r.data.trips))
      .catch((err) => setError(errorMessage(err)));
  }, [date]);

  useEffect(() => {
    if (active) load();
  }, [active, load]);

  const cancelTrip = async () => {
    setBusy(true);
    try {
      const { data } = await api.delete(`/provider/trips/${cancelling._id}`);
      toast.success(`Trip cancelled. ${data.bookingsCancelled} booking(s) refunded ${inr(data.totalRefunded)}.`);
      setCancelling(null);
      load();
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
          <h1>Trips</h1>
          <p className="muted">Recurring services. Seats are sold per date.</p>
        </div>
        <div className="row">
          <label className="field">
            <span>Show seats for</span>
            <input className="input" type="date" min={todayIST()} max={addDays(todayIST(), 60)} value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          {active && (
            <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={() => setEditing({})}>
              <FiPlus aria-hidden="true" /> Add trip
            </button>
          )}
        </div>
      </div>
      <InactiveNotice provider={user.provider} />
      {error && <div className="notice bad">{error}</div>}
      {active && !trips && !error && <Spinner />}
      {trips?.length === 0 && <Empty title="No trips yet" action={<button className="btn" onClick={() => setEditing({})}>Add your first trip</button>}>Add a route with its schedule and seat count.</Empty>}
      {trips?.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Route</th>
                <th>Schedule</th>
                <th className="num">Fare today</th>
                <th>Seats on {date === todayIST() ? 'today' : date}</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {trips.map((t) => (
                <tr key={t._id} style={t.status === 'cancelled' ? { opacity: 0.6 } : undefined}>
                  <td>
                    <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                      <ModeIcon mode={t.mode} />
                      <div>
                        <strong>
                          {t.source} → {t.destination}
                        </strong>
                        <div className="faint" style={{ fontSize: '0.85rem' }}>
                          {t.serviceName || t.mode} {t.amenities?.length ? `, ${t.amenities.join(', ')}` : ''}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    {t.departureTime} to {t.arrivalTime}
                    <div className="faint" style={{ fontSize: '0.85rem' }}>
                      {duration(t.durationMinutes)},{' '}
                      {t.operatingDays.length === 7 ? 'daily' : DAY.map((d, i) => (t.operatingDays.includes(i) ? d : '·')).join(' ')}
                    </div>
                  </td>
                  <td className="num">
                    {inr(t.fare.perSeat)}
                    {t.fare.multiplier !== 1 && <div className="faint" style={{ fontSize: '0.85rem' }}>base {inr(t.basePrice)}</div>}
                  </td>
                  <td style={{ minWidth: 170 }}>
                    {t.runsOnDate ? (
                      <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                        <Meter value={t.occupancy} />
                        <span>
                          {t.bookedSeats}/{t.totalSeats}
                        </span>
                      </div>
                    ) : (
                      <span className="faint">Does not run</span>
                    )}
                  </td>
                  <td>
                    <StatusBadge status={t.status} />
                  </td>
                  <td>
                    {t.status === 'scheduled' && (
                      <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                        {t.runsOnDate && (
                          <Link className="btn sm quiet" to={`/provider/trips/${t._id}/manifest?date=${date}`} title="Passenger list">
                            <FiUsers aria-hidden="true" /> Passengers
                          </Link>
                        )}
                        <button className="btn sm quiet" onClick={() => setEditing(t)} aria-label={`Edit ${t.source} to ${t.destination}`}>
                          <FiEdit2 />
                        </button>
                        <button className="btn sm quiet" style={{ color: 'var(--red)' }} onClick={() => setCancelling(t)} aria-label={`Cancel ${t.source} to ${t.destination}`}>
                          <FiSlash />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <TripForm
          trip={editing._id ? editing : null}
          services={user.provider.servicesOffered}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            toast.success(msg);
            setEditing(null);
            load();
          }}
        />
      )}
      {cancelling && (
        <Modal
          title={`Cancel ${cancelling.source} → ${cancelling.destination}?`}
          onClose={() => setCancelling(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setCancelling(null)}>
                Keep running
              </button>
              <button className="btn danger" disabled={busy} onClick={cancelTrip}>
                {busy ? 'Cancelling…' : 'Cancel trip and refund'}
              </button>
            </>
          }
        >
          <p>The service stops on all future dates. Every customer with a future booking gets a full refund automatically. This cannot be undone.</p>
        </Modal>
      )}
    </div>
  );
}
