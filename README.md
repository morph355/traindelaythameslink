# traindelaythameslink

Checks whether a delayed Thameslink journey qualifies for Delay Repay,
using actual (not scheduled) train performance data - including
split-save tickets, where each ticket leg is assessed independently.

It also checks nearby alternative services' actual performance, so you
have evidence of whether a genuinely faster, undisrupted alternative
existed - useful if you've had claims pushed back with "you could have
taken an alternative".

See [`PLAN.md`](PLAN.md) for the design/architecture, and
[`BACKLOG.md`](BACKLOG.md) for progress. This does not submit claims for
you - Thameslink/GTR only expose a web form
(delayrepay.thameslinkrailway.com), no public API - it drafts the numbers
you need to submit one yourself within 28 days.

## Setup

1. Register for a free personal-use account at
   [api-portal.rtt.io](https://api-portal.rtt.io/) and grab your API
   username/password from your account page.
2. `npm install`
3. `cp .env.example .env` and fill in `RTT_USERNAME` / `RTT_PASSWORD`.
4. `npm run dev` (or `npm run build && npm start`).
5. Open http://localhost:3000, enter each leg of the delayed journey, and
   check eligibility.

## Testing

```
npm test
```

## Project layout

- `src/rtt/` — Realtime Trains API client and mapping to domain types
- `src/engine/` — pure delay/eligibility/alternatives-evidence logic
- `src/server/` — Express app (static form + `POST /api/check` JSON API)
- `public/` — the web form
