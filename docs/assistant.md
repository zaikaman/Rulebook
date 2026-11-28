# Bookkeeper assistant

Bookkeeper is the read-only account assistant inside the workspace. It answers questions about the connected wallet's Rulebook data and explains the product without an intermediary.

## Access

1. The user opens Bookkeeper from the workspace header, the mobile bar, or the focused-layout launcher.
2. The backend creates a five-minute challenge. The user signs the Bookkeeper message with the connected wallet. The signature costs no gas and authorizes no transaction.
3. The backend verifies the signature against the wallet and the configured frontend origin, then returns a session token valid for 7 days (unless revoked earlier via `DELETE /v2/assistant/session`). The token is held in memory for the page lifetime, so reloading the page asks for a new signature.
4. The token is scoped to one wallet. The model never receives a wallet address from the request body; the backend reads it from the session.

Every chat request is serialized per wallet. The daily limit is 80 user messages per wallet and 3,000 globally, with a 12 requests-per-minute route limit. Expired signing challenges and expired sessions are cleaned up in the background. Conversations and messages are deleted 30 days after their last activity.

When the backend has a public demo account configured, visitors can start a two-hour testnet session without signing. Demo conversations are scoped to the session that started them, and Telegram data is unavailable. Each demo session can ask up to 12 questions within the shared demo account budget of 80 questions per UTC day. Rulewright demo drafts have a shared budget of 20 jobs per UTC day for the configured wallet.

## Context discipline

The model gets only:

- the connected wallet address and current page as context hints,
- the last 12 messages in the conversation,
- the current question.

It receives no account data up front. It calls a tool only when the question needs one, and the tool result is appended to that turn. The system prompt forbids stating any balance, status, run, transaction, cap, listing, or notification fact that a tool did not return. A null value means the balance is unavailable because the contract does not exist yet or the read failed; it must be reported as unavailable, never as zero.

## Tools

Every tool is read-only and scoped to the session owner. The model cannot widen the wallet scope by passing an address.

| Tool                   | Reads                                                                                                                      | Source                                               |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `get_account_overview` | Agent and Vault addresses, Vault and wallet token balances, watching credit, execution credit, debt, refill allowance      | Lasna, Unichain, and Base RPC                        |
| `list_workflows`       | Up to six saved workflows balanced across chains with status, trigger, readable paths, per-run caps, weekly budget, expiry | Agent and Vault contracts                            |
| `get_workflow`         | One workflow by id                                                                                                         | Agent and Vault contracts                            |
| `list_runs`            | Newest indexed runs, optionally filtered by workflow or status                                                             | `workflow_v2_activity`                               |
| `get_run`              | One indexed run and its origin, Lasna, and settlement transactions                                                         | `workflow_v2_activity`                               |
| `search_marketplace`   | Public listing titles and descriptions                                                                                     | `workflow_v2_market_listings`                        |
| `get_notifications`    | Telegram connection, default mode, per-workflow preferences                                                                | `telegram_accounts`, `telegram_workflow_preferences` |

The provider may call at most eight tools across at most four model rounds. The final round is sent without tools so the model always gets a chance to explain what it found. A tool failure is returned to the model as an error object and shown as a failed trace row.

## Configuration

Bookkeeper uses `GEMINI_MODEL`, `GEMINI_BASE_URL`, and `GEMINI_API_KEY`. Configure the workflow deployment for each network you serve using `WORKFLOW_V2_DEPLOYMENT` for Testnet and `WORKFLOW_V2_MAINNET_DEPLOYMENT` for Mainnet.

Apply all pending backend migrations, including the assistant session, network scoping, and demo session migrations.

```bash
npm run migrate -w backend
```

The migrations create the session, conversation, and message tables, the admission, rollback, revocation, and finish functions, and cleanup helpers. Verified sessions expire after 7 days unless revoked earlier via `DELETE /v2/assistant/session` (reloading the page or switching wallets discards only the in-memory browser token). The migrations revoke all table and function access from `anon` and `authenticated` and grant the backend service role only.

## Privacy and limits

- The model provider receives the question, recent conversation turns, and only the tool results the question needed. It does not receive a private key, a wallet connector, or the raw Telegram chat id.
- Answers are advisory. The panel says so, and the assistant cannot sign or move funds.
- Tool results are capped before they are sent to the provider. A result that exceeds the cap is replaced with a request for a smaller slice.
- The assistant never returns raw transaction links the model invented. The backend attaches references (workflow, run, listing, account, activity) from the tools that actually ran, and the UI renders them as chips.

## Failure handling

- A provider timeout, unavailable endpoint, malformed stream, empty answer, or tool-loop limit returns one SSE `error` event with plain-language copy. Partial text is kept in the conversation only when some text was already shown.
- A 401 from any assistant route clears the in-memory session and asks for wallet verification again.
- A missing conversation id returns 404 and asks for a new chat; it never opens another wallet's conversation.
