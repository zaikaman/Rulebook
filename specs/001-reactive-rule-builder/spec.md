# Feature Specification: Rulebook — No-Code On-Chain Personal Automations

**Feature Branch**: `001-reactive-rule-builder`

**Created**: 2026-11-16

**Status**: Draft

**Input**: User description: "@IDEA.md" — the locked Rulebook design document (a no-code builder where a personal money rule becomes a self-executing on-chain automation: the user keeps the money, the service pays the execution costs, and nobody has to keep a server awake).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create a personal automation account I actually own (Priority: P1)

A first-time user connects a wallet they already have. With one guided action the product creates their personal automation account on the network that watches the world, and their personal fund account on the network that holds their money. Both belong to the user's wallet. The product pays the setup and running costs so the user needs no fee tokens and no prior contract experience. The user's deposit stays in their own fund account and can be withdrawn at any time, without asking anyone.

**Why this priority**: Nothing else in the product exists without it, and it is the single claim that separates this product from every automation service that quietly takes custody. If this story is wrong, the product is a bot with extra steps.

**Independent Test**: From a fresh wallet with test funds only, complete setup, confirm both accounts exist and are controlled by that wallet, create no rule, and withdraw the full deposit back to the wallet. The withdrawal succeeding without any operator action proves custody is real.

**Acceptance Scenarios**:

1. **Given** a wallet with no prior account, **When** the user starts setup, **Then** both accounts are created, linked to each other, and shown as owned by the user's wallet, and the user is told which network each one lives on.
2. **Given** setup failed after the first account was created, **When** the user returns and retries, **Then** only the missing account is created, the two are linked, and the user ends with one complete account — never two duplicates and never a half-built one.
3. **Given** a user with funds in their account, **When** they withdraw, **Then** the full remaining principal arrives at their chosen address and no operator approval was required.
4. **Given** a user with no fee tokens on either network, **When** they create and run a rule, **Then** it works anyway because the product funds the execution costs.

---

### User Story 2 - Build a rule by assembling a sentence (Priority: P1)

The user picks one of the offered automation templates and fills its slots by choosing values — every Friday, 10 USDC, of ETH, only if price is below a number. The rule appears as a readable sentence built from labeled pieces, and beside it the exact transaction the rule will create updates live as the values change. The user signs once and the rule is live.

**Why this priority**: This is the product. Without a working composer there is no way for the target user (someone who has never deployed anything) to get a rule running.

**Independent Test**: Build a weekly scheduled buy end to end using only selections, sign once, and confirm the rule appears as active with the values chosen. No free-text prompt, code, or formula is used at any point.

**Acceptance Scenarios**:

1. **Given** a signed-in user with an account, **When** they choose a template and fill every slot, **Then** the preview sentence reads back the exact values chosen and the transaction preview matches those values.
2. **Given** a partly filled sentence, **When** the user tries to create the rule, **Then** creation is blocked and the unfilled or invalid slot is identified.
3. **Given** a completed sentence, **When** the user signs once, **Then** the rule is stored as active and is listed on their home view.
4. **Given** a rule is active, **When** the user pauses it and then resumes it, **Then** the status changes immediately and the automation framework stops and restarts evaluating it accordingly.

**Independent Test (reorder)**: With two active rules that can both be eligible in the same window, moving the second above the first changes which rule is evaluated first, and the order is retained after a page reload.

---

### User Story 3 - See proof that the loop actually ran (Priority: P1)

For any execution, the user opens a proof view that shows three linked rows: the event that started it, the automation-side acknowledgment, and the funds-side transaction that actually moved money, with the measured delay between the first and the last. Each row links out to a public explorer. The view works even if the product's own database is down.

**Why this priority**: It is both the submission requirement and the only thing that makes the "no server, no bot" claim credible. It is the highest-value screen in the product and is never cut.

**Independent Test**: Take a known executed rule, load the proof view, follow all three links to their explorers, and confirm the destination transaction is the one that moved funds. Then load the same view with the product's database unavailable and confirm it still renders from public chain data.

**Acceptance Scenarios**:

1. **Given** a rule has executed, **When** the user opens its proof view, **Then** all three rows are present, each links to a public explorer, and a single latency figure is shown from origin event to completed funds-side transaction.
2. **Given** an execution whose funds-side step was refused, **When** the user opens the proof view, **Then** the view shows the refusal with the underlying reason rather than a success state.
3. **Given** the product's database is unavailable, **When** a user opens a proof view for a known execution, **Then** the view is still built from public chain data.

---

### User Story 4 - Stay in control of what runs and what it may spend (Priority: P1)

The user sees every rule with its status, how many times it has run, when it last ran, and how much execution budget it has left. They can pause, resume, cancel, or reorder rules, and they can withdraw principal. Limits that exist for safety (maximum rules, per-run spend ceiling) are visible and explained rather than appearing as unexplained refusals.

**Why this priority**: An automation the user cannot stop is a liability, and a budget that runs out silently is how the demo dies. Pause/cancel and the budget readout are never cut.

**Independent Test**: Create a rule, pause it before its next window, confirm no execution occurs, resume, cancel, and withdraw. Separately, drive one account's budget low and confirm the owner is warned before the rule stops running.

**Acceptance Scenarios**:

1. **Given** an active rule, **When** the user pauses it before its next opportunity, **Then** it does not execute until it is resumed.
2. **Given** the user's rule count is at the documented maximum, **When** they try to add another, **Then** creation is refused with a message naming the limit and how to free a slot.
3. **Given** a rule's remaining execution budget falls below a warning level, **When** the user opens their home view, **Then** the rule is flagged as at risk of stopping and a top-up action is offered.
4. **Given** a paused or cancelled rule, **When** the system next evaluates the account, **Then** the account no longer pays attention to event types that no remaining active rule needs.

---

### User Story 5 - Choose from a small, honest catalog of rule types (Priority: P2)

The user picks from 13 templates: scheduled and price-driven buys, transfers on a schedule or on income, a balance floor, an inactivity trigger, and three alert-only rules that move no money. Every template reads as one plain sentence, and the price-based ones say "last traded price" rather than "current price" so nobody is misled about freshness.

**Why this priority**: Breadth of templates is what makes the product useful beyond one demo, but a single excellent template plus the proof page already delivers the core value. Templates are added incrementally behind one shared execution model.

**Independent Test**: Build every one of the 13 templates through the composer and confirm each renders a complete sentence, produces a distinct preview, and (for the alert-only three) never produces a funds movement.

**Acceptance Scenarios**:

1. **Given** the catalog, **When** the user browses templates, **Then** all 13 are listed and grouped as trading, personal transfer, and alert.
2. **Given** a rule built from a price-based template, **When** the user views it, **Then** the price basis is labeled as the last traded price with the time it was observed.
3. **Given** a rule built from a scheduled template, **When** the user views it, **Then** the timing is described as an approximate window rather than an exact time.
4. **Given** an alert-only rule whose threshold is crossed, **When** the rule fires, **Then** no funds move and the user sees an alert record in their activity.

---

### User Story 6 - Copy someone else's working rule (Priority: P2)

The user browses public rules, sees real run counts and success rates, and clones one into their own account with their own funds and their own limits. The original author gains nothing and controls nothing. Team-authored seed rules are clearly badged as such.

**Why this priority**: Clone is cheap to build, makes the product feel alive on day one, and turns a single user's success into an onboarding path. It is cut only after the leaderboard.

**Independent Test**: Clone a public rule, confirm it appears as the cloner's own active rule with their own budget and spend cap, and confirm the original author has no control over it and receives nothing from its executions.

**Acceptance Scenarios**:

1. **Given** a public rule, **When** a second user clones it, **Then** the clone is created in the second user's account with the second user's limits and no link back to the author's funds.
2. **Given** a rule that has run, **When** it is listed publicly, **Then** its run count and success rate are shown as computed from executions.
3. **Given** the marketplace on first load, **When** any user opens it, **Then** at least three rules are present and each is visibly badged as team-authored.

---

### User Story 7 - Understand what I am signing and on which network (Priority: P2)

Because a rule is signed on the watching network while the money lives on the funds network, the product must never let the user think their funds vanished. Every signature request states which network it belongs to and why, and the home view separates three balances — principal, funds-side execution cost, and watching-side execution credit — without ever presenting sponsored credit as the user's money.

**Why this priority**: Two networks with one wallet is the most likely source of user panic and judge confusion. It is cheap to get right and expensive to explain away.

**Independent Test**: Walk through setup, funding, rule creation, and withdrawal, confirming each signature prompt names its network and the three balances are never merged into one figure.

**Acceptance Scenarios**:

1. **Given** a signature request, **When** the prompt appears, **Then** it names the network, the account it targets, and the effect in plain language.
2. **Given** a fully funded account, **When** the user views their balances, **Then** principal, funds-side execution cost, and watching-side credit are shown separately and labelled by owner.
3. **Given** a wallet still connected to the network of the previous step, **When** the next step needs the other network, **Then** the product states the switch explicitly before requesting a signature.

---

### User Story 8 - Mirror another user's trade (Priority: P3)

When a leader's rule executes, a follower who attached a mirror to it executes a proportional action from their own account — one leader execution, two independent funds movements, both visible on one proof view. Mirrors never chain: a copied action cannot itself be copied. Duplicate notifications of the same leader execution never cause a second follower movement.

**Why this priority**: It is the strongest demonstration of the reactive loop and is committed to the release, but it depends on everything above it and is the one feature with a documented fallback (ship clone-only and say so) if time runs out.

**Independent Test**: Attach a mirror, cause one leader execution, and confirm exactly two funds-side transactions occur with distinct hashes on one proof view; replay the same leader notification and confirm no third transaction occurs.

**Acceptance Scenarios**:

1. **Given** a follower mirroring a leader's rule, **When** the leader executes, **Then** the follower executes an amount equal to the smaller of their per-run cap and the leader's amount scaled by their configured factor.
2. **Given** the same leader execution is delivered twice, **When** the follower evaluates it, **Then** only one follower execution occurs.
3. **Given** a follower's mirrored action would fill at an unacceptable output, **When** it executes, **Then** it skips rather than filling and the refusal is visible on the proof view.
4. **Given** a follower's mirrored execution, **When** another user attempts to mirror that follower, **Then** the follower's action is not offered as a mirrorable source.

---

### Edge Cases

- **The price is stale.** Price conditions compare with the most recent traded price, which on a quiet pair can be hours old. The product must show the observation time, and must never label the value as live.
- **The price moves between decision and execution.** The watching side decides from cached data; by the time the funds side acts, the trade may be worse. The funds side must refuse rather than fill at an unacceptable output, and the refusal must appear on the proof view with its reason.
- **The condition stays true.** A price-driven rule whose condition remains satisfied must latch or cool down, so a burst of identical events causes at most one funds movement.
- **The account runs out of execution credit.** The account goes quiet without an error. The owner must be warned before this happens and offered a top-up; any third party must also be able to top up an account.
- **The schedule is late.** A scheduled rule fires within an approximate window. A user expecting a precise time must be told in advance that it is approximate.
- **Setup half-completes.** The first account exists without its counterpart. Retry must complete the missing piece rather than create duplicates.
- **A rule is edited while active.** Changing a rule's values must either be an explicit replace (old rule stopped, new rule created) or be refused; a silent mid-flight change that alters spend limits is not acceptable.
- **Two rules are eligible in the same window and there is not enough capacity for both.** Evaluation order decides which runs; the one that does not run must be reported as skipped, not as failed.
- **Withdrawal while a rule is mid-execution.** Either the withdrawal completes and the execution refuses for insufficient funds, or the execution completes first; the user must never be left with an ambiguous state.
- **An execution was refused on the funds side but acknowledged on the watching side.** The product must report the destination outcome, never the acknowledgement.
- **One leader execution reaches many followers at once.** Each follower must be rate-limited so the burst does not exhaust their credit.
- **The user holds none of the token the rule spends.** The rule must fail visibly with a clear reason rather than silently doing nothing.
- **A rule's counterpart account has been emptied.** The automation must remain listed but must not spend credit attempting impossible executions.
- **The operator's database is lost.** Nothing user-facing that matters for proof must be lost; activity views must be rebuildable from public chain data.

## Requirements *(mandatory)*

### Functional Requirements

**Account, ownership, and custody**

- **FR-001**: The system MUST let a new user create a complete personal automation account — one component that watches events, one component that holds and moves funds — in a single guided flow, without writing code or installing software.
- **FR-002**: Both components MUST be owned and controlled exclusively by the user's wallet. The service operator MUST NOT hold any key, admin right, or signing capability over either component.
- **FR-003**: The system MUST create the watching component first, then the funds component, and MUST link them so only the user's own watching component can instruct the funds component to move money.
- **FR-004**: Setup MUST be resumable: if any step fails, retrying MUST complete the missing step and link the pair, and MUST NOT produce duplicate accounts or leave the user in a half-built state.
- **FR-005**: The operator MUST fund the execution costs of both components at creation so the user can create and run rules without acquiring fee tokens.
- **FR-006**: Any party MUST be able to add execution credit to any user's components; only the owner MUST be able to withdraw principal.
- **FR-007**: Users MUST be able to withdraw all remaining principal to an address of their choosing, at any time, without operator action.
- **FR-008**: The system MUST present principal, funds-side execution cost, and watching-side execution credit as three separately labelled balances, and MUST NOT present sponsored credit as the user's money.

**Rule building**

- **FR-009**: Users MUST create rules only by selecting a template and choosing values in fixed slots. The product MUST NOT offer a free-text prompt, expression, or code field as a way to define behavior.
- **FR-010**: The system MUST render each rule as a readable sentence assembled from labelled values in trigger → condition → action order.
- **FR-011**: Every selectable value MUST correspond to exactly one stored parameter of the rule, and changing it MUST change only that parameter.
- **FR-012**: The composer MUST display, live, the exact transaction the rule will produce, so the no-code claim can be checked without reading source.
- **FR-013**: Users MUST be able to pause, resume, and cancel a rule, and each action MUST take effect on the watching side without operator involvement.
- **FR-014**: Users MUST be able to reorder their rules, and that order MUST determine the order in which eligible rules are evaluated within the same window, with that decision visible to the user.
- **FR-015**: The system MUST enforce documented per-user limits — maximum active rules, a per-run spend ceiling, and a monthly execution cap — and MUST explain, in user terms, which limit was reached and how to proceed.
- **FR-016**: Creating or changing a rule MUST require only the user's own signature. The operator MUST NOT create, modify, pause, or cancel a rule on a user's behalf.
- **FR-017**: The system MUST refuse an incomplete or contradictory sentence, identify the offending slot, and never create a rule with a defaulted amount or threshold the user did not choose.

**Template catalog**

- **FR-018**: The product MUST offer 13 templates spanning trading rules, personal transfer rules, and alert-only rules, all built on one execution model.
- **FR-019**: Templates that the selected networks cannot support MUST be hidden rather than shown as broken.
- **FR-020**: Price-based rules MUST compare against the most recent traded price for the selected pair, and the UI MUST label it as the last traded price together with when it was observed.
- **FR-021**: Time-scheduled rules MUST be described to the user as approximate windows, not exact times.
- **FR-022**: Any rule that is not time-scheduled MUST fire at most once per satisfied condition, or cool down for a configured period, so repeated identical events cannot cause repeated spending.
- **FR-023**: Alert-only templates MUST NOT move funds under any input, and MUST record an alert in the user's activity.
- **FR-024**: Every template MUST land complete — buildable in the composer, listed in the catalog, documented, and exercised by its own validation — and MUST NOT be half-added.

**Execution and safety**

- **FR-025**: When a rule's condition is met, the system MUST carry out the rule without the user or the operator running a server, bot, or keeper process.
- **FR-026**: Before any funds movement, the funds component MUST re-verify the rule against live market state and MUST refuse the movement when the condition no longer holds.
- **FR-027**: Every funds-moving rule MUST be bounded by a per-run maximum spend, an allowed pair, a minimum acceptable output, and an expiry.
- **FR-028**: The minimum acceptable output MUST be derived from live market state at execution time, never from a price captured before the trigger.
- **FR-029**: When no active rule needs a given event type, the watching component MUST stop paying for it; pausing or cancelling the last such rule MUST release it.
- **FR-030**: The system MUST record every execution attempt with its funds-side outcome and MUST distinguish success from refusal.
- **FR-031**: The product MUST report execution status only from the funds-side network and MUST NOT report success from the watching-side acknowledgement.
- **FR-032**: When an account cannot execute because it lacks execution credit, the system MUST surface that state to the owner before the account goes quiet, and MUST show the remaining credit as a running figure.

**Proof and visibility**

- **FR-033**: For any execution, the system MUST present a proof view linking the originating event, the watching-side transaction, and the funds-side transaction, with the measured delay between the originating event and completion.
- **FR-034**: The proof view MUST be constructible from public chain state alone and MUST remain available and correct when the operator's own database is unavailable.
- **FR-035**: Every rule MUST display its status, run count, last run time, and remaining execution credit.
- **FR-036**: Every rule MUST display its recent executions with outcome, amounts moved, effective output, and a link to each transaction.
- **FR-037**: Every signature request MUST name the network it belongs to, the account it targets, and its effect in plain language.

**Marketplace and clone**

- **FR-038**: Users MUST be able to mark a rule public so that its parameters become discoverable by other users.
- **FR-039**: Users MUST be able to clone a public rule into their own account in one action; the clone MUST use the cloner's own funds, limits, and credit, and MUST grant the original author no control and no proceeds.
- **FR-040**: Public listings MUST show run count and success rate derived from actual executions, not self-reported values.
- **FR-041**: Team-authored seed rules MUST be visibly badged as team-authored and MUST NOT be presented as independent users.
- **FR-042**: The system MUST rank rules by run count and success rate on a leaderboard derived from executions.

**Mirror**

- **FR-043**: A user MUST be able to attach a mirror to another user's funds-moving rule so that a leader execution triggers a proportional execution from the follower's own account.
- **FR-044**: Mirror spend MUST be the smaller of the follower's per-run ceiling and the leader's amount scaled by a bounded factor configured per mirror.
- **FR-045**: A mirror MUST execute at most once per leader execution, and repeated delivery of the same leader execution MUST NOT produce a second follower execution.
- **FR-046**: A mirrored execution MUST NOT itself be mirrorable, so chains of copies cannot exist.
- **FR-047**: A mirrored execution MUST use the follower's own live minimum-output check and MUST skip rather than fill at an unacceptable output, with the skip visible on the proof view.
- **FR-048**: A follower MUST be limited to a bounded number of mirrored executions per hour, so one leader burst cannot exhaust the follower's credit.

**Platform and honesty**

- **FR-049**: All activity MUST remain on test networks in this release.
- **FR-050**: Adding a second funds-side network later MUST require no change to rule semantics; the release MUST ship one.
- **FR-051**: Every failure shown to a user MUST retain the underlying chain-level reason alongside a plain-language explanation; the system MUST NOT swallow an error or replace it with a generic message.
- **FR-052**: The product MUST state plainly, in its public documentation, that the operator holds no custody, that sponsored credit covers execution only, and that the indexing layer cannot move funds.

### Key Entities

- **Personal Automation Account (watching side)**: The user-owned component on the event network that holds the user's rules, watches the event types those rules need, decides whether a rule should fire, and asks for the funds-side action. Belongs to one owner; has its own execution credit; has an ordered list of rules.
- **Personal Fund Account (funds side)**: The user-owned component on the money network that holds principal, performs swaps and transfers, enforces spend limits, and reports outcomes. Exists once per user per network; trusts exactly one automation account.
- **Rule**: One automation, described as scope + trigger + condition + action + limits. Has a template, a network, a token pair, a per-run amount, a threshold, a secondary value (band, expiry, trailing amount, or inactivity period), status, run count, last-run time, and a fired-once flag.
- **Template**: One of 13 named patterns in the catalog, each mapping a trigger kind, a condition kind, and an action kind onto a fixed set of slots.
- **Rule Limits**: Per-run maximum spend, minimum acceptable output, expiry, cooldown, and per-user monthly cap; the boundary between what a rule may do and what it may not.
- **Execution Record**: One funds-side attempt with rule, amounts in and out, timestamp, outcome, and transaction reference.
- **Callback Record (Proof Trail)**: The per-trigger record held by the event network that carries the originating transaction, the automation-side transaction, the destination transaction, and any error — the authoritative proof source.
- **Public Listing**: A rule's template, parameters, author, and computed statistics, published for discovery and cloning; holds no funds and cannot execute anything.
- **Mirror Link**: A follower's attachment to a leader's rule, carrying the scale factor, the per-run ceiling, the hourly burst limit, and the deduplication key.
- **Execution Credit**: The prepaid capacity to wake the automation and to pay for funds-side callbacks; separate from principal and refundable or top-up-able by anyone.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time user with a funded wallet can go from landing to a live rule in under 3 minutes and no more than 4 clicks beyond signing.
- **SC-002**: A user can build any of the 13 templates without typing code, a formula, or a prompt — verified for all 13.
- **SC-003**: 95% of rule creations succeed on the first attempt in a recorded demo session, with no manual recovery step.
- **SC-004**: For 100% of executions, the proof view resolves all three rows (origin, automation, funds-side) within 30 seconds of the funds-side transaction confirming.
- **SC-005**: The proof view renders correctly for a known execution with the operator's database switched off, verified once before submission.
- **SC-006**: In 100% of withdrawal tests, the owner retrieves the full remaining principal with zero operator action.
- **SC-007**: No rule moves more than its configured per-run ceiling across a 100-run validation, and no rule ever moves more than its monthly cap.
- **SC-008**: A burst of 100 identical trigger events within one minute produces exactly one funds movement for a latched rule.
- **SC-009**: When the condition stops holding between decision and execution, zero funds move in every tested drift case, and the refusal is shown to the user.
- **SC-010**: Median delay from originating event to confirmed funds-side transaction is under 10 seconds on the shipping test networks.
- **SC-011**: One leader execution produces exactly two funds-side transactions visible on a single proof view, and replaying that leader event produces none.
- **SC-012**: A user can clone a public rule into a working, active rule in under 30 seconds.
- **SC-013**: The marketplace is never empty: at least 3 team-authored public rules are available on first load, each badged as team-authored.
- **SC-014**: A user can pause a rule and observe its status change within 5 seconds, and no execution occurs after the pause.
- **SC-015**: A user sees an at-risk execution-credit warning at least one full execution window before a rule would stop running.
- **SC-016**: 4 out of 5 first-time testers create a correct rule on their first attempt during a usability pass, without help.
- **SC-017**: No user funds are ever held, controllably moved, or withdrawable by the operator — verified by a custody audit of every privileged action in the system.
- **SC-018**: All three alert-only templates produce zero funds movements across their full validation runs.

## Constraints & Dependencies

- **Two networks, one wallet.** The rules live on the event network; the money lives on the funds network. A single wallet signing on both is expected, and the product must make the switch unmistakable.
- **The watching side cannot read the funds side.** All facts the watching side needs — prices, balances, activity — must arrive as events and be cached there. Conditions must therefore be expressible from event data alone.
- **Event subscriptions are exact-match only.** A rule subscribes to every event of a chosen type from a chosen source and evaluates the condition itself; thresholds cannot be expressed at subscription time.
- **The funds side must be self-funding in its own network's fee token**, and the watching side in its own. Two balances, two networks, neither substitutable.
- **Callbacks authenticate by sender.** The watching component's identity is supplied by the event network on every callback and must be checked first by the funds side.
- **Bounded work per trigger.** The watching side operates under a fixed per-trigger work ceiling, so the number of rules and the work per rule must stay bounded; evaluation order matters under that ceiling.
- **An unacknowledged or refused execution still costs the operator.** Correctness matters commercially, not only for users.
- **Test networks only.** Test networks have calm prices, thin liquidity, and faucet-gated funds; the product and its demonstration must account for that openly.
- **The sponsor is load-bearing.** If the operator stops topping up execution credit, automation stops — a documented, transparent limitation with permissionless top-up as the mitigation.
- **External dependencies**: an event network with a reactive execution facility, a funds network with a deployed token pair and swap router, publicly readable chain explorers, and a faucet path for test funds.

## Out of Scope

- Backtesting and simulation of historical rules
- Shipping to more than one funds-side network in this release (the design supports it; the release ships one)
- Perpetuals, lending, and position management of any kind
- Portfolio baskets, rebalancing across assets, or index products
- An AI rule writer or any natural-language-to-rule generation
- Tokens, points, referrals, or fee charges to users
- Off-chain notification delivery (email, push, chat); alerts are surfaced in-product only
- A node-graph or canvas-style rule builder
- Moving value between networks; the product never bridges funds
- Moving averages, RSI, or any technical-indicator layer

## Assumptions

- **The design document is locked.** `IDEA.md` is the source of truth for scope; where this specification and `IDEA.md` differ, `IDEA.md` wins.
- **Single destination network for the release.** Rule semantics are network-agnostic, but only one funds-side network is enabled and demonstrated.
- **Scheduled rules are approximate by design.** "Every Friday" means within a window on Friday, and the product says so.
- **Price means last traded price.** Every price condition and every displayed price is the last observed traded price with its observation time, never a live quote.
- **Custody is never taken.** The operator pays for execution and never holds a key that can move principal; the only funds movement paths are the user's own actions and the user's pre-approved rule actions.
- **Alerts are in-product only.** An alert rule produces a visible record; delivering notifications outside the product would require an always-on server and is deliberately excluded.
- **Team seed rules are acceptable.** The marketplace is seeded with 3–4 team-authored rules, badged as such, so it is not empty on first load.
- **A thin demonstration pair is acceptable.** Dramatic price movement is produced on a pair seeded by the team for demonstration purposes, and that fact is stated openly rather than hidden.
- **Rules are replaced, not edited in place.** Changing a rule's values stops the old rule and creates a new one, so spend limits can never change silently under a running rule.
- **Users are expected to hold, or be given, test-network funds.** The product provides a starter path but does not become a faucet.
- **Judge-facing proof must not depend on the operator's infrastructure.** Public chain data is the authoritative source for every claim of execution.
