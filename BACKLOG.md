# traindelaythameslink — Backlog

Epics and stories derived from `PLAN.md`, in the order they'll be built.
Check items off as they land; this file is the source of truth for
planning, mirrored as GitHub Issues (one per epic, with a story
task-list) for day-to-day tracking.

## Definition of Done

A story isn't complete until:

1. The behaviour is implemented.
2. It has **unit tests** covering its logic, written in the same change —
   not deferred to a later story.
3. The **full existing test suite still passes**.
4. Typecheck is clean (`npm run build`).

This applies to every story below, including ones already checked off.

## Epic 1 — Core: RTT data + eligibility engine ([#1](https://github.com/morph355/traindelaythameslink/issues/1))

*(The RTT client described here was rewritten in Epic 8 after RTT retired
this API - "HTTP Basic Auth" below is what it originally was, not current.)*

- [x] RTT API client: search station-to-station, fetch service detail,
      HTTP Basic Auth, typed responses
- [x] Adapter: map RTT's JSON shape to this app's domain types
      (`ServicePerformance`), find the closest matching service to a
      booked departure time, find alternative-service candidates
- [x] Delay/eligibility engine: delay-minutes calculation, Delay Repay 15
      compensation tiers (15/30/60/120 min), all pure and unit tested
- [x] Alternatives evidence: compare the service taken against nearby
      alternatives' *actual* performance, to show whether a genuinely
      faster undisrupted alternative existed
- [x] `checkLeg` orchestrator wiring search -> match -> fetch -> evaluate

## Epic 2 — Self-hosted app ([#2](https://github.com/morph355/traindelaythameslink/issues/2))

- [x] Leg input parsing/validation (from/to CRS, date, time, ticket label)
      with clear, collected error messages
- [x] Express server: static form + `POST /api/check` JSON API
- [x] Web form: enter one or more legs (split-ticket support), see a
      per-leg report (delay, eligibility, compensation tier, alternatives
      evidence, link to the official claim portal)
- [ ] Try it against a real delayed journey once RTT credentials are set
      up, and sanity-check the report against what actually happened

## Epic 3 — Hardening (not started)

- [ ] Handle RTT rate limits / API downtime gracefully in the UI
- [ ] Multi-day layover legs (rare, but a return leg the next day breaks
      the "same day" assumption nowhere currently — check it doesn't)
- [ ] Verify the Delay Repay compensation percentages against
      thameslinkrailway.com directly (blocked from this dev environment's
      network egress when the engine was built — see `PLAN.md`)
- [ ] Revisit Darwin HSP as a second/fallback data source if RTT data
      proves unreliable for a real claim

## Epic 4 — Regular commute + claim-form assist ([#4](https://github.com/morph355/traindelaythameslink/issues/4))

Outbound (Brighton→London Bridge via Gatwick Airport, split-save) runs on
a fixed pair of trains on Mon/Wed; return is ad hoc. One-click checking
for outbound, plus a workflow to get the numbers into the official claim
form without retyping them.

- [x] `src/config/commute.ts`: route, split point, and preset outbound
      times, editable without touching app code
- [x] `checkSplitJourney`: resolve the through service once and derive
      both split-ticket legs' performance from it (only one departure
      time needed, not one per ticket)
- [x] `GET /api/commute` + `POST /api/check-commute` endpoints
- [x] UI: one-click outbound presets (06:39/06:56), manual time entry for
      the less predictable return, Today/Yesterday date shortcuts
- [x] UI: "copy claim details" button per leg result + an "open Delay
      Repay form" button - confirmed in real use that Thameslink's site
      blocks being framed (a security header on their end, no
      workaround), so this was changed from an embedded iframe to a
      plain open-in-new-tab button once that was confirmed
- [ ] Try it against a real delayed journey once RTT credentials are set
      up

## Epic 5 — Ticket ingestion from TrainPal ([#5](https://github.com/morph355/traindelaythameslink/issues/5))

Forward TrainPal booking-confirmation emails to a dedicated inbox and
have the app read the journey off the attached PDF, instead of typing it
in by hand. See `PLAN.md`.

- [x] Dedicated AgentMail inbox (`thameslink-tickets@agentmail.to`)
- [x] `src/tickets/agentmailClient.ts`: list candidate ticket emails
      (sender match + PDF attachment present), download attachment bytes
- [x] `src/tickets/pdfText.ts`: extract plain text from a PDF buffer
- [x] `src/tickets/trainpal.ts`: parses TrainPal's ticket PDF *filenames*
      (e.g. `passenger_Brighton_to_Gatwick Airport_23_Sep_0656.pdf`),
      which turned out more reliable than the PDF body text - for a
      London terminus the body shows a fare-group code ("THK") rather
      than the actual station booked. Built and tested against a real
      forwarded booking (4 ticket PDFs + E-receipt) once one arrived -
      the earlier "blocked on a sample" is resolved
- [x] Wired into `processJourneyRequests` as a fallback: typed
      `out:`/`back:` text still wins when present (it reflects what
      actually happened, not just what was booked), PDF-derived times
      fill in whatever the text didn't cover - which matched exactly how
      a real forward naturally arrived (ticket PDFs + a note typed on
      top)
- [ ] Server: "check for new tickets" endpoint + UI list of parsed
      journeys that pre-fill the checker - superseded by the email
      fallback above for the common case; revisit only if a pure forward
      with no typed note turns out to be common too

## Epic 6 — Always-on deployment (Synology) ([#6](https://github.com/morph355/traindelaythameslink/issues/6))

Run this on a NAS instead of a laptop, reachable from outside the home
network too. See `DEPLOY.md`.

- [x] `src/server/basicAuth.ts`: timing-safe HTTP Basic Auth middleware,
      unit tested
- [x] Wired into `createApp` as an opt-in `auth` option and into
      `index.ts` via `APP_USERNAME`/`APP_PASSWORD` env vars (a loud
      startup warning when unset, since that means no password at all)
- [x] `Dockerfile` (multi-stage build) + `docker-compose.yml` - built and
      ran successfully in this dev sandbox once the root cause of an
      earlier failure was found: this sandbox intercepts outbound HTTPS
      with its own proxy CA, which the host shell trusts but a fresh
      Docker container doesn't, so `npm ci` inside the build hit
      `SELF_SIGNED_CERT_IN_CHAIN` against registry.npmjs.org. That's a
      sandbox-only artifact - a real Synology has normal direct internet
      access, so this shouldn't occur there, but worth a first-build
      check anyway
- [x] `DEPLOY.md`: Container Manager setup, reverse proxy + Let's
      Encrypt for external HTTPS access, why no inbound mail port is
      needed

## Epic 7 — Check a journey by email ([#7](https://github.com/morph355/traindelaythameslink/issues/7))

Email `out: HH:MM` / `back: HH:MM` to the same inbox and get an
eligibility reply, without opening the app at all. See README "Checking
a journey by email".

- [x] `src/tickets/journeyRequest.ts`: parse the free-text body (out/back/
      synonyms, optional date), pure and unit tested
- [x] `src/tickets/replyComposer.ts`: render results into a copy-pasteable
      plain-text reply with a link back to the app, pure and unit tested
- [x] `src/tickets/processJourneyRequests.ts`: list unprocessed non-PDF
      messages from the owner's address, parse, check via
      `checkSplitJourney` (reusing `buildCommuteJourneySpec`, extracted
      from `app.ts`'s `/api/check-commute` route to avoid duplicating the
      outbound/return swap logic), reply, label `checked` so it isn't
      reprocessed; unrecognised bodies get the format explained instead
      of silence, and "no matching service" gets its own explanation
- [x] Background poll loop in `index.ts` (`AGENTMAIL_POLL_SECONDS`,
      default 60s), gated on `AGENTMAIL_API_KEY`/`AGENTMAIL_INBOX_ID`/
      `AGENTMAIL_OWNER_EMAIL` all being set; errors are caught and logged
      per tick rather than crashing the server (verified: a dummy API
      key produces a clean caught error, server keeps running)
- [ ] Try it against a real email once RTT/AgentMail credentials are set
      up on the NAS

## Epic 8 — Migrate to the next-gen RTT API ([#8](https://github.com/morph355/traindelaythameslink/issues/8))

`api.rtt.io` (HTTP Basic Auth, the API every earlier epic was built
against) was retired by RTT essentially the same week - discovered while
trying to answer a real question about a past journey and hitting 403s
everywhere. See `PLAN.md` "Data source" for the full story.

- [x] Read the real OpenAPI spec from
      [realtimetrains/api-specification](https://github.com/realtimetrains/api-specification)
      rather than guess at the new shape (blocked from fetching
      `api-portal.rtt.io`/`data.rtt.io` directly from this dev sandbox, so
      went via `raw.githubusercontent.com` instead)
- [x] `src/rtt/types.ts`, `client.ts`, `adapter.ts` rewritten for
      `data.rtt.io`: Bearer token auth, `/gb-nr/location` +
      `/gb-nr/service`, nested `temporalData`/`scheduleMetadata`, location
      matching via `shortCodes` arrays instead of a flat `crs` field
- [x] `engine/`, `checkLeg.ts`, `checkSplitJourney.ts` untouched by the
      migration (only the two `getService` call sites changed from
      `.serviceUid` to `.scheduleMetadata.identity`) - confirms isolating
      the RTT-specific layer in Epic 1 was the right call
- [x] Fixed a real timezone bug the migration surfaced: RTT's response
      timestamps are absolute UTC and must go through an explicit
      `Europe/London` conversion (`toLondonHHmm`), not `Date`'s
      local-timezone getters, which depend on the server's own OS
      timezone and would silently be an hour off during BST otherwise
- [x] All affected tests rewritten against realistic fixtures (UTC `Z`
      timestamps, not bare local time - which is what caught the timezone
      bug above); 82 tests passing, clean typecheck
- [x] Confirmed the wiring reaches the real API from the NAS: a live
      check returned a genuine `401 Unauthorized` from `data.rtt.io`
      (not a network failure) - request format and auth header are
      correct, the token itself isn't being accepted yet (see Epic 9)
- [ ] A genuinely successful live check, once the token/entitlement issue
      in Epic 9 is resolved

## Epic 9 — First live run on the NAS: two real bugs found ([#9](https://github.com/morph355/traindelaythameslink/issues/9))

The first real end-to-end use (NAS, real token, real email) surfaced two
bugs no amount of mocked testing would have caught.

- [x] **Crash on any unexpected RTT error.** Express 4 (unlike 5) does
      not catch promise rejections thrown from async route handlers.
      `/api/check-commute` and `/api/check` re-threw anything that
      wasn't `NoMatchingServiceError`, assuming Express would turn it
      into a response - it doesn't in v4, so Node treated it as an
      unhandled rejection and crashed the process. `restart:
      unless-stopped` then restarted the container, and the browser's
      in-flight `fetch()` saw the reset connection as "Failed to fetch"
      with no useful detail. First real RTT error (a 401, see Epic 8)
      hit exactly this path. Fixed: every route catches all errors,
      logs server-side, responds with a real status instead of
      throwing; added a final Express error-handling middleware as a
      safety net. Regression test added using the exact error from the
      production log.
- [x] **Email-checker wouldn't have processed the real test email even
      once the sender address is fixed.** `listUnprocessedRequestEmails`
      excluded any message with a PDF attachment outright, assuming a
      ticket forward and a typed "out:/back:" request were mutually
      exclusive. A real one wasn't: forwarding the booking and adding a
      note on top is the natural way to do this. Fixed alongside the
      `trainpal.ts` work in Epic 5 - PDF attachments no longer exclude a
      message, and typed text + PDF-derived data now merge.
- [ ] User needs to correct `AGENTMAIL_OWNER_EMAIL` in `.env` to their
      real sending address (was set to a different address than the one
      actually used) and resolve the RTT token/entitlement issue from
      Epic 8, then redeploy

## Explicitly not planned

- Auto-submitting claims (no public API; out of scope, see `PLAN.md`)
