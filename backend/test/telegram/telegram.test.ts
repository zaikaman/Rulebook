import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';

import { PGlite } from '@electric-sql/pglite';
import {
  createWorkflowV2Recipe,
  encodeWorkflowV2,
  getChain,
  LASNA_CHAIN_ID,
  telegramSignIn,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  workflowV2Action,
  workflowVaultV2Abi,
  type Address,
  type TelegramChallenge,
} from '@rulebook/shared';
import {
  encodeAbiParameters,
  encodeEventTopics,
  erc20Abi,
  toFunctionSelector,
  verifyTypedData,
  zeroAddress,
  type PublicClient,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createRepositories } from '../../src/db/repositories/index.js';
import { InMemoryStore } from '../../src/db/store.js';
import { CursorStore } from '../../src/indexer/cursors.js';
import { buildServer } from '../../src/server.js';
import { fundingPreflight, TelegramFundingAlerts } from '../../src/telegram/fundingAlerts.js';
import { TelegramService, type TelegramDatabase } from '../../src/telegram/service.js';
import { TelegramPoller } from '../../src/telegram/poller.js';
import { sendTelegramMessage } from '../../src/telegram/worker.js';
import { payoutPreflight, WorkflowTelegramAlerts } from '../../src/telegram/workflowAlerts.js';

const agent = '0x1111111111111111111111111111111111111111' as const;
const otherAgent = '0x2222222222222222222222222222222222222222' as const;
const vault = '0x3333333333333333333333333333333333333333' as const;
const unavailableVault = '0x4444444444444444444444444444444444444444' as const;
const deployment = '0x5555555555555555555555555555555555555555' as const;
const owner = privateKeyToAccount(generatePrivateKey());
const wrongWallet = privateKeyToAccount(generatePrivateKey());
const telegramConfig = {
  botUsername: 'RulebookFixtureBot',
  botToken: 'unused',
  webhookSecret: 'a'.repeat(32),
  appOrigin: 'https://rulebook.example',
  factories: [agent],
};
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const claimedSchema = z.object({ id: z.string(), lease: z.string() });
const db = new PGlite();
let testAddress = 100;

function database(): Pick<TelegramDatabase, 'rpc' | 'createSession' | 'session' | 'forgetBrowser'> {
  return {
    async rpc(name, params, schema) {
      const entries = Object.entries(params);
      const argumentsSql = entries.map(([key], index) => `${key} => $${index + 1}`).join(', ');
      const values = entries.map(([, value]) => value);
      if (
        [
          'telegram_claim',
          'telegram_claim_alert_delivery',
          'telegram_prepare',
          'telegram_pending_notifications',
        ].includes(name)
      ) {
        return schema.parse(
          JSON.parse(
            JSON.stringify((await db.query(`select * from ${name}(${argumentsSql})`, values)).rows),
          ),
        );
      }
      const { rows } = await db.query<{ result: unknown }>(
        `select ${name}(${argumentsSql}) as result`,
        values,
      );
      return schema.parse(rows[0]?.result === '' ? null : rows[0]?.result);
    },
    async createSession(nonce, target, token, expiresAt) {
      const { affectedRows } = await db.query(
        `insert into telegram_sessions values ($1, $2, $3, to_timestamp($4)) on conflict do nothing`,
        [nonce, digest(token), target, expiresAt],
      );
      return affectedRows === 1;
    },
    async session(target, token, browser = false) {
      const hash = digest(token);
      const { rows } = await db.query<{ expires: number | null }>(
        `select extract(epoch from expires_at)::int as expires from telegram_sessions
        where agent = $1 and token_hash = $2
          and case when $3 then expires_at is null else expires_at > now() end`,
        [target, hash, browser],
      );
      return rows[0] ? { hash, expiresAt: rows[0].expires } : null;
    },
    async forgetBrowser(target, token) {
      await db.query(
        `update telegram_sessions set token_hash = gen_random_uuid()::text,
          expires_at = now() + interval '5 minutes'
        where agent = $1 and token_hash = $2 and expires_at is null`,
        [target, digest(token)],
      );
    },
  };
}

const store = new InMemoryStore();
const repositories = createRepositories(store);
const databaseAdapter = database();
const workflowClient = {
  getTransactionReceipt: async () => ({
    blockNumber: 10n,
    logs: [
      {
        address: vault,
        topics: encodeEventTopics({
          abi: workflowVaultV2Abi,
          eventName: 'Step',
          args: { runId: `0x${'b'.repeat(64)}`, index: 0 },
        }),
        data: encodeAbiParameters(
          [{ type: 'uint8' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'address' }],
          [1, 20_000n, 0n, otherAgent],
        ),
      },
    ],
  }),
  readContract: async ({ functionName }: { functionName: string }) =>
    functionName === 'authorizations'
      ? [`0x${'c'.repeat(64)}`, 2n, 1n, true]
      : [0n, 0n, 0n, 0n, payoutDeadline, 0n, 0n, false],
  getBlock: async () => ({ number: 20n, timestamp: BigInt(Math.floor(Date.now() / 1000)) }),
} as unknown as PublicClient;
let payoutDeadline = 0n;
const workflowAlerts = new WorkflowTelegramAlerts(
  databaseAdapter,
  workflowClient,
  deployment,
  telegramConfig.appOrigin,
);
const telegram = new TelegramService(
  telegramConfig,
  databaseAdapter,
  {
    async verifyExecutionVault(target, chainId, emitter) {
      if (emitter === unavailableVault) throw new Error('Temporary chain RPC error');
      return target === agent && chainId === UNICHAIN_SEPOLIA_CHAIN_ID && emitter === vault;
    },
    verify: async (target, signer, challenge, signature) =>
      target === agent &&
      signer === owner.address.toLowerCase() &&
      verifyTypedData({ address: signer, signature, ...telegramSignIn(target, challenge) }),
  },
  repositories,
  workflowAlerts,
);
const { app } = buildServer(
  {
    config: {
      PORT: 8787,
      NODE_ENV: 'test',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'unused',
      LASNA_RPC_URL: 'https://lasna-rpc.rnk.dev/',
      UNICHAIN_RPC_URL: 'https://sepolia.unichain.org',
      INDEXER_ENABLED: false,
      INDEXER_START_BLOCK_LASNA: 0,
      INDEXER_START_BLOCK_UNICHAIN: 0,
      corsOrigins: [],
    },
    repositories,
    cursors: new CursorStore(store),
    databaseReachable: async () => true,
    rpcHealth: async () => [],
    accountChain: { agentLink: async () => null, vaultOwner: async () => null },
    telegram,
  },
  { logger: false },
);

const base = `/v1/accounts/${agent}/telegram`;
const webhook = '/v1/telegram/webhook';
const webhookHeaders = { 'x-telegram-bot-api-secret-token': telegramConfig.webhookSecret };

async function authorize(wallet = owner, target: Address = agent) {
  const challenge = telegram.challenge(target, wallet.address.toLowerCase() as Address);
  const signature = await wallet.signTypedData(telegramSignIn(target, challenge));
  const payload = { owner: wallet.address, challenge, signature };
  const response = await app.inject({
    method: 'POST',
    url: `/v1/accounts/${target}/telegram/session`,
    payload,
    remoteAddress: `192.0.2.${testAddress}`,
  });
  return { response, payload };
}

function update(id: number, chat: number, text: string, type = 'private') {
  return {
    update_id: id,
    message: {
      chat: { id: chat, type },
      from: { id: chat, is_bot: false, first_name: 'Anya', username: 'anya' },
      text,
    },
  };
}

function sendUpdate(payload: ReturnType<typeof update>) {
  return app.inject({ method: 'POST', url: webhook, headers: webhookHeaders, payload });
}

async function pair(headers: { authorization: string }, updateId = 1, chat = 2 ** 40) {
  const issued = await app.inject({ method: 'POST', url: `${base}/pairing`, headers });
  expect(issued.statusCode).toBe(200);
  const code = new URL(issued.json().url).searchParams.get('start');
  expect((await sendUpdate(update(updateId, chat, `/start ${code}`))).json().method).toBe(
    'sendMessage',
  );
  const candidate = (await app.inject({ url: base, headers })).json().pendingPairing;
  expect(candidate.profile).toBe('@anya');
  return app.inject({
    method: 'POST',
    url: `${base}/pairing/confirm`,
    headers,
    payload: { pairingId: candidate.id },
  });
}

async function signIn() {
  const { response } = await authorize();
  expect(response.statusCode).toBe(200);
  return { authorization: `Bearer ${response.json().token}` };
}

const workflowId = `0x${'a'.repeat(64)}`;
const workflowRun = `0x${'b'.repeat(64)}`;
const programHash = `0x${'c'.repeat(64)}`;
const hashed = (character: string) => `0x${character.repeat(64)}`;

async function seedWorkflow() {
  await db.query(
    `insert into workflow_v2_accounts (deployment, chain, address, owner, agent)
      values ($1, $2, $4, $5, $4), ($1, $3, $6, $5, $4)`,
    [
      deployment,
      LASNA_CHAIN_ID,
      UNICHAIN_SEPOLIA_CHAIN_ID,
      agent,
      owner.address.toLowerCase(),
      vault,
    ],
  );
  await db.query('insert into workflow_v2_activations values ($1, $2, $3, $4, $5, $6, $7)', [
    deployment,
    UNICHAIN_SEPOLIA_CHAIN_ID,
    agent,
    workflowId,
    '2',
    programHash,
    'Recurring transfer',
  ]);
}

async function insertRun(id: string, secondsAgo = 180, origin = programHash) {
  await db.query(
    `insert into workflow_v2_runs values ($1, $2, $3, $4, $5, $6, '2', $2, $8, '1', $6, 5,
      extract(epoch from now())::bigint - $7::bigint)`,
    [deployment, UNICHAIN_SEPOLIA_CHAIN_ID, id, agent, workflowId, programHash, secondsAgo, origin],
  );
}

async function insertOutcome(id: string, index: number, status: number, reason = '0x00000000') {
  await db.query(
    `insert into workflow_v2_outcomes (deployment, chain, run_id, workflow_id, vault, epoch,
      transaction_hash, block_number, log_index, status, reason, telegram_block_time)
    values ($1, $2, $3, $4, $5, '2', $6, 10, $7, $8, $9, clock_timestamp())`,
    [
      deployment,
      UNICHAIN_SEPOLIA_CHAIN_ID,
      id,
      workflowId,
      vault,
      programHash,
      index,
      status,
      reason,
    ],
  );
}

const patchPreferences = (headers: { authorization: string }, payload: object) =>
  app.inject({ method: 'PATCH', url: `${base}/preferences`, headers, payload });

async function prepareNext() {
  const [job] = await databaseAdapter.rpc(
    'telegram_claim_alert_delivery',
    { p_deployment: deployment },
    z.array(claimedSchema),
  );
  if (!job) throw new Error('No queued Telegram delivery');
  const params = { p_id: job.id, p_lease: job.lease };
  const result = await databaseAdapter.rpc(
    'telegram_prepare',
    params,
    z.array(z.object({ message: z.string(), preflight: z.unknown() })),
  );
  return { params, result };
}

async function enqueue(
  ruleId: number,
  logIndex: number,
  blockTime = new Date(Date.now() + 2_000).toISOString(),
) {
  await db.query(
    `insert into rule_events (chain_id, tx_hash, log_index, agent, rule_id, kind, block_time, telegram_template, telegram_observed)
    values ($1, $2, $3, $4, $5, 'alert', $6, $7, 1500000000000000000000)
    on conflict (chain_id, tx_hash, log_index) do update set telegram_template = excluded.telegram_template`,
    [LASNA_CHAIN_ID, `0x${'a'.repeat(64)}`, logIndex, agent, ruleId, blockTime, ruleId + 10],
  );
  await telegram.processNotifications();
}

const dbJobs = async () =>
  (
    await db.query<{ rule_id: string; status: string }>(
      'select rule_id::text, status from telegram_deliveries order by id',
    )
  ).rows;

beforeAll(async () => {
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  const path = new URL('../../db/migrations/', import.meta.url);
  for (const migration of readdirSync(path).sort())
    await db.exec(readFileSync(new URL(migration, path), 'utf8'));
  await db.query(
    `insert into agents (address, owner, factory, created_tx, created_block) values ($1, $1, $1, 'tx', 1)`,
    [agent],
  );
  await db.query(
    `insert into rules (agent, rule_id, template, chain_id, status)
    select $1, id, id+10, 1301, 'active' from generate_series(1, 3) id`,
    [agent],
  );
  await db.query(
    `insert into rules (agent, rule_id, template, chain_id, status)
    values ($1, 10, 1, $2, 'active'), ($1, 11, 7, $2, 'active'),
      ($1, 12, 1, $2, 'active'), ($1, 13, 9, $2, 'active')`,
    [agent, UNICHAIN_SEPOLIA_CHAIN_ID],
  );
}, 20_000);

beforeEach(async () => {
  testAddress += 1;
  await db.exec(
    'truncate executions, rule_events, telegram_alert_outbox, telegram_deliveries, telegram_rule_preferences, telegram_workflow_preferences, telegram_funding_checks, telegram_payout_windows, telegram_accounts, telegram_sessions, telegram_pairings, telegram_updates, workflow_v2_accounts, workflow_v2_activations, workflow_v2_runs, workflow_v2_outcomes, workflow_v2_cursors;',
  );
});

afterAll(async () => {
  await app.close();
  await db.close();
});

describe('Telegram account and delivery', () => {
  it('explains how to pair on a plain start without changing a connection', async () => {
    const chat = 2 ** 40;
    const response = await sendUpdate(update(1, chat, '/start'));
    expect(response.json()).toMatchObject({ method: 'sendMessage', chat_id: chat });
    expect(response.json().text).toContain('Account & Vault');
    expect(response.json().text).toContain(`${telegramConfig.appOrigin}/account`);
    expect((await db.query('select agent from telegram_accounts')).rows).toEqual([]);
    expect((await sendUpdate(update(2, chat, '/start', 'group'))).json()).toEqual({ ok: true });
  });

  it('replies to a private update through polling and acknowledges it by advancing the offset', async () => {
    const chat = 2 ** 40;
    const offsets: unknown[] = [];
    const replies: unknown[] = [];
    const transport: typeof fetch = async (input, options) => {
      const path = new URL(String(input)).pathname;
      const body = JSON.parse(String(options?.body));
      if (path.endsWith('/sendMessage')) {
        replies.push(body);
        return Response.json({ ok: true });
      }
      offsets.push(body.offset);
      if (offsets.length === 1) {
        return Response.json({
          ok: true,
          result: [update(10, chat, '/start', 'group'), update(11, chat, '/start')],
        });
      }
      poller.stop();
      return Response.json({ ok: true, result: [] });
    };
    const poller = new TelegramPoller(telegram, { info() {}, warn() {} }, transport);
    await poller.run();
    expect(offsets).toEqual([undefined, 12]);
    expect(replies).toEqual([
      expect.objectContaining({
        chat_id: String(chat),
        text: expect.stringContaining('Account & Vault'),
      }),
    ]);
  });

  it('queues confirmed workflows after both chains are indexed and honors delivery preferences', async () => {
    const headers = await signIn();
    await pair(headers);
    expect((await app.inject({ url: '/v1/telegram/availability?workflow=true' })).json()).toEqual({
      available: true,
    });
    const id = `0x${'a'.repeat(64)}`;
    const run = `0x${'b'.repeat(64)}`;
    const tx = `0x${'c'.repeat(64)}`;
    const ownerAddress = owner.address.toLowerCase();
    const chain = UNICHAIN_SEPOLIA_CHAIN_ID;
    const apply = (payload: object) =>
      app.inject({ method: 'PATCH', url: `${base}/preferences`, headers, payload });
    expect((await apply({ workflowId: id, preference: 'send' })).statusCode).toBe(409);
    await db.query(
      `insert into workflow_v2_accounts (deployment, chain, address, owner, agent)
        values ($1, $2, $4, $5, $4), ($1, $3, $6, $5, $4), ($1, $3, $7, $8, $4)`,
      [deployment, LASNA_CHAIN_ID, chain, agent, ownerAddress, vault, unavailableVault, otherAgent],
    );
    await db.query(
      `insert into workflow_v2_activations values
        ($1, $2, $3, $4, '2', $5, 'Recurring transfer'),
        ($1, $2, $3, $4, '1', $5, 'Previous title')`,
      [deployment, chain, agent, id, tx],
    );
    expect((await app.inject({ url: base, headers })).json().workflows).toEqual([
      { id, title: 'Recurring transfer', preference: 'inherit' },
    ]);
    await db.query(
      `insert into workflow_v2_outcomes (deployment, chain, run_id, workflow_id, vault, epoch,
        transaction_hash, block_number, log_index, status, reason, telegram_block_time)
      values ($1, $2, $3, $4, $5, '2', $6, 10, 1, 1, '0x00000000', now() + interval '2 seconds'),
        ($1, $2, $3, $4, $7, '2', $6, 10, 2, 1, '0x00000000', now() + interval '2 seconds'),
        ($1, $2, $3, $4, $5, '2', $6, 10, 3, 4, '0x00000000', now() + interval '2 seconds'),
        ($1, $2, $3, $4, $5, '2', $6, 10, 4, 1, '0x00000000', now() - interval '2 days'),
        ($1, $2, $3, $4, $5, '1', $6, 10, 5, 1, '0x00000000', now() + interval '2 seconds')`,
      [deployment, chain, run, id, vault, tx, unavailableVault],
    );
    await telegram.processNotifications();
    expect(await dbJobs()).toEqual([]);
    await db.query(
      `insert into workflow_v2_runs values ($1, $2, $3, $4, $5, $6, '2', $2, $6, '1', $6, 5, 100)`,
      [deployment, chain, run, agent, id, tx],
    );
    await telegram.processNotifications();
    await telegram.processNotifications();
    const processed = await db.query(
      'select log_index from workflow_v2_outcomes where telegram_processed_at is not null order by log_index',
    );
    expect(processed.rows).toEqual([{ log_index: 1 }, { log_index: 3 }]);
    const jobs = await db.query(
      'select workflow_id, log_index, message from telegram_deliveries order by log_index',
    );
    expect(jobs.rows).toEqual([
      {
        workflow_id: id,
        log_index: 1,
        message: [
          'Rulebook · Workflow confirmed',
          'Recurring transfer',
          'Sent 0.02 USDC',
          `${telegramConfig.appOrigin}/runs/${run}`,
          `${getChain(chain).explorerUrl}/tx/${tx}`,
        ].join('\n'),
      },
      {
        workflow_id: id,
        log_index: 3,
        message: expect.stringContaining('Workflow run failed'),
      },
    ]);
    expect((await app.inject({ url: base, headers })).json().testDelivery).toBeNull();
    expect(
      (await apply({ workflowId: id, preference: 'mute' })).json().workflows[0].preference,
    ).toBe('mute');
    // Treat the confirmed outcome as older than the preference saved before the worker sent it.
    await db.query(`update telegram_deliveries set block_time = now() - interval '1 second'`);
    await db.query(
      `update telegram_deliveries set due_at = now() + interval '1 hour' where alert_kind = 'failed'`,
    );
    const [claimed] = await databaseAdapter.rpc('telegram_claim', {}, z.array(claimedSchema));
    expect(
      await databaseAdapter.rpc(
        'telegram_prepare',
        { p_id: claimed!.id, p_lease: claimed!.lease },
        z.array(z.unknown()),
      ),
    ).toEqual([]);
    expect(
      (await app.inject({ method: 'POST', url: `${base}/test`, headers })).json().testDelivery,
    ).toBe('pending');
  });

  it('keeps action alerts on when confirmations are muted and groups failures by cause', async () => {
    const headers = await signIn();
    await pair(headers);
    await seedWorkflow();
    await patchPreferences(headers, { workflowId, preference: 'mute' });
    const insufficient = toFunctionSelector('ERC20InsufficientBalance(address,uint256,uint256)');
    const allowance = toFunctionSelector('ERC20InsufficientAllowance(address,uint256,uint256)');
    for (const [i, reason] of [insufficient, insufficient, allowance].entries()) {
      const id = hashed(String(i + 1));
      await insertRun(id);
      await insertOutcome(id, i, 4, reason);
    }
    await insertRun(workflowRun);
    await insertOutcome(workflowRun, 10, 1);
    await insertOutcome(workflowRun, 11, 2);
    await telegram.processNotifications();
    const jobs = await db.query<{ alert_kind: string; message: string }>(
      'select alert_kind, message from telegram_deliveries',
    );
    expect(jobs.rows).toHaveLength(2);
    expect(jobs.rows).toEqual(
      expect.arrayContaining([
        { alert_kind: 'failed', message: expect.stringContaining('insufficient tokens') },
        { alert_kind: 'failed', message: expect.stringContaining('insufficient token allowance') },
      ]),
    );
    expect((await patchPreferences(headers, { actionAlerts: false })).json()).toMatchObject({
      fundingAlerts: true,
      actionAlerts: false,
    });
    expect((await prepareNext()).result).toEqual([]);
  });

  it.each(['price-alert', 'large-transfer-alert'] as const)(
    'includes the verified observation for a %s',
    async (recipe) => {
      const headers = await signIn();
      await pair(headers);
      await seedWorkflow();
      const origin = hashed('f');
      const token = getChain(UNICHAIN_SEPOLIA_CHAIN_ID).usdc;
      await insertRun(workflowRun, 180, origin);
      await insertOutcome(workflowRun, 1, 1);
      const program = createWorkflowV2Recipe(recipe, {
        targetPrice: '1500',
        token,
        minimumTransferRaw: '1000000',
      });
      const client = {
        getTransactionReceipt: async ({ hash }: { hash: string }) =>
          hash === origin
            ? {
                logs: [
                  {
                    address: token,
                    logIndex: 1,
                    topics: encodeEventTopics({
                      abi: erc20Abi,
                      eventName: 'Transfer',
                      args: { from: agent, to: otherAgent },
                    }),
                    data: encodeAbiParameters([{ type: 'uint256' }], [4_000_000n]),
                  },
                ],
              }
            : {
                blockNumber: 10n,
                logs: [
                  {
                    address: vault,
                    topics: encodeEventTopics({
                      abi: workflowVaultV2Abi,
                      eventName: 'Step',
                      args: { runId: workflowRun, index: 0 },
                    }),
                    data: encodeAbiParameters(
                      [
                        { type: 'uint8' },
                        { type: 'uint256' },
                        { type: 'uint256' },
                        { type: 'address' },
                      ],
                      [workflowV2Action.alert, 0n, 0n, zeroAddress],
                    ),
                  },
                  {
                    address: vault,
                    topics: encodeEventTopics({
                      abi: workflowVaultV2Abi,
                      eventName: 'Observation',
                      args: { runId: workflowRun },
                    }),
                    data: encodeAbiParameters(
                      [{ type: 'uint256' }, { type: 'address' }],
                      [1500n * 10n ** 18n, agent],
                    ),
                  },
                ],
              },
        readContract: async () => encodeWorkflowV2(program),
      } as unknown as PublicClient;
      await new WorkflowTelegramAlerts(
        databaseAdapter,
        client,
        deployment,
        telegramConfig.appOrigin,
      ).process();
      const { result } = await prepareNext();
      expect(result[0]?.message).toContain('Workflow alert');
      expect(result[0]?.message).toContain(
        recipe === 'price-alert' ? '1500 USDC per WETH' : '4 USDC',
      );
    },
  );

  it('sends one priority warning per payout window and checks for a later check-in', async () => {
    const headers = await signIn();
    await pair(headers);
    await seedWorkflow();
    payoutDeadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    try {
      for (const [index, id] of [workflowRun, hashed('d'), hashed('e')].entries()) {
        await insertRun(id);
        await insertOutcome(id, index, index === 0 ? 4 : 6);
      }
      await telegram.processNotifications();
      await telegram.processNotifications();
      expect(
        (await db.query("select id from telegram_deliveries where alert_kind = 'payout'")).rows,
      ).toHaveLength(1);
      const { result } = await prepareNext();
      expect(result[0]?.message).toContain('Check in to clear it');
      const preflight = payoutPreflight.parse(result[0]?.preflight);
      expect(await workflowAlerts.stillInGrace(preflight)).toBe(true);
      payoutDeadline = 0n;
      expect(await workflowAlerts.stillInGrace(preflight)).toBe(false);
    } finally {
      payoutDeadline = 0n;
    }
  });

  it('can warn a reconnected chat from the same open payout window', async () => {
    const headers = await signIn();
    await pair(headers);
    await seedWorkflow();
    await insertRun(workflowRun);
    await insertOutcome(workflowRun, 0, 6);
    payoutDeadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    try {
      await telegram.processNotifications();
      expect(await databaseAdapter.rpc('telegram_claim', {}, z.array(claimedSchema))).toEqual([]);
      await app.inject({ method: 'DELETE', url: `${base}/connection`, headers });
      expect((await prepareNext()).result).toEqual([]);
      await pair(headers, 2, 1234);
      await telegram.processNotifications();
      expect((await prepareNext()).result[0]?.message).toContain('Inactivity payout warning');
    } finally {
      payoutDeadline = 0n;
    }
  });

  it('checks both chain cursors before flagging an unfinished run and cancels it after a receipt', async () => {
    const headers = await signIn();
    await pair(headers);
    await seedWorkflow();
    await insertRun(workflowRun);
    await db.query("update telegram_accounts set enabled_since = now() - interval '1 hour'");
    await db.query(
      `insert into workflow_v2_cursors values ($1, $2, 20, now()), ($1, $3, 20, now() - interval '5 minutes')`,
      [deployment, LASNA_CHAIN_ID, UNICHAIN_SEPOLIA_CHAIN_ID],
    );
    await workflowAlerts.processUnfinished();
    expect(await dbJobs()).toEqual([]);
    await db.query('update workflow_v2_cursors set block_time = now()');
    await workflowAlerts.processUnfinished();
    await workflowAlerts.processUnfinished();
    expect((await db.query('select alert_kind from telegram_deliveries')).rows).toEqual([
      { alert_kind: 'unfinished' },
    ]);
    await insertOutcome(workflowRun, 1, 1);
    expect((await prepareNext()).result).toEqual([]);
  });

  it('saves funding state across checks, drops obsolete warnings, and sends recovery after a warning', async () => {
    const headers = await signIn();
    await pair(headers);
    await seedWorkflow();
    async function record(block: number, state: string) {
      await db.query(`update telegram_funding_checks set due_at = now() - interval '1 second'`);
      const [job] = await databaseAdapter.rpc(
        'telegram_claim_funding',
        {
          p_deployment: deployment,
          p_chain: LASNA_CHAIN_ID,
          p_limit: 5,
        },
        z.array(z.object({ lease: z.string() })),
      );
      expect(job).toBeDefined();
      const params = {
        p_deployment: deployment,
        p_agent: agent,
        p_chain: LASNA_CHAIN_ID,
        p_lease: job!.lease,
        p_block: block,
        p_state: state,
        p_message: state,
        p_recovery: 'Credit restored',
      };
      await databaseAdapter.rpc('telegram_record_funding', params, z.null());
      await databaseAdapter.rpc('telegram_record_funding', params, z.null());
    }
    function finish(params: Awaited<ReturnType<typeof prepareNext>>['params'], result: string) {
      return databaseAdapter.rpc(
        'telegram_finish',
        { ...params, p_result: result, p_delay: 0 },
        z.null(),
      );
    }
    await record(1, 'low');
    await finish((await prepareNext()).params, 'cancelled');
    await record(2, 'low');
    const low = await prepareNext();
    expect(low.result[0]?.message).toBe('low');
    await finish(low.params, 'sent');
    await record(3, 'empty');
    await record(4, 'debt');
    expect((await prepareNext()).result).toEqual([]);
    const urgent = await prepareNext();
    expect(urgent.result[0]?.message).toBe('debt');
    await finish(urgent.params, 'cancelled');
    await record(5, 'debt');
    const retry = await prepareNext();
    expect(retry.result[0]?.message).toBe('debt');
    await finish(retry.params, 'sent');
    await record(3, 'healthy');
    await record(6, 'healthy');
    const recovery = await prepareNext();
    expect(recovery.result[0]?.message).toBe('Credit restored');
    await finish(recovery.params, 'sent');
    await record(7, 'debt');
    const inFlight = await prepareNext();
    await record(8, 'healthy');
    await finish(inFlight.params, 'sent');
    await record(9, 'healthy');
    expect((await prepareNext()).result[0]?.message).toBe('Credit restored');
    expect((await app.inject({ url: base, headers })).json().testDelivery).toBeNull();
    const settings = await patchPreferences(headers, { fundingAlerts: false });
    expect(settings.json()).toMatchObject({ fundingAlerts: false, actionAlerts: true });
  });

  it('isolates funding RPC failures and uses fresh credit in Telegram messages', async () => {
    const headers = await signIn();
    await pair(headers);
    await seedWorkflow();
    let ethReserve = 50_000_000_000_000n;
    const block = async () => ({ number: 10n, timestamp: BigInt(Math.floor(Date.now() / 1000)) });
    const lasna = {
      getBlock: block,
      getBlockNumber: async () => 10n,
      readContract: async ({ functionName }: { functionName: string }) => {
        if (functionName === 'workflowIds') return [workflowId];
        if (functionName === 'entries')
          return [programHash, 2n, 0n, 0n, 1, UNICHAIN_SEPOLIA_CHAIN_ID, 3600, 0n];
        if (functionName === 'system') return otherAgent;
        throw new Error('Lasna fee credit RPC failed');
      },
    } as unknown as PublicClient;
    const unichain = {
      getBlock: block,
      readContract: async ({ functionName, args }: { functionName: string; args: Address[] }) => {
        if (functionName === 'callbackProxy') return otherAgent;
        if (functionName === 'authorizations') return [programHash, 2n, 0n, true];
        expect(args).toEqual([vault]);
        return functionName === 'reserves' ? ethReserve : 0n;
      },
    } as unknown as PublicClient;
    const monitoring = new TelegramFundingAlerts(
      databaseAdapter,
      { lasna, unichain },
      deployment,
      unavailableVault,
      telegramConfig.appOrigin,
    );
    await expect(monitoring.process()).rejects.toThrow('Some Telegram funding checks failed');
    const { result } = await prepareNext();
    expect(result[0]?.message).toContain('0.00005 test ETH');
    const preflight = fundingPreflight.parse(result[0]?.preflight);
    ethReserve /= 2n;
    await expect(monitoring.currentMessage(preflight)).resolves.toContain('0.000025 test ETH');
    ethReserve *= 20n;
    await expect(monitoring.currentMessage(preflight)).resolves.toBeNull();
  });

  it('notifies for confirmed swaps, transfers, deposits and mirrors while respecting preferences and vault ownership', async () => {
    const headers = await signIn();
    const result = await pair(headers);
    expect(result.json().rules).toContainEqual({ id: '10', template: 1, preference: 'inherit' });
    const funds = getChain(UNICHAIN_SEPOLIA_CHAIN_ID);
    const stage = async (
      index: number,
      rule: number,
      options: {
        kind?: 'mirrored';
        incoming?: boolean;
        transfer?: boolean;
        emitter?: string;
        notify?: boolean;
        status?: 'refused';
      } = {},
    ) => {
      const {
        kind,
        incoming,
        transfer,
        emitter = vault,
        notify = true,
        status = 'confirmed',
      } = options;
      await db.query(
        `insert into executions (chain_id, tx_hash, log_index, vault, agent, owner,
        rule_id, kind, token_in, token_out, amount_in, amount_out, block_number, block_time, status, telegram_notify)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1,now() + interval '1 second',$13,$14)
        on conflict (chain_id, tx_hash, log_index) do update set telegram_notify = excluded.telegram_notify`,
        [
          UNICHAIN_SEPOLIA_CHAIN_ID,
          `0x${'a'.repeat(64)}`,
          index,
          emitter,
          agent,
          owner.address,
          rule,
          kind ?? 'executed',
          kind ? null : funds.usdc,
          kind ? null : transfer ? zeroAddress : funds.weth,
          kind ? null : incoming ? '0' : '1000000',
          kind ? null : incoming ? '1000000' : transfer ? '0' : '500000000000000',
          status,
          notify,
        ],
      );
    };
    // Persisted history and rebuilds stay silent, even when a receipt is replayed live later.
    await stage(1, 10, { notify: false });
    await stage(1, 10);
    await stage(2, 10, { status: 'refused' });
    await stage(3, 10, { emitter: otherAgent });
    await stage(4, 10);
    await stage(4, 10);
    await stage(5, 11, { transfer: true });
    await stage(6, 12, { kind: 'mirrored' });
    await stage(7, 13, { transfer: true, incoming: true });
    const preference = (value: 'send' | 'mute') =>
      app.inject({
        method: 'PATCH',
        url: `${base}/preferences`,
        headers,
        payload: { ruleId: '11', preference: value },
      });
    expect((await preference('mute')).statusCode).toBe(200);
    await telegram.processNotifications();
    const readDeliveries = () =>
      db.query<{ log_index: number; message: string }>(
        'select log_index, message from telegram_deliveries order by log_index',
      );
    const deliveries = await readDeliveries();
    expect(deliveries.rows.map((row) => row.log_index)).toEqual([4, 6, 7]);
    expect(deliveries.rows[0]?.message).toContain('Swapped 1 USDC for 0.0005 WETH');
    expect(deliveries.rows[0]?.message).toContain(`${funds.explorerUrl}/tx/`);
    expect(deliveries.rows[1]?.message).toContain('Mirrored trade confirmed');
    expect(deliveries.rows[2]?.message).toContain('Deposited 1 USDC');

    expect((await preference('send')).statusCode).toBe(200);
    await stage(8, 11, { transfer: true });
    await telegram.processNotifications();
    const rerun = await readDeliveries();
    expect(rerun.rows.map((row) => row.log_index)).toEqual([4, 6, 7, 8]);
    expect(rerun.rows[3]?.message).toContain('Transferred 1 USDC');

    await stage(9, 10, { emitter: unavailableVault });
    await stage(10, 10);
    await expect(telegram.processNotifications()).rejects.toThrow('remain staged for retry');
    expect((await readDeliveries()).rows.map((row) => row.log_index)).toEqual([4, 6, 7, 8, 10]);
    const deferred = await db.query<{ waiting: boolean }>(
      `select retry_at > now() as waiting
      from telegram_alert_outbox where chain_id = $1 and log_index = 9 and processed_at is null`,
      [UNICHAIN_SEPOLIA_CHAIN_ID],
    );
    expect(deferred.rows).toEqual([{ waiting: true }]);
    await expect(telegram.processNotifications()).resolves.toBeUndefined();
  });
  it('authorizes only the owner, rejects forged and reused challenges, and scopes the session', async () => {
    expect((await app.inject({ url: base })).statusCode).toBe(401);
    expect((await authorize(wrongWallet)).response.statusCode).toBe(401);
    const { response, payload } = await authorize();
    expect(response.statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `${base}/session`, payload })).statusCode).toBe(
      401,
    );
    const forged = { ...payload, challenge: { ...payload.challenge, expiresAt: 1 } };
    expect(
      (await app.inject({ method: 'POST', url: `${base}/session`, payload: forged })).statusCode,
    ).toBe(401);
    const headers = { authorization: `Bearer ${response.json().token}` };
    expect(
      (await app.inject({ url: `/v1/accounts/${otherAgent}/telegram`, headers })).statusCode,
    ).toBe(401);
    const grants = await db.query<{ can_call: boolean }>(
      `select has_function_privilege('anon', 'telegram_status(text,text)', 'execute') as can_call`,
    );
    expect(grants.rows[0]?.can_call).toBe(false);
  });

  it('remembers a browser until revoked and protects cookie-authenticated writes', async () => {
    const url = `${base}/session`;
    const origin = telegramConfig.appOrigin;
    const challengeRequest = { owner: owner.address, browser: true };
    expect(
      (await app.inject({ method: 'POST', url: `${base}/challenge`, payload: challengeRequest }))
        .statusCode,
    ).toBe(403);
    const challengeResponse = await app.inject({
      method: 'POST',
      url: `${base}/challenge`,
      headers: { origin },
      payload: challengeRequest,
    });
    expect(challengeResponse.statusCode).toBe(200);
    const challenge = challengeResponse.json<TelegramChallenge>();
    expect(challenge.browser).toBe(true);
    const signature = await owner.signTypedData(telegramSignIn(agent, challenge));
    const payload = { owner: owner.address, challenge, signature };
    expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(403);
    const legacyChallenge = telegram.challenge(agent, owner.address.toLowerCase() as Address);
    const legacySignature = await owner.signTypedData(telegramSignIn(agent, legacyChallenge));
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: { origin },
          payload: {
            owner: owner.address,
            challenge: { ...legacyChallenge, browser: true },
            signature: legacySignature,
          },
        })
      ).statusCode,
    ).toBe(401);
    const response = await app.inject({ method: 'POST', url, headers: { origin }, payload });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ verified: true });
    const setCookie = String(response.headers['set-cookie']);
    expect(setCookie).toMatch(/^__Secure-rulebook-telegram=[A-Za-z0-9_-]{43};/);
    expect(setCookie).toContain(
      `Path=${base}; Max-Age=34560000; HttpOnly; SameSite=Strict; Secure`,
    );
    const cookie = setCookie.split(';')[0]!;
    const token = cookie.slice(cookie.indexOf('=') + 1);
    expect(
      (
        await db.query('select expires_at from telegram_sessions where token_hash = $1', [
          digest(token),
        ])
      ).rows,
    ).toEqual([{ expires_at: null }]);
    expect(
      (await app.inject({ url: base, headers: { authorization: `Bearer ${token}` } })).statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ url: `/v1/accounts/${otherAgent}/telegram`, headers: { cookie } }))
        .statusCode,
    ).toBe(401);
    const settings = await app.inject({ url: base, headers: { cookie } });
    expect(settings.statusCode).toBe(200);
    expect(settings.headers['set-cookie']).toBe(setCookie);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `${base}/pairing`,
          headers: { cookie, origin: 'https://elsewhere.example' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `${base}/pairing`,
          headers: { cookie, origin },
        })
      ).statusCode,
    ).toBe(200);
    expect((await app.inject({ method: 'DELETE', url, headers: { cookie } })).statusCode).toBe(403);
    const forgotten = await app.inject({ method: 'DELETE', url, headers: { cookie, origin } });
    expect(forgotten.statusCode).toBe(200);
    expect(forgotten.headers['set-cookie']).toContain('Max-Age=0');
    expect((await app.inject({ url: base, headers: { cookie } })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'POST', url, headers: { origin }, payload })).statusCode,
    ).toBe(401);
  });

  it('requires a private, fresh, single-use pairing and the exact reviewed profile', async () => {
    const headers = await signIn();
    const issue = () => app.inject({ method: 'POST', url: `${base}/pairing`, headers });
    const first = new URL((await issue()).json().url).searchParams.get('start');
    expect(
      (await app.inject({ method: 'POST', url: webhook, payload: update(1, 2, `/start ${first}`) }))
        .statusCode,
    ).toBe(403);
    expect((await sendUpdate(update(1, 2, `/start ${first}`, 'group'))).json()).toEqual({
      ok: true,
    });
    await db.exec(`update telegram_pairings set expires_at = now() - interval '1 second'`);
    expect((await sendUpdate(update(1, 2, `/start ${first}`))).json()).toEqual({ ok: true });
    const second = new URL((await issue()).json().url).searchParams.get('start');
    expect((await sendUpdate(update(2, 2, `/start ${second}`))).json().method).toBe('sendMessage');
    expect((await sendUpdate(update(2, 2, `/start ${second}`))).json()).toEqual({ ok: true });
    expect((await sendUpdate(update(3, 3, `/start ${second}`))).json()).toEqual({ ok: true });
    const candidate = (await app.inject({ url: base, headers })).json().pendingPairing;
    await issue();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `${base}/pairing/confirm`,
          headers,
          payload: { pairingId: candidate.id },
        })
      ).statusCode,
    ).toBe(409);
  });

  it('enables all three types and deduplicates repeated events while discarding historical ones', async () => {
    const headers = await signIn();
    const result = await pair(headers);
    expect(result.json()).toMatchObject({
      enabled: true,
      defaultMode: 'all',
      connection: 'connected',
      profile: '@anya',
    });
    expect(result.body).not.toContain(String(2 ** 40));
    await db.query(
      `insert into rules (agent, rule_id, template, chain_id, status) values ($1, 4, 11, 1301, 'active')`,
      [agent],
    );
    const withNewRule = await app.inject({ url: base, headers });
    expect(withNewRule.json().rules).toContainEqual({
      id: '4',
      template: 11,
      preference: 'inherit',
    });
    await db.query('delete from rules where agent = $1 and rule_id = 4', [agent]);
    await db.query(
      `insert into rule_events (chain_id, tx_hash, log_index, agent, rule_id, kind, block_time)
      values ($1, 'replay', 1, $2, 1, 'alert', now() + interval '1 second')`,
      [LASNA_CHAIN_ID, agent],
    );
    expect((await db.query('select * from telegram_alert_outbox')).rows).toEqual([]);
    await enqueue(1, 0, new Date(Date.now() - 20_000).toISOString());
    for (const ruleId of [1, 2, 3]) await enqueue(ruleId, ruleId);
    await enqueue(2, 2);
    expect(await dbJobs()).toEqual(
      [1, 2, 3].map((id) => ({ rule_id: String(id), status: 'pending' })),
    );
    const [claimed] = await databaseAdapter.rpc('telegram_claim', {}, z.array(claimedSchema));
    expect(claimed).toBeDefined();
    const [delivery] = await databaseAdapter.rpc(
      'telegram_prepare',
      { p_id: claimed!.id, p_lease: claimed!.lease },
      z.array(z.object({ message: z.string() })),
    );
    expect(delivery?.message).toContain('1500 USDC per WETH');
    expect(delivery?.message).toContain(`${telegramConfig.appOrigin}/rules/${agent}/1`);
    expect(delivery?.message).toContain('https://lasna.reactscan.net/tx/');
  });

  it('applies inherited and explicit choices and stops queued delivery after mute or disconnect', async () => {
    const headers = await signIn();
    await pair(headers);
    await enqueue(1, 1);
    const apply = (payload: object) =>
      app.inject({ method: 'PATCH', url: `${base}/preferences`, headers, payload });
    expect((await apply({ defaultMode: 'selected' })).statusCode).toBe(200);
    await enqueue(2, 2);
    expect((await apply({ ruleId: '2', preference: 'send' })).statusCode).toBe(200);
    await enqueue(2, 3);
    expect((await apply({ ruleId: '2', preference: 'mute' })).statusCode).toBe(200);
    for (const _ of [1, 2]) {
      const [claimed] = await databaseAdapter.rpc('telegram_claim', {}, z.array(claimedSchema));
      expect(claimed).toBeDefined();
      expect(
        await databaseAdapter.rpc(
          'telegram_prepare',
          { p_id: claimed!.id, p_lease: claimed!.lease },
          z.array(z.unknown()),
        ),
      ).toEqual([]);
    }
    expect((await apply({ enabled: false })).statusCode).toBe(200);
    await enqueue(3, 4);
    expect(await dbJobs()).toEqual([
      { rule_id: '1', status: 'cancelled' },
      { rule_id: '2', status: 'cancelled' },
    ]);
    const disconnected = await sendUpdate(update(8, 2 ** 40, '/stop'));
    expect(disconnected.json().method).toBe('sendMessage');
    expect((await app.inject({ url: base, headers })).json()).toMatchObject({
      connection: 'disconnected',
      enabled: false,
    });
    expect((await pair(headers, 9)).json()).toMatchObject({
      connection: 'connected',
      enabled: false,
      defaultMode: 'selected',
    });
    expect((await sendUpdate(update(8, 2 ** 40, '/stop'))).json()).toEqual({ ok: true });
  });

  it('reclaims a crashed sender and marks the chat blocked without leaking its ID', async () => {
    const headers = await signIn();
    await pair(headers);
    const test = () => app.inject({ method: 'POST', url: `${base}/test`, headers });
    expect((await test()).json().testDelivery).toBe('pending');
    expect((await test()).statusCode).toBe(409);
    const [first] = await databaseAdapter.rpc('telegram_claim', {}, z.array(claimedSchema));
    expect(first).toBeDefined();
    await db.exec(`update telegram_deliveries set due_at = now() - interval '1 second'`);
    const [retry] = await databaseAdapter.rpc('telegram_claim', {}, z.array(claimedSchema));
    expect(retry).toMatchObject({ id: first?.id });
    expect(retry?.lease).not.toBe(first?.lease);
    await databaseAdapter.rpc(
      'telegram_finish',
      { p_id: retry!.id, p_lease: retry!.lease, p_result: 'blocked', p_delay: 0 },
      z.null(),
    );
    const result = await app.inject({ url: base, headers });
    expect(result.json()).toMatchObject({ connection: 'blocked', testDelivery: 'failed' });
    expect(result.body).not.toContain(String(2 ** 40));
  });

  it('rate limits wallet verification and checks migration readiness', async () => {
    expect((await app.inject({ url: '/v1/telegram/availability' })).json()).toEqual({
      available: true,
    });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `${base}/session`,
            payload: {},
            remoteAddress: '192.0.2.28',
          })
        ).statusCode,
      ).toBe(400);
    }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `${base}/session`,
          payload: {},
          remoteAddress: '192.0.2.28',
        })
      ).statusCode,
    ).toBe(429);
  });
});

it('honors Telegram rate limits and classifies forbidden chats', async () => {
  const respond = (status: number, body: object) => async () => Response.json(body, { status });
  await expect(
    sendTelegramMessage(
      'unused',
      'private',
      'test',
      1,
      respond(429, { ok: false, error_code: 429, parameters: { retry_after: 73 } }),
    ),
  ).resolves.toEqual({ result: 'retry', delay: 73 });
  await expect(
    sendTelegramMessage('unused', 'private', 'test', 1, respond(403, { ok: false })),
  ).resolves.toEqual({ result: 'blocked', delay: 0 });
  await expect(
    sendTelegramMessage('unused', 'private', 'test', 3, async () => {
      throw new Error('timeout');
    }),
  ).resolves.toEqual({ result: 'retry', delay: 60 });
});
