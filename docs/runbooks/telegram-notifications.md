# Telegram notifications

Telegram delivers a private message when any rule raises an alert or completes execution. It uses Lasna alerts and confirmed Unichain Sepolia receipts for swaps, transfers, deposits, and mirrors. The first confirmed connection enables every rule. Users can turn off delivery, choose a default for new and existing rules, and override individual rules from Account or the rule detail page. Disconnecting in Account or sending `/stop` to the bot removes the chat connection and preserves delivery preferences.

## Rollout

1. Rotate the previously shared bot token using BotFather. Set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_APP_ORIGIN`, and `TELEGRAM_AGENT_FACTORIES` together in the backend environment. Use the bot username without `@`. Generate the webhook secret separately, for example with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. Use the public frontend HTTPS origin with no trailing slash, and include it in `CORS_ORIGINS`. For `TELEGRAM_AGENT_FACTORIES`, list the trusted Lasna AgentFactory addresses separated by commas. Keep credentials in backend configuration. Use a separate bot for development or staging. [Lasna deployment records](../../deployments/lasna.json) · [Telegram bot setup](https://core.telegram.org/bots/features#botfather)
2. Apply the database migrations with `npm run migrate -w backend` using the target database's migration connection. Deploy the backend and frontend with the same API configuration. Confirm `/health` reports an active indexer and a reachable database.
3. From a trusted shell with the backend environment available, run `npm run telegram:webhook -w backend -- <public-api-origin>`. The command checks the backend and bot identity, registers the webhook for private chat messages, and verifies the resulting URL.
4. With a dedicated test account, pair the bot and send a test message. Trigger an enabled rule and match its Telegram receipt link to its execution or alert history. Mute another rule and confirm its receipt appears in Rulebook while the Telegram chat stays quiet. Disconnect, reconnect, and confirm the saved preferences return.

## Delivery and recovery

Delivery starts after the indexer's confirmation window for the event's chain. The worker uses a durable queue, retries temporary failures, and honors Telegram’s rate-limit response. A request already in flight can finish after a mute or disconnect, and a request that times out after Telegram accepts it can produce a duplicate when retried. A blocked chat can reconnect after unblocking the bot. Test messages use the same queue and can be sent while rule delivery is off.

Backend logs include queue age and delivery failure counts. For a missing alert, first check the Lasna receipt in Rulebook, then check the effective delivery setting, the webhook configuration, and the worker logs. A rebuild of the chain index leaves Telegram connections and preferences intact and does not send historical alerts. [Telegram webhook status](https://core.telegram.org/bots/api#getwebhookinfo)
