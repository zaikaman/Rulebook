# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Rulebook serves wallet users who want to set up and manage their own on-chain rules and automations. They may know how to connect a wallet and approve a transaction while having little or no experience deploying contracts or running bots. Typical jobs include scheduling a recurring buy, setting a price threshold or trailing stop, automating an income sweep, refilling balances, setting an inactivity payout, receiving Telegram alerts, or using a public workflow as a starting point.

## Product Purpose

Rulebook is a no-code builder for personal on-chain automations. Users choose a recipe or build from a visual canvas, configure branching checks and actions, review what the workflow will do in clear English sentences, and approve it through their wallet. They can return to inspect active workflows, track executions, pause or adjust weekly spending budgets, and verify outcomes on-chain without relying on an intermediary or developer.

## Positioning

Each workflow maps to an on-chain program signed by the user. A wallet-owned Agent (an ERC-1967 proxy with owner-only opt-in UUPS upgrades) on Reactive Lasna evaluates incoming events and timer ticks across supported origin chains. When conditions are satisfied, the Agent dispatches a callback to the user's Vault proxy on the chosen settlement chain (Unichain Sepolia or Base Sepolia). The Vault holds principal and enforces limits, caps, and weekly budgets before executing any swap or transfer. Only the wallet owner can opt in to factory-approved implementation upgrades; no admin key or indexer can unilaterally upgrade user contracts or move funds. The indexer reads chain activity across all configured chains to make execution evidence transparent and inspectable.

## Operating Context

- The current experience uses testnet tokens. Users fund their own setup, monitoring, execution, and trades.
- The same wallet operates across Reactive Lasna (workflow configuration and event monitoring) and each supported funds chain (Unichain Sepolia and Base Sepolia for Vault principal and settlement, plus cross-chain origin triggers).
- Account setup resumes seamlessly when one contract already exists. Account and Vault views display watching credit, execution credit, and vault principal separately.
- Execution proof tracks the origin event, Reactive evaluation, and destination settlement transaction. Public proofs can be shared and inspected without connecting a wallet.
- Optional Telegram notifications deliver funding alerts, failure notices, inactivity warnings, and workflow updates directly to the user.

## Capabilities and Constraints

- Workflows are constructed on an interactive canvas with a node library of triggers, checks, and actions, or started from 13 curated recipes across trading, payments, and wallet safety. [Workflows documentation](docs/workflows.md)
- Each check can split execution into Yes and Otherwise paths, supporting up to 3 checks and 3 ordered actions per path (15 nodes total per program).
- An AI-powered Rulewright drafting assistant helps translate natural language requirements into validated workflow drafts without bypassing explicit wallet approval.
- Weekly spending budgets can be configured per asset (USDC and WETH) on the Vault, enforcing spending ceilings that reset every Monday at 00:00 UTC. [Weekly budgets runbook](docs/runbooks/weekly-budgets.md)
- Users can inspect, pause, resume, edit, and adjust budgets for their workflows. Vault owners retain full custody and can withdraw principal while automations are paused.
- The Marketplace enables owners to publish verified workflows from their Agent's on-chain program hash. Others can copy them into clean drafts with empty limits and recipients.
- Telegram integration provides background monitoring for low gas reserves, required check-ins, and execution outcomes. [Telegram notifications runbook](docs/runbooks/telegram-notifications.md)

## Brand Commitments

Use the name Rulebook. Existing product copy uses concrete examples and names the action, network, asset, and amount when they affect what a user is approving. Keep testnet status visible where users make decisions about wallets or funds. [Project README](README.md)

## Evidence on Hand

The repository records explorer receipts, measured fees, validation coverage, and multi-path testnet execution proofs. It identifies outcomes verified on testnet (including the 3-path branching income sweep, scheduled buy, recurring transfer, and alerts) and flows verified with local fixtures and fork settlements. Use those records when making claims about settlement, latency, cost, or verification. [Submission evidence](docs/submission-evidence.md)

## Product Principles

1. Make the workflow readable before it is signed. Use clear natural-language sentences and explicit values alongside the visual canvas. Keep the compiled contract call available for inspection.
2. Make wallet approvals predictable. Show the network, intended action, spending caps, and weekly limits before asking for approval.
3. Keep ownership, control, and costs legible. Show who can change or stop a workflow and which balance pays for each part of the execution.
4. Let users verify outcomes. Link to actual explorer receipts and explain when execution evidence is incomplete.

## Accessibility & Inclusion

Preserve keyboard operation for choosing workflow settings, navigating the node canvas, and entering amounts. Keep wallet review dialogs keyboard-accessible, with visible focus and Escape cancellation. Respect reduced-motion preferences and convey network and rule status in text. [Design-system browser checks](frontend/e2e/design-system.spec.ts)
