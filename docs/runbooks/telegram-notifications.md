# Telegram notifications

Workflow V2 sends private Telegram messages. Manage them under **Account & Vault**.

- **Funding alerts** cover low, empty, and restored credit, and unpaid fees. Rulebook checks
  the Agent's test REACT on Lasna and the Vault's test ETH on Unichain Sepolia in the background.
  Warnings use the same reserve levels as the workflow health status. A top-up clears outstanding fees first.
- **Action needed** covers failed runs, expired runs, and inactivity payout warnings. A payout
  warning links to **Check in** and gives the earliest payout time in UTC. A run with no receipt
  is reported only after the confirmed index for both chains has passed its deadline.
- **Workflow updates** include successful runs and alerts set up by the workflow. Each
  workflow has its own delivery preference. Messages link to Activity and the transaction.
  Routine skips appear in Activity.

The first confirmed connection enables all three types. **Telegram delivery** controls all
messages apart from user-requested tests. Disconnecting in **Account & Vault** or sending
`/stop` to the bot removes the chat connection and preserves delivery preferences.

Wallet verification is remembered per browser and automation account. Rulebook renews the
browser cookie when it loads verified settings. Choose **Forget this browser** in Account & Vault
to revoke that browser's session. A new browser or a cleared cookie requires a fresh signature.
Deploy through the production workflow so it configures the Vercel rewrites to the active backend.

## Rollout

1. Set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`, and `TELEGRAM_APP_ORIGIN` together in the backend environment. Rotate any previously shared bot token in BotFather. Use the bot username without `@`. Generate the webhook secret separately, for example with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. Use the public frontend HTTPS origin with no trailing slash, and include it in `CORS_ORIGINS`. Set `TELEGRAM_AGENT_FACTORIES` to a comma-separated list only if you also support additional trusted Lasna factories. Keep credentials in backend configuration. Use a separate bot for development or staging. [Lasna deployment records](../../deployments/lasna.json) · [Telegram bot setup](https://core.telegram.org/bots/features#botfather)
2. Apply the database migrations, including `0018_telegram_browser_sessions.sql`, with `npm run migrate -w backend` using the target database's migration connection. Deploy the backend and frontend with the same API configuration and matching Workflow V2 deployments. The Lasna factory in `WORKFLOW_V2_DEPLOYMENT` is trusted for workflow wallet verification. Confirm `/health` reports an active indexer and a reachable database and `/v1/telegram/availability?workflow=true` reports availability on both origins. The frontend proxies Telegram account requests to the backend so the browser can use a first-party cookie.
3. From a trusted shell with the backend environment available, run `npm run telegram:webhook -w backend -- <public-api-origin>`. The command checks the backend and bot identity, registers the webhook for private chat messages, and verifies the resulting URL.
4. With a dedicated test account, pair the bot and send a test message. Trigger a workflow and match its Telegram details to Activity and the transaction explorer. Mute its workflow updates and cause a run to fail, for example by revoking the USDC allowance for a balance refill. Check that the action alert explains the failure. Switch off **Action needed** and check that a later failure stays in Activity.
5. With the app closed, let the test account's fee credit run low, then top up and verify the recovery message. Trigger an inactivity payout warning, verify the deadline against the Vault, and check in before the payout can happen. Disconnect and reconnect, then confirm the saved preferences return.

## Local development

Set `TELEGRAM_UPDATES=polling` in `backend/.env` when using the localhost frontend. The
backend receives commands directly through Telegram while it runs. Use a development database
and a development bot with no registered webhook. Run one backend with polling enabled for that bot. In the
bot chat, `/start` explains how to generate a pairing link. Pairing still requires the
link generated in **Account & Vault** and confirmation back in Rulebook.

## Delivery and recovery

Workflow outcomes are matched with the indexed Lasna dispatch and the verified Vault. Funding checks are independent of workflow runs. Checks are due every two minutes and are leased in small batches. A chain read failure leaves the last verified status intact. Payout warnings take priority and the worker checks the current payout window before sending. Funding messages also get a fresh credit check before delivery.

The worker uses a durable queue, retries temporary failures, and honors Telegram’s rate-limit response. A request already in flight can finish after a mute or disconnect. If Telegram accepts a request and the response times out, a retry can produce a duplicate. A blocked chat can reconnect after unblocking the bot.

Backend logs include queue age, overdue funding checks, pending workflow alerts, and delivery
failure counts. For a missing message, check the relevant setting in **Account & Vault**, then
check the indexer and worker logs. For workflow updates, verify the run in Activity.
Previously unqueued workflow outcomes are eligible for catch-up for one day if delivery was
enabled at the time. [Telegram webhook status](https://core.telegram.org/bots/api#getwebhookinfo)
