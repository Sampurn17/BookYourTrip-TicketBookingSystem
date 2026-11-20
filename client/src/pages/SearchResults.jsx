import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FiSearch } from 'react-icons/fi';
import SearchPanel from '../components/SearchPanel';
import TripTicket from '../components/TripTicket';
import { Empty } from '../components/ui';
import { api, errorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { ModeIcon } from '../utils/modes';
import { addDays, inr, prettyDate, relativeDay, todayIST } from '../utils/format';

const BUCKETS = [
  { id: 'early', label: 'Early', hint: '00-06', after: '00:00', before: '05:59' },
  { id: 'morning', label: 'Morning', hint: '06-12', after: '06:00', before: '11:59' },
  { id: 'afternoon', label: 'Afternoon', hint: '12-18', after: '12:00', before: '17:59' },
  { id: 'night', label: 'Night', hint: '18-24', after: '18:00', before: '23:59' },
];
const SORTS = [
  ['departure', 'Earliest departure'],
  ['price_asc', 'Lowest fare'],
  ['price_desc', 'Highest fare'],
  ['duration', 'Shortest journey'],
  ['seats', 'Most seats left'],
];

export default function SearchResults() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { role } = useAuth();
  const q = Object.fromEntries(params.entries());
  const date = q.date || addDays(todayIST(), 1);
  const seats = Number(q.seats || 1);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [modes, setModes] = useState([]);
  const [buckets, setBuckets] = useState([]);
  const [maxPrice, setMaxPrice] = useState(null);

  const sort = q.sort || 'departure';

  useEffect(() => {
    setData(null);
    setError('');
    const qs = new URLSearchParams({ date, seats: String(seats), sort });
    if (q.source) qs.set('source', q.source);
    if (q.destination) qs.set('destination', q.destination);
    api
      .get(`/trips/search?${qs}`)
      .then((r) => setData(r.data))
      .catch((err) => setError(errorMessage(err)));
  }, [q.source, q.destination, date, seats, sort]);

  const priceCeiling = useMemo(() => Math.max(0, ...(data?.trips || []).map((t) => t.fare.perSeat)), [data]);

  const trips = useMemo(() => {
    if (!data) return [];
    return data.trips.filter((t) => {
      if (modes.length && !modes.includes(t.mode)) return false;
      if (maxPrice !== null && t.fare.perSeat > maxPrice) return false;
      if (buckets.length && !buckets.some((id) => {
        const b = BUCKETS.find((x) => x.id === id);
        return t.departureTime >= b.after && t.departureTime <= b.before;
      })) return false;
      return true;
    });
  }, [data, modes, buckets, maxPrice]);

  const setParam = (k, v) => {
    const next = new URLSearchParams(params);
    next.set(k, v);
    setParams(next);
  };
  const toggle = (list, setList, v) => setList(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const onBook = (trip) => navigate(`/book/${trip._id}?date=${trip.date}&seats=${seats}`);
  const title = q.source || q.destination ? `${q.source || 'Anywhere'} → ${q.destination || 'Anywhere'}` : 'All departures';

  return (
    <div className="container page">
      <div style={{ marginBottom: 24 }}>
        <SearchPanel initial={{ source: q.source, destination: q.destination, date, seats }} />
      </div>
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          <p className="muted">
            {prettyDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}
            {data && `, ${trips.length} of ${data.count} trips shown`}
          </p>
        </div>
        <label className="field" style={{ minWidth: 220 }}>
          <span>Sort by</span>
          <select className="input" value={sort} onChange={(e) => setParam('sort', e.target.value)}>
            {SORTS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="date-strip" role="group" aria-label="Change date">
        {Array.from({ length: 7 }, (_, i) => addDays(todayIST(), i)).map((d) => (
          <button key={d} aria-pressed={d === date} onClick={() => setParam('date', d)}>
            {relativeDay(d)}
            <b>{prettyDate(d, { day: 'numeric', month: 'short' })}</b>
          </button>
        ))}
      </div>
      {role === 'provider' || role === 'admin' ? <div className="notice info">You are browsing as {role}. Log in with a customer account to book.</div> : null}
      <div className="results">
        <aside className="filter-rail" aria-label="Filters">
          <h4>Travel by</h4>
          <div className="stack">
            {['bus', 'train', 'flight'].map((m) => (
              <label className="check" key={m}>
                <input type="checkbox" checked={modes.includes(m)} onChange={() => toggle(modes, setModes, m)} />
                <ModeIcon mode={m} /> {m[0].toUpperCase() + m.slice(1)}
              </label>
            ))}
          </div>
          <h4>Departure time</h4>
          <div className="time-buckets">
            {BUCKETS.map((b) => (
              <button key={b.id} type="button" aria-pressed={buckets.includes(b.id)} onClick={() => toggle(buckets, setBuckets, b.id)}>
                {b.label}
                <small>{b.hint}</small>
              </button>
            ))}
          </div>
          {priceCeiling > 0 && (
            <>
              <h4>Max fare per seat</h4>
              <input
                type="range"
                min={0}
                max={priceCeiling}
                step={50}
                value={maxPrice ?? priceCeiling}
                onChange={(e) => setMaxPrice(Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--indigo)' }}
                aria-label="Maximum fare"
              />
              <div className="spread muted">
                <small>{inr(0)}</small>
                <strong>{inr(maxPrice ?? priceCeiling)}</strong>
              </div>
            </>
          )}
          {(modes.length || buckets.length || maxPrice !== null) && (
            <button
              className="btn quiet sm"
              style={{ marginTop: 14 }}
              onClick={() => {
                setModes([]);
                setBuckets([]);
                setMaxPrice(null);
              }}
            >
              Clear filters
            </button>
          )}
        </aside>
        <section className="stack" aria-live="polite">
          {error && <div className="notice bad">{error}</div>}
          {!data && !error && [0, 1, 2].map((i) => <div key={i} className="skeleton" />)}
          {data && trips.length === 0 && (
            <Empty icon={FiSearch} title="No trips match">
              {data.count ? 'Try removing a filter.' : 'Try another date or nearby city. Departures within 30 minutes are no longer sold.'}
            </Empty>
          )}
          {trips.map((t) => (
            <TripTicket key={t._id} trip={t} onBook={onBook} seatsWanted={seats} />
          ))}
        </section>
      </div>
    </div>
  );
}
