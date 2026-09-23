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

## Explicitly not planned

- Auto-submitting claims (no public API; out of scope, see `PLAN.md`)
- Monitoring a fixed/recurring commute (travel isn't regular enough to
  justify it currently)
