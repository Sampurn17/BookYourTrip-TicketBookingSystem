import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiCalendar, FiEdit2, FiXCircle } from 'react-icons/fi';
import { Empty, Modal, Spinner, StatusBadge } from '../components/ui';
import { PassengerFields, PaymentFields, paymentPayload } from '../components/FormBits';
import { api, errorMessage } from '../api/client';
import { useToast } from '../context/ToastContext';
import { ModeChip } from '../utils/modes';
import { addDays, inr, prettyDate, todayIST, GENDER_LABEL } from '../utils/format';

const TABS = [
  ['upcoming', 'Upcoming'],
  ['past', 'Completed'],
  ['cancelled', 'Cancelled'],
];

function CancelModal({ booking, onClose, onDone }) {
  const toast = useToast();
  const [quote, setQuote] = useState(null);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get(`/bookings/${booking._id}/cancel-quote`)
      .then((r) => setQuote(r.data.quote))
      .catch((err) => setError(errorMessage(err)));
  }, [booking._id]);

  const confirm = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/bookings/${booking._id}/cancel`, { reason: reason || undefined });
      toast.success(data.refund ? `Cancelled. ${inr(data.refund)} will be refunded.` : 'Cancelled.');
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Cancel ${booking.pnr}?`}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Keep booking
          </button>
          <button className="btn danger" disabled={!quote?.allowed || busy} onClick={confirm}>
            {busy ? 'Cancelling…' : 'Cancel booking'}
          </button>
        </>
      }
    >
      {error && <div className="notice bad">{error}</div>}
      {!quote && !error && <Spinner />}
      {quote && !quote.allowed && <div className="notice bad">{quote.reason}</div>}
      {quote?.allowed && (
        <>
          <p className="muted">
            {booking.trip.source} → {booking.trip.destination} on {prettyDate(booking.travelDate)}. All {booking.seatNumbers.length} seat(s) are released.
          </p>
          <dl className="quote">
            <dt>Ticket fare</dt>
            <dd>{inr(quote.farePaid)}</dd>
            <dt>Cancellation fee ({quote.feePct}%)</dt>
            <dd>−{inr(quote.fee)}</dd>
            <dt className="big">Refund</dt>
            <dd className="big">{inr(quote.refund)}</dd>
          </dl>
          <p className="faint">{quote.tier}</p>
          <label className="field">
            <span>Reason (optional)</span>
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
          </label>
        </>
      )}
    </Modal>
  );
}

function RescheduleModal({ booking, onClose, onDone }) {
  const toast = useToast();
  const [newDate, setNewDate] = useState('');
  const [quote, setQuote] = useState(null);
  const [error, setError] = useState('');
  const [payment, setPayment] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!newDate) return;
    setQuote(null);
    setError('');
    api
      .post(`/bookings/${booking._id}/reschedule-quote`, { newDate })
      .then((r) => setQuote(r.data.quote))
      .catch((err) => setError(errorMessage(err)));
  }, [newDate, booking._id]);

  const confirm = async () => {
    setBusy(true);
    try {
      const body = { newDate };
      if (quote.amountDue > 0) body.payment = paymentPayload(payment);
      const { data } = await api.post(`/bookings/${booking._id}/reschedule`, body);
      toast.success(`Moved to ${prettyDate(data.booking.travelDate)}, seats ${data.booking.seatNumbers.join(', ')}`);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Change travel date"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Close
          </button>
          <button className="btn" disabled={!quote || busy} onClick={confirm}>
            {busy ? 'Moving…' : quote?.amountDue ? `Pay ${inr(quote.amountDue)} and move` : 'Move booking'}
          </button>
        </>
      }
    >
      <p className="muted">
        {booking.pnr}: {booking.trip.source} → {booking.trip.destination}, currently {prettyDate(booking.travelDate)}.
      </p>
      <label className="field">
        <span>New date</span>
        <input className="input" type="date" min={todayIST()} max={addDays(todayIST(), 60)} value={newDate} onChange={(e) => setNewDate(e.target.value)} />
      </label>
      {error && (
        <div className="notice bad" style={{ marginTop: 14 }}>
          {error}
        </div>
      )}
      {quote && (
        <>
          <dl className="quote">
            <dt>Change fee ({quote.feePct}%)</dt>
            <dd>{inr(quote.fee)}</dd>
            <dt>Fare difference</dt>
            <dd>{inr(quote.fareDifference)}</dd>
            <dt>New seats</dt>
            <dd>
              {quote.seats.join(', ')}
              {quote.keepsSeats ? ' (same as now)' : ''}
            </dd>
            <dt className="big">To pay</dt>
            <dd className="big">{inr(quote.amountDue)}</dd>
          </dl>
          {quote.amountDue > 0 && <PaymentFields value={payment} onChange={setPayment} />}
        </>
      )}
    </Modal>
  );
}

function PassengersModal({ booking, onClose, onDone }) {
  const toast = useToast();
  const [passengers, setPassengers] = useState(booking.passengers.map(({ name, age, gender }) => ({ name, age, gender })));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch(`/bookings/${booking._id}/passengers`, { passengers: passengers.map((p) => ({ ...p, age: Number(p.age) })) });
      toast.success('Passenger details saved');
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal title="Edit passengers" onClose={onClose} wide>
      <form onSubmit={save}>
        {error && <div className="notice bad">{error}</div>}
        <PassengerFields passengers={passengers} seats={booking.seatNumbers} onChange={setPassengers} />
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Discard
          </button>
          <button className="btn" disabled={busy}>
            {busy ? 'Saving…' : 'Save passengers'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function BookingTicket({ b, onAction }) {
  const t = b.trip || {};
  const cancelled = b.status === 'cancelled';
  return (
    <article className={`ticket booking${cancelled ? ' is-cancelled' : ''}`}>
      <div className="ticket-main">
        <div className="row">
          <StatusBadge status={b.status} />
          <ModeChip mode={t.mode} />
          <span className="muted">{b.provider?.companyName}</span>
        </div>
        <div className="booking-route">
          <h3>
            {t.source} → {t.destination}
          </h3>
          <span className="muted">
            {prettyDate(b.travelDate, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}, {t.departureTime} to {t.arrivalTime}
          </span>
        </div>
        <div className="kv">
          <div>
            <span>Seats</span>
            <b>{b.seatNumbers.join(', ')}</b>
          </div>
          <div>
            <span>Passengers</span>
            <b>{b.passengers.map((p) => `${p.name} (${p.age}, ${GENDER_LABEL[p.gender]})`).join('; ')}</b>
          </div>
        </div>
        {(b.totalPenalty > 0 || b.originalTravelDate !== b.travelDate || cancelled) && (
          <div className="kv">
            {b.originalTravelDate && b.originalTravelDate !== b.travelDate && (
              <div>
                <span>Originally</span>
                <b>{prettyDate(b.originalTravelDate)}</b>
              </div>
            )}
            {b.totalPenalty > 0 && (
              <div>
                <span>Fees charged</span>
                <b>{inr(b.totalPenalty)}</b>
              </div>
            )}
            {cancelled && (
              <div>
                <span>Refunded</span>
                <b>{inr(b.refundAmount)}</b>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="ticket-stub">
        <small className="faint">PNR</small>
        <strong style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', letterSpacing: '0.04em' }}>{b.pnr}</strong>
        <span className="muted">Paid {inr(b.amountPaid)}</span>
        {b.isUpcoming && (
          <div className="stack">
            <button className="btn sm ghost block" onClick={() => onAction('reschedule', b)}>
              <FiCalendar aria-hidden="true" /> Change date
            </button>
            <button className="btn sm ghost block" onClick={() => onAction('passengers', b)}>
              <FiEdit2 aria-hidden="true" /> Edit passengers
            </button>
            <button className="btn sm quiet block" style={{ color: 'var(--red)' }} onClick={() => onAction('cancel', b)}>
              <FiXCircle aria-hidden="true" /> Cancel
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

export default function MyTrips() {
  const [tab, setTab] = useState('upcoming');
  const [bookings, setBookings] = useState(null);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);

  const load = useCallback(() => {
    setError('');
    api
      .get(`/bookings?scope=${tab}`)
      .then((r) => setBookings(r.data.bookings))
      .catch((err) => setError(errorMessage(err)));
  }, [tab]);

  useEffect(() => {
    setBookings(null);
    load();
  }, [load]);

  useEffect(() => {
    window.addEventListener('byt:bookings-changed', load);
    return () => window.removeEventListener('byt:bookings-changed', load);
  }, [load]);

  const done = () => {
    setModal(null);
    load();
  };

  return (
    <div className="container page" style={{ maxWidth: 980 }}>
      <div className="page-head">
        <div>
          <h1>My trips</h1>
          <p className="muted">Change dates, update passengers or cancel up to departure.</p>
        </div>
        <div className="segmented" role="tablist">
          {TABS.map(([id, label]) => (
            <button key={id} role="tab" aria-pressed={tab === id} aria-selected={tab === id} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {error && <div className="notice bad">{error}</div>}
      {!bookings && !error && <Spinner />}
      {bookings?.length === 0 && (
        <Empty icon={FiCalendar} title={tab === 'upcoming' ? 'No upcoming trips' : tab === 'past' ? 'No completed trips yet' : 'Nothing cancelled'} action={tab === 'upcoming' && <Link className="btn" to="/">Find a trip</Link>}>
          {tab === 'upcoming' ? 'Trips you book show up here with their PNR.' : null}
        </Empty>
      )}
      <div className="stack">
        {bookings?.map((b) => (
          <BookingTicket key={b._id} b={b} onAction={(type, booking) => setModal({ type, booking })} />
        ))}
      </div>
      {modal?.type === 'cancel' && <CancelModal booking={modal.booking} onClose={() => setModal(null)} onDone={done} />}
      {modal?.type === 'reschedule' && <RescheduleModal booking={modal.booking} onClose={() => setModal(null)} onDone={done} />}
      {modal?.type === 'passengers' && <PassengersModal booking={modal.booking} onClose={() => setModal(null)} onDone={done} />}
    </div>
  );
}
