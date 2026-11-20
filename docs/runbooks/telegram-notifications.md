# Telegram notifications

Workflow V2 sends a private Telegram message after a workflow run is confirmed on Unichain
Sepolia. The message links to the run in Activity and to its transaction. Account & Vault has
pairing, the account-wide delivery switch, the default for workflows, and a test message. Each
activated workflow also has its own delivery preference on its detail page.

The first confirmed connection enables delivery for all workflows. Disconnecting in Account & Vault or sending `/stop` to the bot removes the chat connection and preserves delivery preferences.

## Rollout

1. Set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`, and `TELEGRAM_APP_ORIGIN` together in the backend environment. Rotate any previously shared bot token in BotFather. Use the bot username without `@`. Generate the webhook secret separately, for example with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. Use the public frontend HTTPS origin with no trailing slash, and include it in `CORS_ORIGINS`. Set `TELEGRAM_AGENT_FACTORIES` to a comma-separated list only if you also support additional trusted Lasna factories. Keep credentials in backend configuration. Use a separate bot for development or staging. [Lasna deployment records](../../deployments/lasna.json) · [Telegram bot setup](https://core.telegram.org/bots/features#botfather)
2. Apply the database migrations, including `0015_workflow_telegram.sql`, with `npm run migrate -w backend` using the target database's migration connection. Deploy the backend and frontend with the same API configuration and matching Workflow V2 deployments. The Lasna factory in `WORKFLOW_V2_DEPLOYMENT` is trusted for workflow wallet verification. Confirm `/health` reports an active indexer and a reachable database and `/v1/telegram/availability?workflow=true` reports availability.
3. From a trusted shell with the backend environment available, run `npm run telegram:webhook -w backend -- <public-api-origin>`. The command checks the backend and bot identity, registers the webhook for private chat messages, and verifies the resulting URL.
4. With a dedicated test account, pair the bot and send a test message. Trigger a workflow and match its Telegram links to the confirmed run in Activity and the transaction explorer. Mute a workflow and confirm its next run appears in Activity while the Telegram chat stays quiet. Disconnect, reconnect, and confirm the saved preferences return.

## Local development

Set `TELEGRAM_UPDATES=polling` in `backend/.env` when using the localhost frontend. The
backend receives commands directly through Telegram while it runs. Use a development database
and a development bot with no registered webhook. Run one backend with polling enabled for that bot. In the
bot chat, `/start` explains how to generate a pairing link. Pairing still requires the
link generated in **Account & Vault** and confirmation back in Rulebook.

## Delivery and recovery

Delivery starts when both the Lasna dispatch and Unichain Sepolia outcome are confirmed and indexed. The worker uses a durable queue, retries temporary failures, and honors Telegram’s rate-limit response. A request already in flight can finish after a mute or disconnect, and a request that times out after Telegram accepts it can produce a duplicate when retried. A blocked chat can reconnect after unblocking the bot. Test messages use the same queue and can be sent while workflow delivery is off.

Backend logs include queue age and delivery failure counts. For a missing message, check that the run is confirmed in Activity, then check the effective delivery setting, the webhook configuration, and the worker logs. A chain-index rebuild leaves connections and preferences intact. A previously unqueued run can deliver during catch-up if it occurred in the past 24 hours and the delivery settings already allowed it at the time. [Telegram webhook status](https://core.telegram.org/bots/api#getwebhookinfo)
