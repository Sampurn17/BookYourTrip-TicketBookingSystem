import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiMessageCircle, FiX, FiSend, FiCompass } from 'react-icons/fi';
import { api, errorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { inr, prettyDate } from '../utils/format';
import { ModeIcon } from '../utils/modes';

const SUGGESTIONS = {
  guest: ['Buses from Delhi to Jaipur tomorrow', 'Cheapest flight Mumbai to Goa on Friday', 'What is the cancellation policy?'],
  customer: ['Show my upcoming bookings', 'Trains from Kanpur to Delhi next Monday', 'What is the cancellation policy?'],
  provider: ['How is my fleet doing this week?', 'Give me pricing recommendations', 'Flights from Delhi to Mumbai tomorrow'],
  admin: ['Platform stats', 'Pending providers', 'Run integrity check'],
};

const GREETING = {
  guest: 'Hi, I am Yatra. Tell me where you want to go and when, and I will find live fares.',
  customer: 'Hi! I can find and start bookings, and cancel or reschedule your trips after you confirm.',
  provider: 'Hi! Ask me about your occupancy, revenue or which fares to change.',
  admin: 'Hi! I can summarise the platform, list operators awaiting approval and verify booking integrity.',
};

export const bookingsChanged = () => window.dispatchEvent(new Event('byt:bookings-changed'));

function TripsCard({ card, onBook }) {
  if (!card.trips?.length) return null;
  return card.trips.map((t) => (
    <div className="mini-trip" key={t.tripId}>
      <div>
        <b>
          {t.departureTime} {t.source} → {t.destination}
        </b>
      </div>
      <button className="btn sm" onClick={() => onBook(t)}>
        Book
      </button>
      <div className="muted">
        <ModeIcon mode={t.mode} size={14} /> {t.operator}, {inr(t.pricePerSeat)}, {t.availableSeats} left
      </div>
    </div>
  ));
}

function ActionCard({ action, onRun, state }) {
  if (state === 'done') return <div className="action-card">Done.</div>;
  if (action.type === 'open_checkout') {
    return (
      <div className="action-card">
        {action.label}
        <div className="row">
          <button className="btn sm" onClick={() => onRun(action)}>
            Continue to checkout
          </button>
        </div>
      </div>
    );
  }
  const verb = action.type === 'cancel_booking' ? 'Confirm cancellation' : 'Confirm new date';
  return (
    <div className="action-card">
      {action.type === 'cancel_booking'
        ? `Cancel ${action.payload.pnr}. You get ${inr(action.payload.refund)} back.`
        : `Move ${action.payload.pnr} to ${prettyDate(action.payload.newDate)}. ${action.payload.amountDue > 0 ? `${inr(action.payload.amountDue)} will be charged to your demo UPI.` : 'No extra charge.'}`}
      <div className="row">
        <button className={`btn sm ${action.type === 'cancel_booking' ? 'danger' : ''}`} disabled={state === 'busy'} onClick={() => onRun(action)}>
          {state === 'busy' ? 'Working…' : verb}
        </button>
      </div>
    </div>
  );
}

export default function AgentChat() {
  const { role, user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionState, setActionState] = useState({});
  const bodyRef = useRef(null);

  useEffect(() => {
    setMessages([{ role: 'assistant', content: GREETING[role] }]);
    setActionState({});
  }, [role, user?._id]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy, open]);

  async function send(text) {
    const content = text.trim();
    if (!content || busy) return;
    const next = [...messages, { role: 'user', content }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const history = next.slice(-12).map((m) => ({ role: m.role, content: m.content }));
      const { data } = await api.post('/agent/chat', { messages: history });
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: data.notice ? `${data.reply}\n\n(${data.notice})` : data.reply, cards: data.cards, actions: data.actions, mode: data.mode },
      ]);
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', content: errorMessage(err, 'The assistant is unavailable right now.') }]);
    } finally {
      setBusy(false);
    }
  }

  async function runAction(action, key) {
    if (action.type === 'open_checkout') {
      const { tripId, date, seats } = action.payload;
      navigate(`/book/${tripId}?date=${date}&seats=${seats}`);
      setOpen(false);
      return;
    }
    setActionState((s) => ({ ...s, [key]: 'busy' }));
    try {
      let reply;
      if (action.type === 'cancel_booking') {
        const { data } = await api.post(`/bookings/${action.payload.bookingId}/cancel`, { reason: action.payload.reason || 'Cancelled via assistant' });
        reply = `Cancelled ${action.payload.pnr}. A refund of ${inr(data.refund)} is on its way.`;
      } else {
        const payment = action.payload.amountDue > 0 ? { method: 'upi', upiId: 'traveller@okaxis' } : undefined;
        const { data } = await api.post(`/bookings/${action.payload.bookingId}/reschedule`, { newDate: action.payload.newDate, payment });
        reply = `Moved ${action.payload.pnr} to ${prettyDate(data.booking.travelDate)}, seats ${data.booking.seatNumbers.join(', ')}.${data.amountCharged ? ` Charged ${inr(data.amountCharged)}.` : ''}`;
      }
      setActionState((s) => ({ ...s, [key]: 'done' }));
      setMessages((m) => [...m, { role: 'assistant', content: reply }]);
      bookingsChanged();
    } catch (err) {
      setActionState((s) => ({ ...s, [key]: undefined }));
      setMessages((m) => [...m, { role: 'assistant', content: errorMessage(err) }]);
    }
  }

  const bookTrip = (t) => {
    navigate(`/book/${t.tripId}?date=${t.date}&seats=1`);
    setOpen(false);
  };

  if (!open) {
    return (
      <button className="agent-fab" onClick={() => setOpen(true)} aria-label="Open travel assistant">
        <FiMessageCircle size={20} /> Ask Yatra
      </button>
    );
  }

  const lastMode = [...messages].reverse().find((m) => m.mode)?.mode;

  return (
    <section className="agent" aria-label="Travel assistant">
      <header className="agent-head">
        <span className="agent-avatar">
          <FiCompass size={18} />
        </span>
        <div>
          <strong>Yatra</strong>
          <small>{lastMode === 'offline' ? 'Offline mode: rule-based answers' : 'AI travel assistant'}</small>
        </div>
        <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close assistant">
          <FiX size={20} />
        </button>
      </header>
      <div className="agent-body" ref={bodyRef}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: 'contents' }}>
            <div className={`msg ${m.role === 'user' ? 'user' : 'bot'}`}>{m.content}</div>
            {(m.cards?.length > 0 || m.actions?.length > 0) && (
              <div className="msg-extra">
                {m.cards?.filter((c) => c.type === 'trips').map((c, j) => <TripsCard key={`c${j}`} card={c} onBook={bookTrip} />)}
                {m.actions?.map((a, j) => (
                  <ActionCard key={`a${j}`} action={a} state={actionState[`${i}-${j}`]} onRun={(act) => runAction(act, `${i}-${j}`)} />
                ))}
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div className="msg bot" aria-label="Assistant is typing">
            <span className="typing">
              <i />
              <i />
              <i />
            </span>
          </div>
        )}
      </div>
      {messages.length <= 2 && (
        <div className="agent-chips">
          {SUGGESTIONS[role].map((s) => (
            <button key={s} onClick={() => send(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
      <form
        className="agent-input"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about trips, fares or your bookings" aria-label="Message" maxLength={2000} />
        <button className="btn" type="submit" disabled={busy || !input.trim()} aria-label="Send">
          <FiSend />
        </button>
      </form>
    </section>
  );
}
