import { useState } from 'react';
import { Modal } from '../../components/ui';
import { api, errorMessage } from '../../api/client';
import { useCities } from '../../components/SearchPanel';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function TripForm({ trip, services, onClose, onSaved }) {
  const cities = useCities();
  const [form, setForm] = useState(() => ({
    mode: trip?.mode || services[0] || 'bus',
    serviceName: trip?.serviceName || '',
    source: trip?.source || '',
    destination: trip?.destination || '',
    departureTime: trip?.departureTime || '08:00',
    arrivalTime: trip?.arrivalTime || '12:00',
    basePrice: trip?.basePrice || 500,
    totalSeats: trip?.totalSeats || (services[0] === 'flight' ? 60 : 40),
    operatingDays: trip?.operatingDays || [0, 1, 2, 3, 4, 5, 6],
    amenities: (trip?.amenities || []).join(', '),
  }));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const toggleDay = (d) =>
    setForm((f) => ({ ...f, operatingDays: f.operatingDays.includes(d) ? f.operatingDays.filter((x) => x !== d) : [...f.operatingDays, d].sort() }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.operatingDays.length) {
      setError('Pick at least one operating day.');
      return;
    }
    setBusy(true);
    setError('');
    const body = {
      ...form,
      basePrice: Number(form.basePrice),
      totalSeats: Number(form.totalSeats),
      amenities: form.amenities.split(',').map((a) => a.trim()).filter(Boolean),
    };
    if (!body.serviceName) delete body.serviceName;
    try {
      if (trip) await api.patch(`/provider/trips/${trip._id}`, body);
      else await api.post('/provider/trips', body);
      onSaved(trip ? 'Trip updated' : 'Trip added');
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal title={trip ? `Edit ${trip.source} → ${trip.destination}` : 'Add a recurring trip'} onClose={onClose} wide>
      <form onSubmit={submit} className="stack">
        {error && <div className="notice bad">{error}</div>}
        {trip && <div className="notice info">Route and mode are locked while customers hold future bookings. Price changes apply to new bookings only.</div>}
        <div className="grid-3">
          <label className="field">
            <span>Mode</span>
            <select className="input" value={form.mode} onChange={set('mode')}>
              {services.map((m) => (
                <option key={m} value={m}>
                  {m[0].toUpperCase() + m.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>From</span>
            <input className="input" list="trip-cities" value={form.source} onChange={set('source')} required minLength={2} />
          </label>
          <label className="field">
            <span>To</span>
            <input className="input" list="trip-cities" value={form.destination} onChange={set('destination')} required minLength={2} />
          </label>
          <label className="field">
            <span>Departs</span>
            <input className="input" type="time" value={form.departureTime} onChange={set('departureTime')} required />
          </label>
          <label className="field">
            <span>Arrives</span>
            <input className="input" type="time" value={form.arrivalTime} onChange={set('arrivalTime')} required />
            <span className="hint">Earlier than departure means next day.</span>
          </label>
          <label className="field">
            <span>Service number (optional)</span>
            <input className="input" value={form.serviceName} onChange={set('serviceName')} placeholder="ZT-204" />
          </label>
          <label className="field">
            <span>Base fare (₹)</span>
            <input className="input" type="number" min={1} max={100000} value={form.basePrice} onChange={set('basePrice')} required />
            <span className="hint">Demand and timing adjust this automatically.</span>
          </label>
          <label className="field">
            <span>Seats</span>
            <input className="input" type="number" min={1} max={300} value={form.totalSeats} onChange={set('totalSeats')} required />
          </label>
          <label className="field">
            <span>Amenities</span>
            <input className="input" value={form.amenities} onChange={set('amenities')} placeholder="AC, Charging point" />
          </label>
        </div>
        <div className="field">
          <span>Runs on</span>
          <div className="segmented" role="group" aria-label="Operating days">
            {DAYS.map((d, i) => (
              <button type="button" key={d} aria-pressed={form.operatingDays.includes(i)} onClick={() => toggleDay(i)}>
                {d}
              </button>
            ))}
          </div>
        </div>
        <datalist id="trip-cities">
          {cities.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Discard
          </button>
          <button className="btn" disabled={busy}>
            {busy ? 'Saving…' : trip ? 'Save changes' : 'Add trip'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
