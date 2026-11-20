import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { FiAlertTriangle, FiCheck, FiRefreshCw } from 'react-icons/fi';
import SeatMap from '../components/SeatMap';
import { PassengerFields, PaymentFields, paymentPayload } from '../components/FormBits';
import { Spinner } from '../components/ui';
import { api, errorCode, errorMessage, newIdempotencyKey } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { ModeChip } from '../utils/modes';
import { duration, inr, prettyDate } from '../utils/format';

const STEPS = ['Seats', 'Passengers', 'Payment'];

function Steps({ current }) {
  return (
    <ol className="steps">
      {STEPS.map((s, i) => (
        <li key={s} className={i < current ? 'done' : i === current ? 'current' : ''} aria-current={i === current ? 'step' : undefined}>
          <i>{i < current ? <FiCheck /> : i + 1}</i>
          {s}
        </li>
      ))}
    </ol>
  );
}

export function TicketConfirmation({ booking }) {
  const t = booking.trip;
  return (
    <article className="ticket confirm-ticket">
      <div className="ticket-main stack">
        <div className="row">
          <span className="badge ok">Confirmed</span>
          <ModeChip mode={t.mode} />
          <span className="muted">{booking.provider?.companyName}</span>
        </div>
        <div className="trip-ticket" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 22, alignItems: 'center' }}>
          <div className="time-block">
            <b>{t.departureTime}</b>
            <span>{t.source}</span>
          </div>
          <div className="route-line">
            <span>{duration(t.durationMinutes)}</span>
          </div>
          <div className="time-block end">
            <b>{t.arrivalTime}</b>
            <span>{t.destination}</span>
          </div>
        </div>
        <div className="kv">
          <div>
            <span>Date</span>
            <b>{prettyDate(booking.travelDate, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}</b>
          </div>
          <div>
            <span>Seats</span>
            <b>{booking.seatNumbers.join(', ')}</b>
          </div>
          <div>
            <span>Paid</span>
            <b>{inr(booking.amountPaid)}</b>
          </div>
        </div>
        <div className="kv">
          {booking.passengers.map((p) => (
            <div key={p.seatNumber}>
              <span>Seat {p.seatNumber}</span>
              <b>
                {p.name}, {p.age}
              </b>
            </div>
          ))}
        </div>
      </div>
      <div className="ticket-stub">
        <small style={{ color: 'rgba(255,255,255,.7)' }}>PNR</small>
        <div className="pnr">{booking.pnr}</div>
        <div className="barcode" aria-hidden="true" />
      </div>
    </article>
  );
}

export default function Checkout() {
  const { tripId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const date = params.get('date');
  const wanted = Math.min(6, Math.max(1, Number(params.get('seats') || 1)));

  const [map, setMap] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState([]);
  const [passengers, setPassengers] = useState([]);
  const [payment, setPayment] = useState({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const [booking, setBooking] = useState(null);
  // One key per checkout attempt: retries / double clicks can never create two bookings.
  const idemKey = useRef(newIdempotencyKey());

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/trips/${tripId}/seats?date=${date}`);
      setMap(data);
      setSelected((s) => s.filter((n) => !data.bookedSeats.includes(n)));
      return data;
    } catch (err) {
      setLoadError(errorMessage(err));
      return null;
    }
  }, [tripId, date]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleSeat = (n) => {
    setProblem(null);
    setSelected((s) => (s.includes(n) ? s.filter((x) => x !== n) : s.length >= 6 ? s : [...s, n]));
  };

  const toPassengers = () => {
    setPassengers((prev) =>
      selected.map((_, i) => prev[i] || (i === 0 ? { name: user?.name || '', age: '', gender: '' } : { name: '', age: '', gender: '' })),
    );
    setStep(1);
  };

  const pay = async (e) => {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const { data } = await api.post(
        '/bookings',
        {
          tripId,
          date,
          seatNumbers: selected,
          passengers: passengers.map((p) => ({ name: p.name.trim(), age: Number(p.age), gender: p.gender })),
          payment: paymentPayload(payment),
          quotedPerSeat: map.trip.fare.perSeat,
        },
        { headers: { 'Idempotency-Key': idemKey.current } },
      );
      setBooking(data.booking);
      toast.success(`Booked. Your PNR is ${data.booking.pnr}`);
      window.scrollTo({ top: 0 });
    } catch (err) {
      const code = errorCode(err);
      if (code === 'SEAT_UNAVAILABLE') {
        const taken = err.response.data.details?.seats || [];
        await load();
        setSelected((s) => s.filter((n) => !taken.includes(n)));
        setStep(0);
        setProblem({ type: 'seat', message: `Seat ${taken.join(', ')} was just booked by another traveller. Pick a replacement.` });
      } else if (code === 'PRICE_CHANGED') {
        const fresh = await load();
        setProblem({ type: 'price', message: `The fare changed to ${inr(fresh?.trip.fare.perSeat)} per seat while you were booking. Review the new total and pay again.` });
      } else if (code === 'PAYMENT_DECLINED') {
        setProblem({ type: 'pay', message: errorMessage(err) });
        idemKey.current = newIdempotencyKey();
      } else {
        setProblem({ type: 'other', message: errorMessage(err) });
      }
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <div className="container page">
        <div className="notice bad">
          <FiAlertTriangle /> {loadError}
        </div>
        <Link to="/" className="btn ghost">
          Back to search
        </Link>
      </div>
    );
  }
  if (!map) return <Spinner />;

  const trip = map.trip;
  const total = trip.fare.perSeat * selected.length;

  if (booking) {
    return (
      <div className="container page" style={{ maxWidth: 860 }}>
        <div className="page-head">
          <div>
            <h1>You are going to {trip.destination}</h1>
            <p className="muted">Show the PNR at boarding. You can change the date or cancel from My trips.</p>
          </div>
        </div>
        <TicketConfirmation booking={booking} />
        <div className="row" style={{ marginTop: 24 }}>
          <Link className="btn" to="/trips">
            Go to my trips
          </Link>
          <Link className="btn ghost" to="/">
            Book another trip
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <h1>
            {trip.source} → {trip.destination}
          </h1>
          <p className="muted">
            {trip.provider?.companyName}, {prettyDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}, departs {trip.departureTime}
          </p>
        </div>
      </div>
      <Steps current={step} />
      {problem && (
        <div className={`notice ${problem.type === 'price' ? '' : 'bad'}`} role="alert">
          <FiAlertTriangle />
          <span>{problem.message}</span>
        </div>
      )}
      <div className="checkout">
        <section className="panel">
          {step === 0 && (
            <>
              <div className="spread" style={{ marginBottom: 16 }}>
                <div>
                  <h3>Choose {wanted > 1 ? `${wanted} seats` : 'your seat'}</h3>
                  <p className="muted" style={{ margin: 0 }}>
                    {map.capacity - map.bookedSeats.length} of {map.capacity} seats free. Up to 6 per booking.
                  </p>
                </div>
                <button className="btn quiet sm" onClick={load}>
                  <FiRefreshCw aria-hidden="true" /> Refresh
                </button>
              </div>
              <SeatMap mode={trip.mode} capacity={map.capacity} booked={map.bookedSeats} selected={selected} onToggle={toggleSeat} />
              <div className="spread" style={{ marginTop: 24 }}>
                <span className="muted">{selected.length ? `Selected: ${selected.join(', ')}` : 'Tap seats to select them'}</span>
                <button className="btn" disabled={!selected.length} onClick={toPassengers}>
                  Continue with {selected.length || ''} seat{selected.length === 1 ? '' : 's'}
                </button>
              </div>
            </>
          )}
          {step === 1 && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setStep(2);
              }}
            >
              <h3>Who is travelling?</h3>
              <p className="muted">Names must match an ID shown at boarding.</p>
              <PassengerFields passengers={passengers} seats={selected} onChange={setPassengers} />
              <div className="spread" style={{ marginTop: 20 }}>
                <button type="button" className="btn ghost" onClick={() => setStep(0)}>
                  Change seats
                </button>
                <button className="btn">Continue to payment</button>
              </div>
            </form>
          )}
          {step === 2 && (
            <form onSubmit={pay}>
              <h3>Pay {inr(total)}</h3>
              <p className="muted">This is a demo gateway: no real money moves.</p>
              <PaymentFields value={payment} onChange={setPayment} />
              <div className="spread" style={{ marginTop: 24 }}>
                <button type="button" className="btn ghost" onClick={() => setStep(1)}>
                  Edit passengers
                </button>
                <button className="btn marigold lg" disabled={busy}>
                  {busy ? 'Confirming seats…' : `Pay ${inr(total)}`}
                </button>
              </div>
            </form>
          )}
        </section>
        <aside className="panel summary" aria-label="Fare summary">
          <h3>Fare summary</h3>
          <ModeChip mode={trip.mode} />
          <dl>
            <dt>Base fare</dt>
            <dd>{inr(trip.fare.basePrice)}</dd>
            {trip.fare.breakdown.map((b) => (
              <FragmentRow key={b.rule} label={b.label} value={`× ${b.factor}`} />
            ))}
            <dt>Fare per seat</dt>
            <dd>{inr(trip.fare.perSeat)}</dd>
            <dt>Seats</dt>
            <dd>{selected.length || 0}</dd>
          </dl>
          <div className="spread total">
            <span>Total</span>
            <span>{inr(total)}</span>
          </div>
          <p className="faint" style={{ marginTop: 12, fontSize: '0.85rem' }}>
            Free date change up to 48 hours before departure. Cancellation fees start at 10%.
          </p>
        </aside>
      </div>
    </div>
  );
}

function FragmentRow({ label, value }) {
  return (
    <>
      <dt style={{ fontSize: '0.85rem' }}>{label}</dt>
      <dd style={{ fontSize: '0.85rem', color: '#8a5800' }}>{value}</dd>
    </>
  );
}
