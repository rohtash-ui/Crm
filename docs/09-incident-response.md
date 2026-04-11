# 09 — Incident Response

How humans work together when the self-healing loops can't handle it alone.
The goal is to **restore service first** and **learn from every incident**
so the platform gets more reliable over time.

## Severity definitions

| SEV | Definition | Example | Response |
|---|---|---|---|
| **SEV-1** | Total / near-total outage of tier-0 OR major data integrity risk OR security breach with active exposure | Login broken globally; data loss in progress | All-hands; IC assigned; status page ≤ 5 min; exec paged |
| **SEV-2** | Significant degradation of tier-0 OR full outage of tier-1 for many tenants | 30% of API requests failing; reports completely down | Page; IC assigned; status page ≤ 15 min |
| **SEV-3** | Localized impact, workarounds exist | One tenant impacted; minor feature broken | Owning team handles; ticket |
| **SEV-4** | Noise, maintenance window, cosmetic | UI typo, non-blocking warning | Ticket, normal priority |

SEV can be raised mid-incident; nobody is penalized for calling SEV-1 that turned out to be SEV-3.

## Roles

- **Primary on-call**: first responder, paged via PagerDuty. Begins mitigation within minutes.
- **Secondary on-call**: backup; takes over if primary can't be reached or needs help.
- **Subject matter expert (SME)**: pulled in based on the service affected.
- **Incident Commander (IC)**: assigned for SEV-1/2. Drives the incident, delegates, makes decisions. Does NOT debug themselves — coordinates.
- **Communications lead (Comms)**: for SEV-1, owns status page updates and stakeholder comms so the IC can focus on technical coordination.
- **Scribe**: captures timeline in the incident channel. Sometimes the IC, sometimes a dedicated person on big incidents.
- **Manager-on-call**: provides cover, removes obstacles, makes business calls (customer contact, exec escalation).

The **IC role** is the key innovation: the most senior tech person is often
the worst IC because they want to debug. Good ICs coordinate and protect
debuggers' focus.

## Incident lifecycle

```
  Detect ──► Declare ──► Mitigate ──► Monitor ──► Resolve ──► Review
     │          │            │           │           │          │
     │          │            │           │           │          └─ Postmortem, action items, loop updates
     │          │            │           │           └─ "All clear" declared; on-call ends
     │          │            │           └─ Keep watch after mitigation; no thrash
     │          │            └─ Restore service (before root-causing)
     │          └─ Open incident channel, assign IC, first status page
     └─ Alert fires or user report
```

## Detect

- Automated alert (preferred): SLO burn-rate alert, synthetic failure, dead-man's switch.
- User report: customer success → incident queue → on-call.
- Internal report: engineer notices in a dashboard.

Every detected incident is logged with detection source — we track how many
come from alerts vs users, and aim for ≥ 80% auto-detected before users notice.

## Declare

Within 5 minutes of detection for SEV-1/2:

1. **Acknowledge** in PagerDuty.
2. **Create** the incident in the tracker (PagerDuty Incident Workflow / FireHydrant / similar), which auto-provisions:
   - A dedicated Slack channel `#inc-<short-id>`.
   - A shared timeline doc.
   - A Zoom / Meet bridge.
3. **Assign IC** (self-assign if you are the first responder; escalate to a trained IC for SEV-1).
4. **Post** the first status page update — even "We are investigating reports of elevated error rates."
5. **Page in** additional SMEs and the manager-on-call as needed.

## Mitigate

**Mitigate first, root-cause later.** The question to ask is always "what is the
smallest action that would restore service?" Common mitigations:

- Roll back the recent deploy.
- Disable the feature flag.
- Fail over to another region.
- Scale up a saturated service.
- Kill a runaway query or tenant.
- Take the affected shard read-only.

Discipline: do not debug root cause while the fire is active unless no mitigation is possible. RCA comes after.

## Communicate

During the incident:

| Audience | Channel | Cadence |
|---|---|---|
| Responders | Incident Slack channel + bridge | Continuous |
| Rest of engineering | `#incidents` overview channel | On state change |
| Customers | Public status page | SEV-1: every 30 min; SEV-2: every 60 min |
| Enterprise customers | Direct email / account manager | SEV-1: on declaration + on resolution |
| Executives | Exec-on-call rotation | SEV-1: on declaration if user-visible > 5 min |
| Legal / PR | Only if data impact or security | On declaration when applicable |

Status page templates:

```
INVESTIGATING — We are investigating reports of elevated error rates in
[area]. We will update in [timeframe].

IDENTIFIED — We have identified the cause of the issue in [area] and are
working on a fix.

MONITORING — A fix has been applied. We are monitoring to ensure the issue
is fully resolved.

RESOLVED — This incident has been resolved. A retrospective will be shared
in [timeframe].
```

## Monitor and resolve

After mitigation:

- Keep the incident channel open.
- Watch dashboards for at least **60 minutes** of baseline stability before resolving.
- Don't declare resolution during a lull that might just be a dip in traffic.
- When stable:
  - Update status page to "resolved."
  - Close PagerDuty incident.
  - Schedule the postmortem meeting.
  - Page on-call off.

## Postmortem (blameless)

Within **3 business days** of resolution for SEV-1/2. SEV-3 postmortems are
lighter-weight and can be async.

### Template

```markdown
# Incident <ID> — <Short Title>

**Severity**: SEV-?
**Date**: YYYY-MM-DD
**Duration**: HH:MM (detected → resolved)
**Customer impact**: <what users saw, how many, which tenants>
**Revenue / SLA impact**: <if any>
**Author**: <IC>
**Reviewers**: <team leads>
**Status**: Draft / In review / Accepted

## Summary
2–3 sentences describing what happened in plain English.

## Timeline
All times UTC.
| Time | Event |
|---|---|
| HH:MM | Alert fired / first user report |
| HH:MM | On-call ack |
| HH:MM | Incident declared, IC assigned |
| HH:MM | Mitigation action X taken |
| HH:MM | Service restored to baseline |
| HH:MM | Incident resolved |

## Impact
- Users affected: <count / percentage>
- Tenants affected: <list or count>
- Data lost or corrupted: <yes/no, details>
- SLO budget burned: <percentage>
- Incidents it triggered upstream/downstream: <list>

## Root cause(s)
Narrative explanation of the proximate and contributing causes. Be specific
— "a race condition in X" not "a bug in X".

## What went well
- (Things to keep doing.)

## What went poorly
- (Where the system or process failed.)
- (Where the loops should have helped and didn't.)

## Where we got lucky
- (Things that could have been worse but weren't.)

## Contributing factors (5 whys or equivalent)
1. Why did the deploy break? Because migration X changed ordering.
2. Why wasn't that caught? Because staging didn't have the same volume.
3. ...
(Keep going until the answer starts to feel systemic, not individual.)

## Action items
| # | Owner | Due | Severity | Description |
|---|---|---|---|---|
| 1 | @team | YYYY-MM-DD | High | Add canary analysis metric X |
| 2 | @team | YYYY-MM-DD | Med | Update runbook for scenario Y |

## Lessons learned
Narrative. What do we now know that we didn't? What would a new engineer
reading this take away?
```

### Blameless discipline

- Talk about **systems and incentives**, not people. "The deploy process allowed a risky change through" — not "Alice pushed a bad commit."
- Assume everyone acted with good intent and the best information they had.
- Remove names from action items except as owners.
- Share the postmortem broadly — fear of postmortems kills learning.

## Action items and follow-through

- Every action item has:
  - **Owner** (person, not team).
  - **Due date**.
  - **Severity**.
  - **Tracking ticket** in the normal backlog.
- **SEV-1 high-severity actions**: must close within **2 weeks**. Slippage escalates to the manager-on-call.
- **Recurring themes**: if three incidents point at the same systemic cause, open a dedicated project to fix it.
- **Loop updates**: if a self-healing loop should have caught the incident but didn't, the update to that loop is the action item (see [08](08-self-healing-loops.md)).

## Metrics we track

| Metric | Why |
|---|---|
| Time to detect (TTD) | Shrinking TTD → more auto-detection |
| Time to mitigate (TTM) | The one that matters for users |
| Time to resolve (TTR) | Total outage length |
| % incidents auto-detected | Should be ≥ 80% |
| % action items closed on time | Trust indicator |
| Incidents per 1,000 deploys | Release safety indicator |
| SLO budget burned | Tied to error budget policy |

These are trends, not dashboards to shame anyone with.

## On-call hygiene

- **Primary shifts**: 1 week, business-hours + pager follow.
- **Secondary shifts**: 1 week, as backup only.
- **Handoffs** at a fixed time with a short written summary of open issues.
- **Sustained pages per shift**: if an on-call is paged > 5 times in a week for non-actionable reasons, that is a tuning bug and gets fixed.
- **Mental health**: on-call compensation, recovery time, no heroics. Hand off if you're tired.

## Incident retrospective cadence

- **Weekly** SRE review of open incidents and action items.
- **Monthly** platform-wide incident review: trends, themes, largest learnings.
- **Quarterly** executive review of SLO burn, incident count, top systemic issues.

## Training

- **New IC** training quarterly: shadow → co-lead → lead.
- **Tabletop exercises** monthly with rotating on-calls.
- **Game days** quarterly: run an unannounced drill against staging.

You get good at incident response the same way you get good at anything —
by practicing the thing on purpose when the stakes are low.
