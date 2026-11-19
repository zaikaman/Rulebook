# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Rulebook serves wallet users who want to set up and manage their own on-chain rules. They may know how to connect a wallet and approve a transaction while having little or no experience deploying contracts or running bots. Typical jobs include scheduling a buy, setting a price threshold, automating a transfer, creating an alert, or using a public rule as a starting point.

## Product Purpose

Rulebook is a no-code builder for personal on-chain automations. Users pick a template and fill in a readable sentence, review what the rule will do, then approve it in their wallet. They can return to check a rule's status, review what happened, or change whether it runs. Success means a user can create a rule, understand its limits and funding needs, and verify a run without relying on a developer.

## Positioning

Each sentence maps to a contract call. A wallet-owned Agent on Reactive Lasna evaluates matching events or schedules. When a rule fires, the Agent requests a callback to the user's Unichain Sepolia Vault. The Vault holds principal and enforces limits before it executes a swap or transfer. The indexer reads chain activity to make it easier to inspect.

## Operating Context

- The current experience uses testnet tokens. Users fund their own setup, monitoring, execution, and trades.
- The same wallet operates on two networks. Reactive Lasna handles rule configuration and monitoring. Unichain Sepolia handles the Vault, funds, and settlement.
- Account setup can resume when one contract already exists. Account & Vault shows watching credit, execution credit, and vault principal separately.
- Execution proof follows the origin event, Reactive evaluation, and destination transaction. The receipt and its source matter when confirming an outcome or explaining missing evidence.

## Capabilities and Constraints

- A rule follows a template with defined inputs and limits. The sentence editor exposes those inputs and previews the transaction before signing. [Composer documentation](docs/composer.md)
- Users can inspect, pause, resume, cancel, and reorder their rules. Vault owners can withdraw principal while automation is paused.
- A clone copies settings into the user's own Agent. A mirror follows an eligible leader execution under the follower's own limits and funding. [Marketplace documentation](docs/marketplace.md)

## Brand Commitments

Use the name Rulebook. Existing product copy uses concrete examples and names the action, network, asset, and amount when they affect what a user is approving. Keep testnet status visible where users make decisions about wallets or funds. [Project README](README.md)

## Evidence on Hand

The repository records explorer receipts, measured fees, and validation coverage. It identifies outcomes verified on testnet and flows verified with local fixtures, including the grouped mirror proof. Use those records when making claims about settlement, latency, cost, or verification. [Submission evidence](docs/submission-evidence.md), [testnet measurements](docs/measurements.md), [cost model](docs/cost-model.md)

## Product Principles

1. Make the rule readable before it is signed. Use one sentence with explicit template values. Keep the contract call available for inspection.
2. Make wallet approvals predictable. Show the network, intended action, and any amount or limit before asking for approval.
3. Keep ownership, control, and costs legible. Show who can change or stop a rule and which balance pays for each part of the workflow.
4. Let users verify outcomes. Link to actual receipts and explain when execution evidence is incomplete.

## Accessibility & Inclusion

Preserve keyboard operation for choosing rule settings and entering amounts. Keep wallet review dialogs keyboard-accessible, with visible focus and Escape cancellation. Respect reduced-motion preferences and convey network and rule status in text. [Accessibility tests](frontend/test/a11y.test.tsx), [composer keyboard tests](frontend/test/composer.a11y.test.tsx)
