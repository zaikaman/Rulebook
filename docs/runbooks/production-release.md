# Production releases

A successful **CI** run for a push to `main` triggers **Deploy production**. The release uses the commit that passed CI. GitHub Actions builds the Vercel frontend, asks Heroku to release the backend from that same commit, and waits for the new web dyno and Marketplace API. It then publishes the Vercel build and checks the public Marketplace page and API.

## One-time setup

Use a GitHub environment named `production`. Add these environment settings.

| Type     | Name                    | Value                                                                               |
| -------- | ----------------------- | ----------------------------------------------------------------------------------- |
| Secret   | `HEROKU_API_KEY`        | A Heroku credential authorized to deploy the backend app and read its configuration |
| Secret   | `VERCEL_TOKEN`          | Vercel deployment token scoped to the frontend project                              |
| Variable | `HEROKU_APP_NAME`       | Existing Heroku app name: `rulebook-backend`                                        |
| Variable | `HEROKU_FIRST_WEB_DYNO` | Optional `basic` to start one paid Basic web dyno on the first release              |
| Variable | `HEROKU_API_URL`        | Public HTTPS origin of the Heroku app                                               |
| Variable | `PRODUCTION_WEB_URL`    | Public HTTPS origin of the Vercel production site                                   |
| Variable | `VERCEL_ORG_ID`         | ID of the team that owns the Vercel project                                         |
| Variable | `VERCEL_PROJECT_ID`     | ID of the Vercel frontend project                                                   |

Set the optional GitHub environment variable `WORKFLOW_V2_ACTIVATION` to `true` when new workflow activations should be enabled. The release workflow passes it to the frontend build.

In Vercel, set the root directory to `frontend`, enable source access from outside that directory, and use Node 24. The workflow supplies the public API URL, testnet `VITE_WORKFLOW_V2_DEPLOYMENT` from `deployments/workflows-v2.json`, and (when `deployments/workflows-v2-mainnet.json` is committed) `VITE_WORKFLOW_V2_MAINNET_DEPLOYMENT` plus any configured mainnet/testnet RPC overrides from the `production` GitHub environment variables to the frontend build.

In Heroku, use the Node.js buildpack and one enabled web dyno. With `HEROKU_FIRST_WEB_DYNO=basic`, the first release can start one paid Basic web dyno for a new app. Later releases leave the existing formation as configured. Set `DATABASE_URL` to a PostgreSQL connection Heroku can reach. If the Supabase direct endpoint is IPv6-only, use its session pooler. Keep the existing Supabase and RPC settings. Set `INDEXER_ENABLED=true`, `WORKFLOW_V2_DEPLOYMENT` from `deployments/workflows-v2.json`, and (once `deployments/workflows-v2-mainnet.json` exists) `WORKFLOW_V2_MAINNET_DEPLOYMENT` from `deployments/workflows-v2-mainnet.json` (both are verified before every release). Include the public frontend origin in `CORS_ORIGINS`. Heroku applies pending migrations before the new dyno takes traffic. The job fetches its source archive from public GitHub at the exact commit that passed CI. [Deployment record](../../deployments/workflows-v2.json) · [Heroku release phase](https://devcenter.heroku.com/articles/release-phase)

GitHub Actions is the deployment trigger. If an existing host has automatic Git deploys enabled, turn those off before the first release through Actions.

## If a release fails

Open the GitHub Actions run. Heroku build and migration errors point to the build or release in Heroku Activity. If the API checks fail, check the new web dyno, database, RPCs, and the frontend origin in `CORS_ORIGINS`. Fix the problem and rerun the failed deployment for the current `main` commit.

To undo an app release, promote the last working application version on each host. Database changes stay applied, so migrations must also work with the previous app version unless explicitly marked forward-only below.

## Forward-only migrations

Take a database snapshot/backup before applying any forward-only migration in production. If a release fails after a forward-only migration is applied, roll forward with a fix or restore the pre-migration database snapshot rather than promoting an older app image against the migrated schema:

- `0026_cross_environment_scoping.sql` — rewrites bare `0x...` deployment keys to `5318007:0x...` and replaces single-environment RPC signatures (`workflow_v2_health` and `telegram_*` functions) with `automation_chain`-scoped signatures. Pre-0026 backend releases cannot read the namespaced rows or call the replaced RPC signatures.
- `0028_environment_scoped_sessions_and_health.sql` — replaces `assistant_admit`, `rulewright_enqueue`, and `workflow_v2_health` signatures to enforce network scoping and `(chain, workflow_id)` health keying. Pre-0028 backend releases will fail RPC calls against these updated signatures.
