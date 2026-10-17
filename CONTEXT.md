# Train Delay Thameslink

Checks whether a rail journey qualifies for Delay Repay compensation and what it would pay.

## Language

**Commute**:
The fixed regular route: Brighton, via Gatwick Airport, to London Bridge, in either direction.

**Direction**:
Outbound (Brighton to London Bridge) or return (London Bridge to Brighton).

**Journey**:
One Direction on one date, checked as a unit.

**Leg**:
The span of travel covered by one ticket. A split-save Journey has two Legs; a direct-ticket Journey has one.
_Avoid_: segment, section

**Split-save pair**:
Two tickets (e.g. Brighton to Gatwick, Gatwick to London Bridge) bought instead of one direct ticket, both covered by the same physical train.

**Direct ticket**:
A single ticket covering the whole Direction, so the Journey has one Leg.

**Booked service**:
The train the ticket and the stated departure time refer to.

**Travelled service**:
The train actually arrived on. It differs from the Booked service only when the booked train was cancelled or terminated early.
_Avoid_: taken service

**Alternative**:
A nearby service on the same Leg that could have been caught instead, used as evidence of whether a faster undisrupted option existed.
