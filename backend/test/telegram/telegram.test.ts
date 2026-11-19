import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';

import { PGlite } from '@electric-sql/pglite';
import {
  getChain,
  LASNA_CHAIN_ID,
  telegramSignIn,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  type Address,
} from '@rulebook/shared';
import { verifyTypedData, zeroAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createRepositories } from '../../src/db/repositories/index.js';
import { InMemoryStore } from '../../src/db/store.js';
import { CursorStore } from '../../src/indexer/cursors.js';
import { buildServer } from '../../src/server.js';
import { TelegramService, type TelegramDatabase } from '../../src/telegram/service.js';
import { sendTelegramMessage } from '../../src/telegram/worker.js';

const agent = '0x1111111111111111111111111111111111111111' as const;
const otherAgent = '0x2222222222222222222222222222222222222222' as const;
const vault = '0x3333333333333333333333333333333333333333' as const;
const unavailableVault = '0x4444444444444444444444444444444444444444' as const;
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

function database(): Pick<TelegramDatabase, 'rpc' | 'createSession' | 'session'> {
  return {
    async rpc(name, params, schema) {
      const entries = Object.entries(params);
      const argumentsSql = entries.map(([key], index) => `${key} => $${index + 1}`).join(', ');
      const values = entries.map(([, value]) => value);
      if (['telegram_claim', 'telegram_prepare', 'telegram_pending_notifications'].includes(name)) {
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
    async session(target, token) {
      const hash = digest(token);
      const { rows } = await db.query<{ expires: number }>(
        `select extract(epoch from expires_at)::int as expires from telegram_sessions
        where agent = $1 and token_hash = $2 and expires_at > now()`,
        [target, hash],
      );
      return rows[0] ? { hash, expiresAt: rows[0].expires } : null;
    },
  };
}

const store = new InMemoryStore();
const repositories = createRepositories(store);
const databaseAdapter = database();
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
  await db.exec(
    'truncate executions, rule_events, telegram_alert_outbox, telegram_deliveries, telegram_rule_preferences, telegram_accounts, telegram_sessions, telegram_pairings, telegram_updates;',
  );
});

afterAll(async () => {
  await app.close();
  await db.close();
});

describe('Telegram account and delivery', () => {
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
