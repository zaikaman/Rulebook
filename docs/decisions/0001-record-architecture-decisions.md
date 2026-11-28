# 0001 — Monorepo layout and pinned toolchain

**Date**: 2026-11-16
**Status**: Accepted

## Context

Three runtimes must agree on one set of Workflow V2 ABIs and chain constants: Solidity
contracts, a Node indexer/API, and a browser SPA. Foundry and npm resolve artifacts
differently, and a contest build has one person maintaining all of it.

## Decision

1. **npm workspaces monorepo** with `contracts`, `packages/shared`, `backend`, `frontend`.
   npm was chosen over pnpm because both Heroku's Node buildpack and Vercel's build handle
   npm workspaces with no extra configuration.
2. **`packages/shared` ABIs are generated, not hand-maintained**: a script copies the
   compiled Workflow V2 artifacts into `src/abi` and regenerates `src/abi/index.ts`.
3. **`module: nodenext` in backend/shared** so emitted ESM actually runs on Node 24 without
   a bundler. Relative imports inside those packages carry `.js` extensions.
4. **Pinned versions**: Solidity `0.8.29` (Reactive's `AbstractCallback` requires `^0.8.29`),
   Node `24` LTS. Solidity dependency revisions are recorded in `contracts/foundry.lock` and the Git submodule pointers. `contracts/remappings.txt` maps Solidity import paths.
5. **Foundry artifacts are copied into `packages/shared/src/abi`** by a script; no ABI is
   ever hand-written.

## Consequence

- `packages/shared` must be built before `backend` or `frontend` typecheck. Root and CI
  scripts enforce that order.
- `contracts` is an npm workspace with forge-backed scripts, so `npm run build -w contracts`
  requires Foundry on the machine.
- Any new chain constant lands in `contracts/src/chain/ChainConfig.sol` and
  `packages/shared/src/chains.ts` in the same commit.

## Solidity dependency pins

Installed with `forge install --no-commit` on 2026-11-16 (forge Version: 1.9.0). Pins are commits, not branches:

| Dependency             | Nearest tag | Commit       |
| ---------------------- | ----------- | ------------ |
| forge-std              | v1.17.0     | f3dae6e6ee38 |
| reactive-lib           | v0.2.0      | d664678a7d86 |
| openzeppelin-contracts | v5.7.0      | cab19933c33c |

When updating a pin, keep this table and the lockfile aligned. [Foundry lockfile](../../contracts/foundry.lock)
