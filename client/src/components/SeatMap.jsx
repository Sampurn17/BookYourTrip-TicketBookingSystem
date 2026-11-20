import { FiNavigation } from 'react-icons/fi';

const LAYOUT = {
  bus: { left: 2, right: 2 },
  train: { left: 3, right: 3 },
  flight: { left: 3, right: 3 },
};

/**
 * Vehicle-shaped seat picker. Seats are numbered row by row, left to right,
 * matching the numbering used by the API.
 */
export default function SeatMap({ mode = 'bus', capacity, booked = [], selected = [], mine = [], onToggle, readOnly = false }) {
  const { left, right } = LAYOUT[mode] || LAYOUT.bus;
  const perRow = left + right;
  const bookedSet = new Set(booked);
  const selectedSet = new Set(selected);
  const mineSet = new Set(mine);
  const rows = Math.ceil(capacity / perRow);

  const seat = (n) => {
    if (n > capacity) return <span key={n} style={{ width: 40 }} />;
    const isMine = mineSet.has(n);
    const isBooked = bookedSet.has(n) && !isMine;
    const isSelected = selectedSet.has(n);
    const cls = isMine ? 'mine' : isSelected ? 'selected' : isBooked ? 'booked' : '';
    const label = `Seat ${n}${isBooked ? ', booked' : isSelected ? ', selected' : ', available'}`;
    return (
      <button
        key={n}
        type="button"
        className={`seat ${cls}`}
        disabled={readOnly || isBooked}
        aria-pressed={isSelected}
        aria-label={label}
        onClick={() => onToggle?.(n)}
      >
        {n}
      </button>
    );
  };

  return (
    <div>
      <div className={`vehicle ${mode}`}>
        <div className="vehicle-front">
          Front <FiNavigation aria-hidden="true" />
        </div>
        <div className="seat-rows">
          {Array.from({ length: rows }, (_, r) => {
            const base = r * perRow;
            return (
              <div key={r} className="seat-row">
                <span className="row-no">{r + 1}</span>
                {Array.from({ length: left }, (_, i) => seat(base + i + 1))}
                <span className="aisle" />
                {Array.from({ length: right }, (_, i) => seat(base + left + i + 1))}
              </div>
            );
          })}
        </div>
      </div>
      <div className="seat-legend">
        <span>
          <i className="seat" /> Available
        </span>
        <span>
          <i className="seat selected" /> {readOnly ? 'Highlighted' : 'Your pick'}
        </span>
        <span>
          <i className="seat booked" /> Booked
        </span>
      </div>
    </div>
  );
}
