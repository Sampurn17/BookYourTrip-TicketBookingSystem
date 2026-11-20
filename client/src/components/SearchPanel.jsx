import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiRepeat, FiSearch } from 'react-icons/fi';
import { api } from '../api/client';
import { todayIST, addDays } from '../utils/format';

let citiesCache = null;
export function useCities() {
  const [cities, setCities] = useState(citiesCache || []);
  useEffect(() => {
    if (citiesCache) return;
    api
      .get('/trips/cities')
      .then((r) => {
        citiesCache = r.data.cities;
        setCities(r.data.cities);
      })
      .catch(() => {});
  }, []);
  return cities;
}

export default function SearchPanel({ initial = {} }) {
  const navigate = useNavigate();
  const cities = useCities();
  const [form, setForm] = useState({
    source: initial.source || '',
    destination: initial.destination || '',
    date: initial.date || addDays(todayIST(), 1),
    seats: initial.seats || 1,
  });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    setForm((f) => ({ ...f, ...Object.fromEntries(Object.entries(initial).filter(([, v]) => v)) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.source, initial.destination, initial.date, initial.seats]);

  const submit = (e) => {
    e.preventDefault();
    if (form.source && form.destination && form.source.trim().toLowerCase() === form.destination.trim().toLowerCase()) {
      setError('Pick two different cities.');
      return;
    }
    setError('');
    const qs = new URLSearchParams({ date: form.date, seats: String(form.seats) });
    if (form.source) qs.set('source', form.source.trim());
    if (form.destination) qs.set('destination', form.destination.trim());
    navigate(`/search?${qs}`);
  };

  return (
    <form className="ticket search-ticket" onSubmit={submit} aria-label="Search trips">
      <div className="ticket-main">
        <label className="field">
          <span>From</span>
          <input className="input" list="byt-cities" placeholder="Delhi" value={form.source} onChange={set('source')} autoComplete="off" />
        </label>
        <button
          type="button"
          className="swap-btn"
          aria-label="Swap cities"
          onClick={() => setForm((f) => ({ ...f, source: f.destination, destination: f.source }))}
        >
          <FiRepeat />
        </button>
        <label className="field">
          <span>To</span>
          <input className="input" list="byt-cities" placeholder="Jaipur" value={form.destination} onChange={set('destination')} autoComplete="off" />
        </label>
        <label className="field">
          <span>Travel date</span>
          <input className="input" type="date" min={todayIST()} max={addDays(todayIST(), 60)} value={form.date} onChange={set('date')} required />
        </label>
        <label className="field">
          <span>Seats</span>
          <select className="input" value={form.seats} onChange={set('seats')}>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {error && <p className="field error" style={{ gridColumn: '1 / -1', margin: 0 }}>{error}</p>}
        <datalist id="byt-cities">
          {cities.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>
      <div className="ticket-stub">
        <button className="btn lg block" type="submit">
          <FiSearch aria-hidden="true" /> Search
        </button>
        <small style={{ color: 'var(--ink)', textAlign: 'center' }}>Live fares and seat counts</small>
      </div>
    </form>
  );
}
