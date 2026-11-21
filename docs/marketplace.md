# The workflow and rule marketplace

The marketplace allows authors to publish their automations so other users can discover, inspect, and copy them. It serves as a **discovery and template sharing surface, not a pooled custody system**: copying an automation never grants funds access, delegate authority, or control to the original author.

## Workflow V2 marketplace

The current application uses the V2 Workflow Marketplace (`frontend/src/workflows/MarketplaceV2.tsx` and `backend/src/workflows/`):

### Publishing a workflow

1. **On-chain program verification**: Publishing reads the exact program hash from the owner's `WorkflowAgentV2` on Reactive Lasna. The listing cannot drift from what is enabled on-chain.
2. **Immutable reference**: The published listing stores the title, category, trigger type, and compiled program structure.
3. **Non-invasive lifecycle**: Publishing a workflow, or subsequently unpublishing it, has zero effect on the workflow's active execution. It continues running on the author's Agent and Vault.

### Copying a workflow

When a user copies a workflow from the marketplace:

1. **Clean draft instantiation**: The program is decoded and loaded into the user's workflow builder as a new draft.
2. **Safety sanitization**: All sensitive and account-specific fields are cleared:
   - Recipient addresses
   - Watched wallet addresses
   - Expiry timestamps
   - Per-run spend caps and weekly budgets
3. **Independent authorization**: The copier configures their own limits, funding, and recipients, then signs the two required authorizations (`authorizeWithWeeklyBudget` on their Unichain Vault and `enable` on their Lasna Agent).
4. **Isolated execution**: The copier's workflow runs exclusively against their own Vault and funds. The author cannot modify, pause, or draw from the copied instance.

## Statistics and provenance

Marketplace statistics are derived from indexed execution receipts:

- **Run counts**: Number of confirmed callbacks recorded on-chain.
- **Success rate**: Ratio of successful destination transactions (`CONFIRMED`) to total attempted dispatches.
- **Public proofs**: Every execution links to the origin event, Reactive Lasna evaluation, and destination settlement transaction.

Metrics are computed strictly from indexed chain logs, never from author-supplied self-reports.

## Legacy V1 rule marketplace

Rulebook's earlier V1 system included a single-rule registry (`RuleRegistry.sol`):

- **Listing via `addRule`**: `Agent.addRule(rule, true)` called `RuleRegistry.list(address(this), ruleId, "")` after storing the rule. The registry hashed the stored rule bytes into `paramsHash`.
- **Delisting**: The author could call `delist` to remove the listing from public view while leaving the automation running on their own account.
- **Clone validation**: The client recomputed `paramsHash` and verified it against the registry before signing, ensuring that parameters could not be spoofed under an author's name.

The V2 marketplace supersedes this by supporting complete multi-node branching workflows while preserving the same principles of cryptographic verification and complete custody separation.
