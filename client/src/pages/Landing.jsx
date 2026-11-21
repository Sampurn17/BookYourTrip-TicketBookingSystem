import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiShield, FiTrendingUp } from 'react-icons/fi';
import SearchPanel from '../components/SearchPanel';
import { api } from '../api/client';
import { ModeIcon } from '../utils/modes';
import { inr, todayIST, addDays, duration } from '../utils/format';

function DepartureBoard() {
  const [rows, setRows] = useState(null);
  const date = addDays(todayIST(), 1);
  useEffect(() => {
    api
      .get(`/trips/search?date=${date}&sort=departure`)
      .then((r) => setRows(r.data.trips.slice(0, 8)))
      .catch(() => setRows([]));
  }, [date]);

  if (rows && rows.length === 0) return null;
  return (
    <section style={{ marginTop: 56 }}>
      <div className="spread" style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>Leaving tomorrow</h2>
        <Link to={`/search?date=${date}`}>See all departures</Link>
      </div>
      <div className="board" role="table" aria-label="Departures tomorrow">
        <div className="board-row board-head" role="row">
          <span>Time</span>
          <span>Route</span>
          <span className="o">Operator</span>
          <span className="s">Seats</span>
          <span className="f">Fare</span>
        </div>
        {(rows || Array.from({ length: 4 }, () => null)).map((t, i) =>
          t ? (
            <Link key={t._id} className="board-row" role="row" to={`/book/${t._id}?date=${t.date}&seats=1`}>
              <span className="t">{t.departureTime}</span>
              <span className="r">
                {t.source} → {t.destination}
              </span>
              <span className="o">
                <ModeIcon mode={t.mode} size={15} /> {t.provider?.companyName}, {duration(t.durationMinutes)}
              </span>
              <span className="s">{t.availableSeats} left</span>
              <span className="f">{inr(t.fare.perSeat)}</span>
            </Link>
          ) : (
            <div key={i} className="board-row" role="row">
              <span className="t">--:--</span>
              <span className="r">Loading departures</span>
            </div>
          ),
        )}
      </div>
    </section>
  );
}

export default function Landing() {
  return (
    <>
      <section className="hero">
        <div className="container">
          <h1>Where to next?</h1>
          <p>Buses, trains and flights across India with live seat maps. The seat you pick is yours: nobody else can buy it at the same moment.</p>
          <div className="hero-modes">
            <span>
              <ModeIcon mode="bus" /> Buses
            </span>
            <span>
              <ModeIcon mode="train" /> Trains
            </span>
            <span>
              <ModeIcon mode="flight" /> Flights
            </span>
          </div>
        </div>
      </section>
      <div className="container search-dock">
        <SearchPanel />
      </div>
      <div className="container" style={{ paddingBottom: 96 }}>
        <DepartureBoard />
        <section className="how">
          <div>
            <h3>
              <FiShield /> Guaranteed seats
            </h3>
            <p className="muted">Seats are locked the instant you pay. Two travellers can never end up holding the same seat.</p>
          </div>
          <div>
            <h3>
              <FiTrendingUp /> Honest fares
            </h3>
            <p className="muted">Prices move with demand and how soon you travel. Every fare shows why it is higher or lower.</p>
          </div>
        </section>
      </div>
      <footer className="footer">
        <div className="container spread">
          <span>BookYourTrip</span>
          <span>
            Run a bus, train or airline? <Link to="/signup?role=provider">List your trips</Link>
          </span>
        </div>
      </footer>
    </>
  );
}
