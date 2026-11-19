# The composer

Choose a template and set its values, then read the resulting sentence and inspect the
transaction before signing on Reactive Lasna. Enter values in standard units: token amounts such
as `0.1` USDC, prices such as `2500` USDC/WETH, percentages such as `2.5`, repeat intervals such
as `1 day`, and expiries as a local date and time.

## The sentence model

A template is a sentence with named blanks. `packages/shared/manifest/templates.json` is the only
source of truth:

```json
"Every {schedule}, spend {amount_in} {token_in} to buy {token_out}."
```

The composer renders that string using the values from its settings. Slot definitions carry
the kind (`schedule`, `amount`, `token`, `price`, `percent`, `duration`, `address`), whether the
slot is required, and its `min`/`max`/`unit`. Those same values generate the Solidity catalog, the
documentation table, and the fixtures, so a manifest edit cannot silently drift from the contract.

It is not a node canvas. There are no wires to connect and no arbitrary graphs: the trigger,
condition, and action are fixed by the template, and the only decisions are the values in the
blanks. That is what keeps a rule readable as one sentence and auditable as eight packed words
on chain.

## Token amounts and receive estimates

`encodeAddRule` rejects any slot key the template does not declare, any value that is not an
address for a token/address slot, any value that is not a whole number for a numeric slot, any
value outside the slot's manifest bounds, and any pair whose input and output tokens are equal.
The composer converts decimal amounts exactly into integer base units using the selected token's
precision. It checks the template limit, vault spend cap, and vault token configuration before
preparing a rule that moves funds. The server route `POST /v1/encode/preview` calls the same
encoder with base-unit values, so both produce the same calldata.

Swap rules spend a fixed amount per run. To start from a receive target, get a quote from the
configured pool and apply the quoted spend if it fits the per-run cap. The amount received at
execution depends on the pool at that time.

## Settings and calldata

`Rule` has eight packed words. Several slot keys share a field because a template never needs both
meanings at once:

| Slot key                        | `Rule` field           | Notes                                                                   |
| ------------------------------- | ---------------------- | ----------------------------------------------------------------------- |
| `amount_in`                     | `amountIn`             | Money templates only; alert templates must encode `0`.                  |
| `threshold`                     | `threshold`            | Price or amount threshold, depending on template.                       |
| `secondary`                     | `secondary`            | Dip band (bps), trailing band (bps), expiry (unix seconds), or days.    |
| `schedule`                      | `secondary`            | Cron interval in seconds, unless the template already uses `secondary`. |
| `schedule` (with `secondary`)   | `threshold`            | Templates 2 and 10 need both a cron interval and a second value.        |
| `pair`                          | `pair`                 | Price pair for price templates.                                         |
| `destination` / `source_wallet` | `pair`                 | Personal templates store their recipient in `pair`.                     |
| `token_in` / `token_out`        | `tokenIn` / `tokenOut` | Both must be non-zero for a swap.                                       |

`draftFromRule` inverts this mapping, which is how a stored rule is rendered back as the exact
sentence its owner signed.

## Worked example 1 — template 1, DCA

Sentence: `Every {schedule}, spend {amount_in} {token_in} to buy {token_out}.`

Choices: `schedule` = `86400` (every day), `amount_in` = `10000000` (10 USDC),
`token_in` = USDC, `token_out` = WETH.

Calldata is `addRule(rule, false)` where:

```text
template  = 1
chainId   = 1301          (the funds network the rule targets)
pair      = USDC/WETH     (the template declares no pair slot, so the manifest default is used)
tokenIn   = USDC
tokenOut  = WETH
amountIn  = 10000000
threshold = 0
secondary = 86400         (the schedule, because template 1 has no secondary slot)
```

The page shows this calldata before the signature; the Lasna receipt then yields the rule id.

## Worked example 2 — template 9, BalanceFloor

Sentence: `When the vault balance of {token_in} falls below {threshold}, pull {amount_in} of {token_in} from {source_wallet}.`

Choices: `token_in` = USDC, `threshold` = `5000000`, `amount_in` = `10000000`,
`source_wallet` = an approved wallet.

```text
template  = 9
chainId   = 1301
pair      = source_wallet (template 9 has no pair slot; the recipient lives in pair)
tokenIn   = USDC
tokenOut  = 0             (this template transfers, it does not swap)
amountIn  = 10000000
threshold = 5000000
secondary = 0
```

Two invariants hold for both examples: no alert template can encode a non-zero `amountIn`, and the
composer refuses to produce calldata while any required blank is empty.
