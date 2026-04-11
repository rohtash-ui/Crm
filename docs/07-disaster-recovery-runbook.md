# 07 — Disaster Recovery Runbook

This is the step-by-step playbook the on-call responder follows when things
break. Every scenario follows the same format:

> **Trigger → Detection → Decision → Action → Verification → Rollback**

If you are in an active incident, skip the narrative and jump to the scenario
that matches your symptoms.

## RTO / RPO targets

| Tier | Example | RTO | RPO |
|---|---|---|---|
| **Tier-0** | Auth, core CRUD, event pipeline | 5 min | 30 s |
| **Tier-1** | Reports, bulk imports, search | 30 min | 5 min |
| **Tier-2** | Analytics, warehouse dashboards | 4 h | 1 h |

## Incident severity

| SEV | Meaning | Example | Response |
|---|---|---|---|
| **1** | Total or near-total outage of tier-0 | Login broken globally | Page all; IC assigned; status page immediately |
| **2** | Major degradation in tier-0 or outage in tier-1 | 50% of users seeing errors | Page; IC assigned; status page within 5 min |
| **3** | Localized degradation; workarounds exist | One tenant impacted; one feature degraded | Owning team handles |
| **4** | Noise, maintenance, non-urgent | Chatty alert | Ticket |

## General incident flow (≤ 5 min)

1. **Acknowledge** the page in PagerDuty.
2. **Open** the incident Slack channel (auto-created by PagerDuty bot).
3. **Assign** an IC if SEV-1/2 (you, or escalate).
4. **Post** the first status-page update within 5 min for SEV-1/2, even if it just says "investigating."
5. **Mitigate** first; root-cause later.
6. **Identify** the scenario below that matches and execute it.

---

## Scenario 1 — Single pod crash

**Trigger**: Pod restart alert or brief error rate blip.

**Detection**: Kubernetes reports `CrashLoopBackOff` or `Restarting`. Per-pod error rate spikes briefly.

**Decision**: No human action unless the restart loop persists.

**Action**: K8s automatically restarts the pod per the deployment's restart policy. PodDisruptionBudget ensures the service as a whole stays above quorum.

**Verification**:
- Pod returns to `Running` + `Ready`.
- Error rate recovers within 60 s.

**Rollback**: Not applicable; nothing changed.

**Escalate if**: Pod cannot stay up for > 2 minutes → scenario 8.

---

## Scenario 2 — Node failure

**Trigger**: Node `NotReady`, or cloud provider notice.

**Detection**: Node controller marks node `NotReady` after 40 s. Pods on the node are marked `Terminating` after 5 min.

**Decision**: Let the cluster autoscaler handle it unless latency shows impact.

**Action**:
1. Node controller evicts pods according to PDB.
2. Scheduler re-places pods on healthy nodes.
3. Cluster autoscaler provisions a replacement node.
4. Re-scheduled pods become `Ready`.

**Verification**:
- All services show healthy replicas == desired.
- p95 latency returns to baseline within 2 min.

**Rollback**: Not applicable.

**Escalate if**:
- Multiple nodes fail simultaneously → scenario 3.
- New node cannot be provisioned (quota, image pull) → platform on-call.

---

## Scenario 3 — Availability Zone (AZ) failure

**Trigger**: AZ-wide network or power outage. Multiple nodes `NotReady` at once.

**Detection**:
- Regional dashboard shows one AZ dark.
- Sync standby may need to be repromoted if the primary was in the failed AZ.

**Decision**: Shift traffic off the failing AZ, let quorum handle it, scale up surviving AZs.

**Action**:
1. Verify mesh outlier detection has already ejected failed endpoints.
2. Confirm PodDisruptionBudgets are still satisfied. If not, scale up the other AZs:
   - `kubectl scale deploy <svc> --replicas=<higher>` or let HPA catch up.
3. If Postgres primary was in the failed AZ: confirm sync standby auto-promoted. If it didn't:
   - Run the documented promote procedure (orchestrated via Patroni / Stolon).
4. Confirm Kafka still has quorum; if ISR dropped below 2, pause producers on affected topics.
5. Update status page: "Degraded performance in one availability zone; failover in progress."

**Verification**:
- Traffic healthy on surviving AZs within 2 min.
- Postgres primary confirmed elected, writes accepted.
- Kafka min-ISR restored; consumer lag recovering.
- Error rate returns to baseline.

**Rollback**: When the AZ recovers, cordon new nodes there until an orchestrated return-to-service — don't let them immediately take traffic with cold caches.

**Escalate if**:
- Two AZs affected → scenario 4 (region failure).

---

## Scenario 4 — Region failure

**Trigger**: Provider region outage, or multi-AZ failure, or a regional control-plane bug.

**Detection**: Region A health probes all red; synthetic monitors from outside the region fail.

**Decision**: Fail over to Region C (warm DR) if Region B alone cannot absorb the load, or shift all traffic to Region B if it can.

**Action (to Region B only)**:
1. Update global LB weights: A = 0, B = 100.
2. Promote Postgres shards whose primaries were in A to their async replicas in B (accept a small RPO).
3. Update Kafka MirrorMaker / cluster linking to keep producing in B.
4. Scale Region B pods up by ~100% (it's now taking both regions' traffic).
5. Status page: "Region A impacted; failed over to Region B; some requests may have elevated latency."

**Action (to Region C, full DR)**:
1. Scale up pods in Region C (warm cluster already running minimal replicas).
2. Promote cross-region Postgres standbys → primary (RPO up to 30 s of async lag).
3. Update global LB weights: A = 0, B = existing, C = new allocation.
4. Warm caches (run a prefetch job for common hot keys before releasing traffic — avoids cache-stampede on promotion).
5. Update DNS / WAF rules as needed.
6. Status page.

**Verification**:
- Synthetic monitors green from outside the affected region.
- Error rate back within SLO within 10 min.
- No unacknowledged writes lost (check audit stream for gaps).

**Rollback**:
- When Region A recovers: resync data (Postgres re-base from current primary), start with 0% traffic, rise to 10% → 50% → 100% while monitoring. Don't fail back during the same incident.

**Escalate if**:
- Two regions affected simultaneously → full DR plus vendor escalation; consider invoking the cross-cloud DR plan if it exists.

---

## Scenario 5 — Postgres primary corruption

**Trigger**: `pg_amcheck` failure, WAL apply errors, or user-visible data anomaly.

**Detection**: Corruption alert from the scheduled `amcheck` job, or WAL replay failure on a standby.

**Decision**: Stop bleeding first. Promote a known-good standby; do NOT restart the primary blindly.

**Action**:
1. Put the affected shard into read-only mode via app feature flag to stop writes.
2. Take a snapshot of the corrupt primary for forensic analysis (do NOT delete).
3. Promote the sync standby (which has `synchronous_commit = remote_apply`, so it is safe).
4. Re-point PgBouncer to the new primary.
5. Remove read-only flag.
6. Rebuild a new standby from the new primary; add it back to the quorum.
7. Open a SEV-2 for RCA.

**Verification**:
- Writes succeed to the shard.
- New standby catches up; replication lag ~0.
- `amcheck` clean on the new primary.

**Rollback**: The old primary stays out of service until forensic analysis is done.

**Escalate if**:
- Sync standby is also corrupt → PITR restore (scenario 9).

---

## Scenario 6 — Kafka broker / topic failure

**Trigger**: Broker dead, ISR shrink, or consumer lag runaway.

**Detection**: Kafka metric dashboard shows `under_replicated_partitions > 0` or `min_isr_violated` alert.

**Decision**: Replace broker; throttle producers if lag is dangerous; do NOT let min-ISR fall below 2 for critical topics.

**Action (broker dead)**:
1. Confirm the broker is actually dead (network isolation can masquerade).
2. Provision a replacement broker with the same `broker.id`.
3. Trigger partition reassignment to the replacement.
4. Watch ISR recover.

**Action (consumer lag runaway)**:
1. Scale consumer group replicas (KEDA auto-handles this; if stuck, `kubectl scale`).
2. If consumers are stuck on a poison message, move the group offset past it and send the message to DLQ.
3. If the downstream store is slow, widen the bulkhead on the consumer or pause until the store recovers.

**Verification**:
- `under_replicated_partitions == 0`.
- Consumer lag returning to SLO bounds (tier-0 < 5 s).

**Rollback**: None.

**Escalate if**:
- Min-ISR cannot be restored → pause producers on affected topics and declare SEV-2.

---

## Scenario 7 — Redis node failure

**Trigger**: Redis sentinel / cluster failover event, elevated cache miss rate.

**Detection**: Cache miss rate spikes; app latency may bump briefly.

**Decision**: Let the cluster handle failover; ensure the app is falling back to direct DB reads, not erroring.

**Action**:
1. Confirm replica promoted to primary in the affected shard.
2. Confirm app error rate not spiking — if it is, investigate the fallback path (maybe a code path is not using `OR cache.miss -> db.read`).
3. Provision replacement node; let it resync.

**Verification**:
- Cache hit rate returns to baseline within 5–10 minutes (caches refilling).
- No elevated app error rate.

**Rollback**: None.

**Escalate if**:
- App error rate rises with cache miss rate → buggy fallback path; possibly page a feature flag to disable the affected feature while hotfixing.

---

## Scenario 8 — Bad deploy

**Trigger**: SLO burn alert within minutes of a deploy event.

**Detection**: Deploy correlation on the dashboard shows a regression starting at `T = deploy`.

**Decision**: Roll back first, diagnose later.

**Action**:
1. **Automatic**: Argo Rollouts / Flagger should have halted the canary and rolled back. Verify.
2. **Manual (if automatic failed)**:
   - `kubectl argo rollouts abort <rollout>` or
   - `helm rollback <release> <previous-revision>`.
3. If the rollout is fully deployed (past canary) and needs reversal:
   - `helm rollback <release> <previous-revision>` (the previous image is still available).
4. Post status: "Rolled back a recent change; monitoring recovery."
5. Open an incident for the bad change; revert the commit in git on `main`.

**Verification**:
- Error rate / latency return to baseline within 5 min.
- Replicas running the old image == desired.

**Rollback**: Already rolled back; do not re-deploy until the root cause is fixed.

**Escalate if**:
- The rollback itself doesn't restore service → the issue may be stateful (migration, data). Jump to scenario 9.

---

## Scenario 9 — Bad migration / data corruption from code

**Trigger**: Error spike correlates with a DB migration, or user reports of missing/incorrect data.

**Detection**: Compare error window with migration log; check `pg_stat_activity` for long-running queries; check row counts on affected tables.

**Decision**: Stop further damage first (pause writes or the specific code path), then decide between forward fix and restore.

**Action**:
1. **Stop the bleed**: disable the offending feature via flag, or put the shard into read-only.
2. **Assess**: is the data recoverable from the running DB (e.g., soft-deleted, recoverable from tombstones) or do we need PITR?
3. **If PITR**:
   - Restore the affected shard to a new cluster at `T - 1 minute before the incident`.
   - Verify on the restored cluster.
   - Dual-write live traffic to both old + new via the app (or take a short read-only window).
   - Compute the delta of writes since `T` and replay them (from Kafka audit / CDC stream).
   - Cut over to the new cluster.
4. **Forward fix**: if the issue is a code bug, revert (scenario 8) and release the fix.

**Verification**:
- Row counts and checksums of sampled tables match expected.
- User reports of missing data stop.
- SLO recovers.

**Rollback**: Keep the corrupted pre-restore snapshot for forensics; do not delete until the postmortem is closed.

**Escalate if**:
- PITR window is exhausted (older than retention) → involve leadership; potential customer notification; check cross-region or cold backups.

---

## Scenario 10 — Full cloud provider outage

**Trigger**: Region A + B both unhealthy, or provider status page reports a wide outage.

**Detection**: Synthetic monitors from all external PoPs red; provider status page red.

**Decision**: Invoke the warm DR region (Region C). If the provider is entirely down and the cross-cloud DR plan exists, invoke that.

**Action**:
1. Declare SEV-1; all hands; IC assigned.
2. Update status page immediately with a provider-outage notice.
3. Promote Region C (see scenario 4, Region C action).
4. If cross-cloud DR plan is in place:
   - Spin up the standby environment in the secondary cloud from Terraform.
   - Restore latest cross-cloud backup of Postgres.
   - Promote DNS to the secondary cloud's entry points.
   - Customer traffic resumes in degraded / read-mostly mode while the rest catches up.
5. Communicate hourly.
6. Once the primary provider recovers, do NOT fail back during the same incident. Schedule a planned failback.

**Verification**:
- Synthetics green against the failover environment.
- Writes accepted.

**Rollback**: Planned failback with a maintenance window, after a full validation of data consistency.

---

## Communication tree (SEV-1/2)

```
Incident detected
  │
  ▼
Primary on-call  ── pages ──►  IC
  │
  ├─► SRE manager-on-call        (informed within 10 min)
  ├─► Service owning team lead    (informed within 10 min)
  ├─► Customer success on-call    (informed within 15 min, handles customer comms)
  ├─► Security on-call            (if any sign of compromise)
  ├─► Legal / compliance          (if data impact)
  └─► Exec-on-call                (for SEV-1, ≥ 30 min duration, or customer-visible > 5 min)
```

Status page cadence:

- SEV-1: first update within 5 min, then every 30 min until resolved.
- SEV-2: first update within 15 min, then every 60 min until resolved.

## After the incident

1. Service restored → declare `monitoring` state.
2. When baseline stable for 60 min → declare `resolved`.
3. IC schedules blameless postmortem within 3 business days.
4. Postmortem uses the template in [09](09-incident-response.md).
5. Action items enter the tracker with owners and due dates.
6. Runbooks updated with anything learned.

## Practice

These scenarios are exercised regularly:

- **Monthly**: tabletop one random scenario with the on-call rotation.
- **Quarterly**: partial failover drill in staging (region, AZ, Postgres promotion).
- **Annually**: full DR failover drill (controlled, scheduled, customer-communicated).

If a scenario is not practiced, assume it will not work during a real incident.
