import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import SeatMap from '../../components/SeatMap';
import { Empty, Spinner, StatusBadge } from '../../components/ui';
import { addDays, inr, prettyDate, todayIST, GENDER_LABEL } from '../../utils/format';

export default function Manifest() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const date = params.get('date') || todayIST();
  const [m, setM] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setM(null);
    setError('');
    api
      .get(`/provider/trips/${id}/manifest?date=${date}`)
      .then((r) => setM(r.data.manifest))
      .catch((err) => setError(errorMessage(err)));
  }, [id, date]);

  return (
    <div className="container page">
      <Link to="/provider/trips">Back to trips</Link>
      {error && <div className="notice bad" style={{ marginTop: 16 }}>{error}</div>}
      {!m && !error && <Spinner />}
      {m && (
        <>
          <div className="page-head" style={{ marginTop: 12 }}>
            <div>
              <h1>
                {m.trip.source} → {m.trip.destination}
              </h1>
              <p className="muted">
                {prettyDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}, departs {m.trip.departureTime}. {m.bookedSeats} of {m.capacity} seats sold ({m.occupancy}%), revenue {inr(m.revenue)}.
              </p>
            </div>
            <label className="field">
              <span>Date</span>
              <input className="input" type="date" min={addDays(todayIST(), -30)} value={date} onChange={(e) => setParams({ date: e.target.value })} />
            </label>
          </div>
          <div className="checkout">
            <section className="stack">
              {m.passengers.length === 0 ? (
                <Empty title="No passengers yet">Bookings for this departure will appear here.</Empty>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Seat</th>
                        <th>Passenger</th>
                        <th>PNR</th>
                        <th>Booked by</th>
                      </tr>
                    </thead>
                    <tbody>
                      {m.passengers.map((p) => (
                        <tr key={`${p.pnr}-${p.seatNumber}`}>
                          <td>
                            <strong>{p.seatNumber}</strong>
                          </td>
                          <td>
                            {p.name}
                            <div className="faint" style={{ fontSize: '0.85rem' }}>
                              {p.age}, {GENDER_LABEL[p.gender]}
                            </div>
                          </td>
                          <td>{p.pnr}</td>
                          <td>
                            {p.bookedBy}
                            <div className="faint" style={{ fontSize: '0.85rem' }}>
                              {p.contactPhone || p.contactEmail}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {m.bookings.some((b) => b.status === 'cancelled') && (
                <p className="muted">
                  Cancelled on this date:{' '}
                  {m.bookings
                    .filter((b) => b.status === 'cancelled')
                    .map((b) => b.pnr)
                    .join(', ')}{' '}
                  <StatusBadge status="cancelled" />
                </p>
              )}
            </section>
            <aside className="panel">
              <h3>Seat chart</h3>
              <SeatMap mode={m.trip.mode} capacity={m.capacity} selected={m.passengers.map((p) => p.seatNumber)} readOnly />
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
