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
   [api-portal.rtt.io](https://api-portal.rtt.io/) and copy the token
   shown on your API dashboard.
2. `npm install`
3. `cp .env.example .env` and fill in `RTT_TOKEN`.
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
- The right-hand pane has a "Copy claim details" button on each result and
  a button to open Thameslink's Delay Repay form in a new tab - it can't be
  embedded directly (their site blocks being framed, a standard security
  header with no workaround), so it's copy-then-paste rather than side by
  side.

## Deploying it somewhere always-on

For running this on a NAS (or any always-on box) instead of your laptop,
see [`DEPLOY.md`](DEPLOY.md) - it covers Docker (`Dockerfile` +
`docker-compose.yml` are included) and, if you want it reachable outside
your home network, Synology's reverse proxy + the `APP_USERNAME`/
`APP_PASSWORD` password gate that guards every route when set.

## Checking a journey by email

Send an email to `thameslink-tickets@agentmail.to`, from the address you
set as `AGENTMAIL_OWNER_EMAIL`, with a line for each leg you travelled:

```
out: 06:39
back: 18:12
```

Either line is optional (just the delay you hit), `return`/`inbound` also
work for "back", `outbound` for "out", times can be `06:39`, `06.39` or
`0639`, and an optional `date: yyyy-mm-dd` (or `date: yesterday`) line
overrides the default of the day you sent the email. The app checks the
inbox every `AGENTMAIL_POLL_SECONDS` (default 60s) and replies with the
delay, eligibility, compensation tier and alternatives evidence for each
leg, ready to copy straight into the claim form - no need to open the app
at all, though the reply links back to it (`APP_URL`) in case you want to
check something else.

You can also just **forward your TrainPal booking confirmation** to the
same address, with or without the `out:`/`back:` lines on top - the app
reads the booked times off the attached ticket PDFs (specifically their
filenames, which name the real stations; the PDF text itself sometimes
shows a fare-group code instead). If you add `out:`/`back:` text too
(the natural thing to do when forwarding on the day something actually
went wrong), that always wins over the booked time, since it reflects
what happened rather than just what was planned.

If the body doesn't match the format, the reply explains it instead of
going silent.

## Ticket forwarding (in progress)

Forward TrainPal booking confirmations to the same inbox
(`thameslink-tickets@agentmail.to`) and the app will (eventually) read
the journey off the attached PDF automatically instead of you emailing
the times yourself. The inbox exists and the pieces that fetch and read
the PDF are built and tested; the part that turns TrainPal's specific
layout into journey fields is still pending a real sample to build
against - see `BACKLOG.md` Epic 5.

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
- `src/tickets/` — AgentMail client, PDF text extraction, and the
  email-request parsing/reply pipeline (see above)
- `public/` — the web page
