# PLAN.md

## What this is

A personal tool to check whether a delayed Thameslink journey qualifies for
Delay Repay, and to draft the claim - **not** a scheduler that watches a
fixed commute (the user's journeys vary day to day), and **not** a bot that
submits claims (GTR/Thameslink only expose a web form at
delayrepay.thameslinkrailway.com, no public submission API - automating
that would mean scraping/driving their site, which is fragile and out of
scope for v1).

Split-save tickets are two (or more) separate tickets covering different
legs of one journey. Delay Repay is assessed per ticket, so each leg is
checked and reported independently - a delay on one leg does not carry
over to the other.

A recurring problem the user has hit: claims getting pushed back with
"you could have taken an alternative". The checker's job isn't just "was
the train >=15 min late" - it also pulls the actual (not scheduled)
performance of other services around the departure window, so the report
shows whether a genuinely faster, undisrupted alternative existed or not.
That's the evidence to include with a claim either way.

## Data source

[Realtime Trains API](https://api-portal.rtt.io/) (rtt.io) - free for
personal use, gives both scheduled (`gbttBooked*`) and realtime/actual
(`realtime*`) times per service at each calling point. Requires a free
account; credentials go in `.env` (see `.env.example`).

Considered the Darwin Historic Service Performance (HSP) webservice
instead/as well - it's the more "official" National Rail source, but
requires a Rail Data Marketplace subscription with more onboarding
friction. RTT covers what's needed for now; HSP is worth revisiting if RTT
data proves unreliable for a real claim.

## Architecture

Small self-hosted Node/TypeScript service (chosen over a GitHub Actions
cron job, since journeys are ad hoc, not scheduled):

```
src/
  rtt/          RTT API client + mapping from RTT's JSON shape to this
                app's domain types (client.ts, types.ts, adapter.ts)
  engine/       Pure delay/eligibility/alternatives logic, no I/O
                (delayRepay.ts, types.ts)
  rtt/checkLeg.ts   Orchestrates: search -> match service -> fetch actual
                    performance -> fetch alternatives -> evaluate
  server/       Express app: static form (public/index.html) + JSON API
                (POST /api/check)
```

The engine is deliberately I/O-free so the delay/eligibility/evidence
rules are unit tested without hitting the network or a fake HTTP layer.

## Workflow (v1)

1. User had a delay. They open the local web page and enter each leg of
   the journey (from/to CRS codes, date, booked departure time, optional
   ticket label).
2. Server looks up the service closest to the booked departure time,
   fetches its actual performance at the destination, and computes delay
   vs the scheduled arrival.
3. Server also fetches nearby alternative services (departing at/after the
   booked time) and their actual performance, to check whether a faster,
   undisrupted alternative genuinely existed.
4. Report shown per leg: delay minutes, eligibility (>=15 min), the
   standard Delay Repay 15 compensation tier (25% / 50% / 100%), and the
   alternatives evidence, plus a link to submit at
   delayrepay.thameslinkrailway.com within 28 days.

## Deployment target

Runs long-term on a Synology NAS (Docker via Container Manager), not just
a laptop, so it's available whenever a delay needs checking. Because
email is handled by AgentMail's cloud inbox rather than received by the
app itself, the NAS side only ever needs outbound HTTPS - no inbound mail
port. Optionally reachable outside the home network via Synology's
reverse proxy; since the app has no other login, `APP_USERNAME`/
`APP_PASSWORD` (HTTP Basic Auth, `src/server/basicAuth.ts`) gate every
route whenever those are set, and `index.ts` warns loudly on startup if
they're not - see `DEPLOY.md`.

## Ticket ingestion (TrainPal forwarding)

TrainPal booking confirmations (PDF e-tickets) get forwarded to a
dedicated AgentMail inbox (`thameslink-tickets@agentmail.to`) rather than
the user's own mailbox, keeping this app's mail access scoped to just
that. The plan was for the server to poll it on demand (a "check for new
tickets" action) rather than a background cron - since built, Epic 7
added a background poll for a related but different purpose (see below),
so this may end up piggybacking on that loop once `trainpal.ts` exists,
rather than staying a separate on-demand action. Uses the official
`agentmail` npm SDK:

```
src/tickets/
  agentmailClient.ts   list candidate ticket emails (sender match + has a
                        PDF attachment), download an attachment's bytes
  pdfText.ts            extract plain text from a PDF buffer (pdf-parse v2 -
                         note its API is a `PDFParse` class with `.getText()`,
                         not the old v1 default-export-function shape; the
                         separately-published @types/pdf-parse package is
                         for v1 and does not match - use the types pdf-parse
                         itself ships)
  trainpal.ts            [not yet built] parse TrainPal's extracted PDF text
                         into journey fields (from/to, date, time, split-leg
                         boundary if shown)
```

`trainpal.ts` needs a real sample forwarded to the inbox before it can be
written with any confidence - TrainPal's PDF layout isn't something to
guess at reliably from extracted text (no fixed column/label positions
are known yet). Once one arrives, inspect it directly (this session has
live AgentMail access) to build and unit-test the parser against real
text, not assumptions.

## Checking a journey by email

The same inbox also accepts ad hoc "check my journey" requests, not just
TrainPal forwards - an email from the user's own address (`out: HH:MM` /
`back: HH:MM`, see README) gets an automatic reply with the eligibility
report as plain text, ready to paste into the claim form without opening
the app. This is the first genuinely automatic/background piece in the
app (a poll loop in `index.ts`, `AGENTMAIL_POLL_SECONDS`), but it's still
user-triggered, not a commute monitor: nothing happens unless the user
sends an email.

```
src/tickets/
  journeyRequest.ts       parse "out:"/"back:" (+ synonyms, optional date)
                          from a plain-text email body
  replyComposer.ts         render check results into a copy-pasteable
                          plain-text reply
  processJourneyRequests.ts   orchestrates: list unprocessed non-PDF
                          messages from the owner -> parse -> check via
                          checkSplitJourney -> reply -> label `checked`
```

Restricted to `AGENTMAIL_OWNER_EMAIL` on purpose - the inbox address
could leak or attract spam, and this avoids running the checker (and
sending a reply) for anything that isn't genuinely the user.

## Explicitly out of scope for v1

- Auto-submitting the claim itself (no public API for this; would need
  browser automation against Thameslink's form).
- Tracking claims after submission / chasing responses.
- Parsing ticket confirmation emails automatically.
- Any fixed/recurring commute monitoring - revisit if the user's travel
  pattern becomes regular enough to justify it.

## Open questions to revisit

- Exact current Delay Repay compensation percentages are hardcoded from
  general knowledge of the standard "Delay Repay 15" scheme used across
  GB operators (see `src/engine/delayRepay.ts`) - thameslinkrailway.com
  was unreachable from this environment's network egress proxy when this
  was built, so these should be double-checked against the live page
  before relying on the exact percentage for a claim.
- Whether Automatic Delay Repay (for smartcard/contactless tickets)
  already covers either leg, making this tool unnecessary for that leg.
