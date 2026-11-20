import { useEffect } from 'react';

export function PassengerFields({ passengers, seats, onChange }) {
  const update = (i, key, value) => onChange(passengers.map((p, idx) => (idx === i ? { ...p, [key]: value } : p)));
  return (
    <div>
      {passengers.map((p, i) => (
        <div className="passenger-row" key={i}>
          <div className="seat-tag">Seat {seats[i]}</div>
          <label className="field">
            <span>Full name</span>
            <input className="input" value={p.name} onChange={(e) => update(i, 'name', e.target.value)} required minLength={2} maxLength={60} />
          </label>
          <label className="field">
            <span>Age</span>
            <input className="input" type="number" min={0} max={120} value={p.age} onChange={(e) => update(i, 'age', e.target.value)} required />
          </label>
          <label className="field">
            <span>Gender</span>
            <select className="input" value={p.gender} onChange={(e) => update(i, 'gender', e.target.value)} required>
              <option value="">Select</option>
              <option value="F">Female</option>
              <option value="M">Male</option>
              <option value="O">Other</option>
            </select>
          </label>
        </div>
      ))}
    </div>
  );
}

const METHODS = [
  { id: 'upi', label: 'UPI' },
  { id: 'card', label: 'Card' },
  { id: 'netbanking', label: 'Net banking' },
  { id: 'wallet', label: 'Wallet' },
];

/** Dummy payment form. Card numbers ending 0000 and UPI id fail@upi are declined (to demo rollback). */
export function PaymentFields({ value, onChange }) {
  useEffect(() => {
    if (!value.method) onChange({ method: 'upi', upiId: 'traveller@okaxis' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const set = (patch) => onChange({ ...value, ...patch });
  return (
    <div>
      <div className="segmented pay-methods" role="group" aria-label="Payment method">
        {METHODS.map((m) => (
          <button
            type="button"
            key={m.id}
            aria-pressed={value.method === m.id}
            onClick={() =>
              onChange({ method: m.id, ...(m.id === 'upi' ? { upiId: 'traveller@okaxis' } : {}), ...(m.id === 'card' ? { cardNumber: '4111111111111111' } : {}) })
            }
          >
            {m.label}
          </button>
        ))}
      </div>
      {value.method === 'upi' && (
        <label className="field">
          <span>UPI ID</span>
          <input className="input" value={value.upiId || ''} onChange={(e) => set({ upiId: e.target.value.trim() })} required />
          <span className="hint">Demo gateway: use fail@upi to see a declined payment.</span>
        </label>
      )}
      {value.method === 'card' && (
        <div className="grid-2">
          <label className="field">
            <span>Card number</span>
            <input
              className="input"
              inputMode="numeric"
              value={value.cardNumber || ''}
              onChange={(e) => set({ cardNumber: e.target.value.replace(/\D/g, '').slice(0, 19) })}
              required
            />
            <span className="hint">Numbers ending in 0000 are declined.</span>
          </label>
          <div className="grid-2">
            <label className="field">
              <span>Expiry</span>
              <input className="input" placeholder="MM/YY" defaultValue="12/29" />
            </label>
            <label className="field">
              <span>CVV</span>
              <input className="input" placeholder="123" defaultValue="123" />
            </label>
          </div>
        </div>
      )}
      {(value.method === 'netbanking' || value.method === 'wallet') && (
        <p className="muted">You will be charged instantly through the demo {value.method === 'wallet' ? 'wallet' : 'bank'}.</p>
      )}
    </div>
  );
}

export const paymentPayload = (p) => {
  const out = { method: p.method };
  if (p.method === 'upi') out.upiId = p.upiId;
  if (p.method === 'card') out.cardNumber = p.cardNumber;
  return out;
};
