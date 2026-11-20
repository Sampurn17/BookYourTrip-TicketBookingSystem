# BookYourTrip

Ticket booking for buses, trains and flights: customers, operators (providers) and admins, with seat-level booking that can't be double-sold, dynamic pricing and a tool-calling AI assistant.

```
server/   Express 5 + MongoDB (Mongoose) API, Jest tests, seed / load / race scripts
client/   React 18 + Vite single-page app
```

## Run locally

Requires Node 18+ and a MongoDB URI (Atlas free tier recommended: it is a replica set, so transactions are used).

```bash
# API
cd server
cp .env.example .env          # set MONGO_URI, JWT_SECRET, optionally OPENAI_API_KEY
npm install
npm run seed                  # demo data + accounts (printed at the end)
npm run dev                   # http://localhost:5000

# Web app (second terminal)
cd client
npm install
npm run dev                   # http://localhost:5173 (proxies /api to :5000)
```

Demo logins after seeding: `aarav@example.com` / `Password@123` (customer), `zing@bookyourtrip.com` / `Password@123` (operator), `admin@bookyourtrip.com` / `Admin@123` (admin).

Without `OPENAI_API_KEY` the assistant runs in offline mode (deterministic intent router driving the same tools). Any OpenAI-compatible endpoint works via `OPENAI_BASE_URL` + `OPENAI_MODEL`.

## Tests

```bash
cd server
npm test               # unit + integration (downloads an in-memory MongoDB on first run)
npm run test:unit      # fast, no database
npm run test:coverage  # HTML report in server/coverage/
```

## Load and concurrency checks (against a running, seeded server)

```bash
# start the API with DISABLE_RATE_LIMIT=true, then:
npm run race                               # 50 customers, same seat -> exactly 1 booking
USERS=100 BOOKINGS=300 npm run load        # NFR: 100 users / 250+ bookings, ends with an integrity check
```

## Deploy (single EC2 / Elastic Beanstalk instance)

```bash
cd client && npm install && npm run build      # outputs client/dist
cd ../server && npm install --omit=dev
NODE_ENV=production SERVE_CLIENT=true node src/server.js   # serves API + built app on PORT
```
