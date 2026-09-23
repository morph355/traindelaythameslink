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
5. Open http://localhost:3000.

## Using it

The page has three parts:

- **Today's journey** — one-click buttons for your regular outbound trains
  (edit `src/config/commute.ts` if your route/times change), plus a time
  field for the return leg since that's less regular. Pick a date (Today
  / Yesterday), click a preset, and it evaluates both split-ticket legs
  from a single lookup.
- **Different journey** (collapsed by default) — the general form for a
  one-off journey that isn't your usual commute: add as many legs as you
  need, each with its own from/to/date/time.
- The right-hand pane embeds the Thameslink Delay Repay form directly, so
  you can copy each result's details across without switching tabs. Each
  result has a "Copy claim details" button. If your browser won't let
  Thameslink's site load in the frame, there's an "open in a new tab"
  fallback link above it.

## Testing

```
npm test
```

## Project layout

- `src/config/commute.ts` — your regular commute (route, split point, preset times)
- `src/rtt/` — Realtime Trains API client and mapping to domain types
- `src/rtt/checkLeg.ts` / `checkSplitJourney.ts` — orchestrators: a single
  independent leg, or two split-ticket legs derived from one through service
- `src/engine/` — pure delay/eligibility/alternatives-evidence logic
- `src/server/` — Express app (static page + `POST /api/check` and
  `POST /api/check-commute` JSON APIs)
- `public/` — the web page
