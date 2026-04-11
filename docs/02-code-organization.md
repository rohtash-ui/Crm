# 02 — Code Organization

How the source code, branches, and release pipelines are structured so that
hundreds of engineers can ship to a 50K-user system every day without stepping
on each other or breaking production.

## Repo strategy

Hybrid model:

- **`crm-services/`** — monorepo containing all backend microservices. One PR can touch shared libraries and a service atomically.
- **`crm-web/`** — monorepo containing web client, mobile client, and shared design system.
- **`crm-infra/`** — polyrepo of Terraform modules, Helm charts, Crossplane configs, ArgoCD apps.
- **`crm-libs/<name>/`** — per-language shared libraries (Go, TypeScript, Python) each versioned independently.
- **`crm-contracts/`** — protobuf / OpenAPI / AsyncAPI definitions, source of truth for all service contracts.

Why hybrid: a pure monorepo is hard to scale the build cache and CI to PB of
artifacts; a pure polyrepo makes cross-cutting refactors a nightmare. This
split puts closely-coupled code together and keeps blast-radius-sensitive
things (infra) separate.

## Monorepo layout — `crm-services/`

```
crm-services/
├── services/
│   ├── identity/
│   │   ├── api/              # HTTP/gRPC handlers, DTOs
│   │   ├── domain/           # Business logic, pure, no IO
│   │   ├── infra/            # DB, cache, external client adapters
│   │   ├── migrations/       # SQL, numbered, forward-only
│   │   ├── tests/
│   │   │   ├── unit/
│   │   │   ├── integration/
│   │   │   └── contract/
│   │   ├── openapi.yaml
│   │   ├── asyncapi.yaml
│   │   ├── Dockerfile
│   │   ├── helm/
│   │   │   ├── Chart.yaml
│   │   │   ├── values.yaml            # defaults
│   │   │   ├── values-dev.yaml
│   │   │   ├── values-staging.yaml
│   │   │   └── values-prod.yaml
│   │   └── CODEOWNERS
│   ├── contacts/
│   ├── deals/
│   ├── ...
├── libs/
│   ├── authz/                # shared auth checks
│   ├── obs/                  # OpenTelemetry wrapper
│   ├── idempotency/
│   ├── ratelimit/
│   ├── featureflags/
│   └── testutil/
├── tools/
│   ├── codegen/
│   ├── lint/
│   └── scripts/
├── .buildkite/ or .github/workflows/
├── go.work / pnpm-workspace.yaml / pyproject.toml
└── CODEOWNERS
```

Every service follows the same skeleton. A new service is created from a
template (`tools/scripts/new-service.sh`) so the structure is boringly
consistent — boring is good for on-call responders at 3am.

## Layering rules inside a service

```
api/    ──►  domain/  ──►  infra/
```

- `api/` depends on `domain/` and `infra/` (composition root).
- `domain/` depends on nothing external — pure logic, easy to unit test.
- `infra/` implements interfaces declared in `domain/`.
- Cross-service calls live in `infra/clients/` and use the shared retry + circuit-breaker wrapper.

## Shared libraries

Shared libs live in `crm-services/libs/` and are versioned per commit by the
monorepo's build cache (Bazel / Turbo / Nx). No service pins a shared-lib
version — the monorepo always builds them together, so a breaking change in
`libs/authz` forces compilation failures in every dependent service in the
same PR. This is the point: coupled code should break loudly in CI rather
than silently in prod.

Libraries that need to be consumed by repos *outside* the monorepo (e.g.,
mobile clients, third-party SDK users) are published to a private registry
and follow semantic versioning.

## Branching model

**Trunk-based development.**

- `main` is always releasable. Protected, linear history, squash merges only.
- Feature branches are short-lived (< 2 days, ideally hours) and named `user/<handle>/<ticket>-<slug>`.
- Merge queue ensures every merged commit has been tested against the current `main`, not a stale base.
- Long-lived branches are forbidden; large features hide behind feature flags.
- Hotfixes cherry-pick from `main` to `release/<date>` if a canary has been running for extended validation.

## Code review gates

Before a PR can merge, all of the following must pass:

| Gate | Tool | Blocks merge |
|---|---|---|
| Formatting | `gofmt`, `prettier`, `black` | Yes |
| Lint | `golangci-lint`, `eslint`, `ruff` | Yes |
| Type check | `tsc`, `mypy` | Yes |
| Unit tests | per language | Yes |
| Integration tests | testcontainers | Yes |
| Contract tests | Pact / schema diff | Yes |
| SAST | Semgrep, CodeQL | High-severity blocks |
| Dependency scan | Dependabot / Renovate + Grype | High CVE blocks |
| Container scan | Trivy | Critical blocks |
| License scan | FOSSA | Copyleft blocks |
| Secrets scan | gitleaks | Any hit blocks |
| Coverage | service threshold | Below threshold blocks |
| Approvals | CODEOWNERS | ≥ 2 required |
| Changelog entry | bot check | For user-visible change |

## CODEOWNERS

Every directory has an owner. Reviews are auto-requested to the owning team.
Platform-wide changes (shared libs, infra, CI) require platform-team approval.

Example:

```
# crm-services/CODEOWNERS
/services/identity/   @crm/identity-team
/services/deals/      @crm/pipeline-team
/libs/                @crm/platform-core
/services/*/helm/     @crm/platform-sre
```

## Versioning

| Artifact | Scheme | Example |
|---|---|---|
| Services (container images) | CalVer + git SHA | `2026.04.11-abc1234` |
| Shared libraries (published) | SemVer | `v3.7.1` |
| API contracts | SemVer major on breaking | `/v1/`, `/v2/` |
| Helm charts | SemVer | `1.4.2` |
| Database migrations | Monotonic integer | `0042__add_deal_score.sql` |

API breaking changes require a 6-month deprecation window and dual-version
running during the overlap. Internal service contracts are tested with
consumer-driven Pact tests so a provider cannot break a consumer without CI
failing.

## Database migrations

- Forward-only, numbered, one per file.
- Expand / contract pattern:
  1. **Expand**: add new column/table, dual-write.
  2. **Migrate**: backfill in batches, verify.
  3. **Switch**: read from new, keep writing both.
  4. **Contract**: stop writing old, drop in a later release.
- Long-running migrations run out-of-band via a migration runner pod, not during deploy.
- `pg_repack` or equivalent for online table rewrites.

## Feature flags

Flags are first-class and live in `libs/featureflags`. Rules:

- Every risky change is behind a flag.
- Flags have an owner and an expiry date — CI fails PRs that add a flag without an expiry.
- A "kill switch" flag exists for every non-critical feature so it can be disabled in seconds during an incident.
- Flag evaluation is local (edge cache), never on the hot path of an external service call.

## Generated code

Everything contract-driven is generated from `crm-contracts/`:

- Server stubs (gRPC, OpenAPI).
- Client SDKs (TS, Go, Python).
- Event schemas (Avro / Protobuf).

Generated files are committed (not regenerated in CI) so diffs are reviewable.

## Build system

- **Bazel** (or Nx/Turbo) for incremental builds: only rebuild/test what changed.
- Remote build cache shared across CI and dev laptops → first `bazel build` on a new laptop takes minutes, not hours.
- Hermetic builds — no network at build time, reproducible from any commit.

## Test pyramid

| Layer | Share | Where |
|---|---|---|
| Unit | ~70% | Per-file, pure domain logic |
| Integration | ~20% | testcontainers (Postgres, Redis, Kafka) |
| Contract | ~5% | Pact / schema diff between services |
| End-to-end | ~4% | Synthetic user flows against staging |
| Chaos | ~1% | Scheduled, see [08-self-healing-loops.md](08-self-healing-loops.md) |

A PR that adds logic without tests fails CI via coverage gate.

## Ownership and on-call rotation

Every service has:

- A named owning team in CODEOWNERS.
- A PagerDuty schedule.
- A runbook in `docs/runbooks/<service>.md` (linked from [07](07-disaster-recovery-runbook.md)).
- An SLO defined in `slo/<service>.yaml`.

You break it, you fix it, you document it.
