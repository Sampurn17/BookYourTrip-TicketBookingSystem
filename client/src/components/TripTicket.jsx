import { ModeChip, ModeIcon } from '../utils/modes';
import { inr, duration, isOvernight } from '../utils/format';

export default function TripTicket({ trip, onBook, seatsWanted = 1 }) {
  const low = trip.availableSeats <= 5;
  const surge = trip.fare.multiplier > 1;
  return (
    <article className="ticket trip-ticket">
      <div className="ticket-main">
        <div className="trip-op">
          <strong>{trip.provider?.companyName}</strong>
          <ModeChip mode={trip.mode} />
          {trip.serviceName && <span className="faint">{trip.serviceName}</span>}
          {trip.provider?.rating > 0 && <span className="badge neutral">★ {trip.provider.rating.toFixed(1)}</span>}
        </div>
        <div className="time-block">
          <b>{trip.departureTime}</b>
          <span>{trip.source}</span>
        </div>
        <div className="route-line">
          <span>
            <ModeIcon mode={trip.mode} size={16} />
            {duration(trip.durationMinutes)}
          </span>
        </div>
        <div className="time-block end">
          <b>{trip.arrivalTime}</b>
          <span>
            {trip.destination}
            {isOvernight(trip.departureTime, trip.arrivalTime) && ' (+1 day)'}
          </span>
        </div>
        {trip.amenities?.length > 0 && (
          <div className="trip-meta">
            {trip.amenities.map((a) => (
              <span key={a} className="amenity">
                {a}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="ticket-stub">
        <div>
          {surge && <div className="price-was">{inr(trip.basePrice)}</div>}
          <div className="price">
            {inr(trip.fare.perSeat)} <small>per seat</small>
          </div>
        </div>
        <div className={`seats-left${low ? ' low' : ''}`}>
          {trip.availableSeats === 0 ? 'Sold out' : `${trip.availableSeats} of ${trip.totalSeats} seats left`}
        </div>
        {trip.fare.breakdown?.length > 0 && <div className="fare-why">{trip.fare.breakdown.map((b) => b.label).join('; ')}</div>}
        <button className="btn block" disabled={trip.availableSeats < seatsWanted} onClick={() => onBook(trip)}>
          Select seats
        </button>
      </div>
    </article>
  );
}
