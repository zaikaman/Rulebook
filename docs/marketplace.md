# The rule marketplace

The marketplace lets an owner publish a rule so anyone can copy its exact parameters into
their own account. It is a **discovery surface, not a shared account**: a clone never sends
funds to, or grants control to, the author.

## Publishing

Listing happens in the owner's own transaction. `Agent.addRule(rule, true)` calls
`RuleRegistry.list(address(this), ruleId, "")` after the rule is stored, and
`RuleRegistry.list` reads the stored rule back from the Agent before deriving `paramsHash`
from it. Two consequences matter:

- **The hash cannot drift.** The registry hashes what the Agent actually stored, so a
  listing and its rule can never disagree about a parameter.
- **The indexer never writes the registry (FR-052).** The backend has no path that lists a
  rule; only the owner's signature can. Keeping the registry out of the indexer also means a
  reindex cannot publish or unpublish anything — listings are rebuilt from
  `RuleListed`/`RuleDelisted` events.

`delist` is author-only and writes nothing else: the rule keeps running on the author's
account, it simply stops appearing in the marketplace.

## Cloning

A clone is a new `addRule` transaction on the **cloner's** Lasna Agent, paid for by the
cloner and enforced by the cloner's Vault (its own `maxSpendPerRun`, its own token allowlist,
its own budget). The flow is deliberately two-step:

1. **Rebuild and verify.** The API returns the stored rule, the client rebuilds `RuleParams`
   and hashes them with the same `RuleLib.paramsHash` the registry used. If the hash does not
   match the listing's published `params_hash`, the clone is refused — copying different
   parameters under the author's name would misrepresent the rule.
2. **Sign once.** The preview shows the author's sentence read-only; only then does the
   cloner sign `addRule` with `makePublic = false`. A copy is never re-listed, so clones
   cannot seed a chain of listings.

The guard refuses a clone, with a specific message, when:

| Condition                                              | Code                   |
| ------------------------------------------------------ | ---------------------- |
| The cloner has no Agent yet                            | `no_agent`             |
| The cloner already has 5 active rules                  | `rule_limit`           |
| The template is not supported on the funds chain       | `unsupported_template` |
| The rule spends more than the cloner's per-run ceiling | `vault_ceiling`        |
| The listing has no published hash                      | `missing_hash`         |
| The rebuilt hash differs from the published hash       | `hash_mismatch`        |

Nothing in the clone path reads or writes the author's Vault. `RuleRegistry` holds no funds
and has no call to a Vault, so a listing cannot become a withdrawal path (T207).

## Statistics provenance

`runs` and `success_rate` are **derived from indexed executions**, never from a field the
author can set (FR-040). The read model exposes:

- `rule_stats`: `count(*)` of executions per `(agent, rule_id)` and the confirmed fraction.
- `marketplace_feed`: live listings joined to the stored rule and its stats.

A rule that never executed has zero runs, not an estimate or a placeholder. The API sorts by
`newest`, `runs`, or `success_rate` with a stable `(agent, rule_id)` tie-break, and pages with
an opaque cursor holding the last row's identity so a page boundary cannot repeat or skip a
listing.

## Team badges

`author_badge` is stored on the listing row and rendered exactly as published:

- **team** — authored by the Rulebook team and seeded from
  `packages/shared/manifest/seed-rules.json`.
- **community** — everything else, including copies.

The badge is never inferred in the browser from an address or a name. The seed script
(`npm run seed:marketplace -w backend`) only writes the read model; it does not publish to
the registry. It is idempotent, so the first marketplace load is never empty (SC-013), and
every seeded row carries the team badge (FR-041). The leaderboard keeps the same split so a
team rule never hides among community entries and a community rule never inherits a team
claim.
