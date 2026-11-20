import {
  LASNA_CHAIN_ID,
  telegramRuleName,
  telegramSignIn,
  type Address,
  type TelegramPreference,
  type TelegramSettings,
} from '@rulebook/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router';
import { useSignTypedData } from 'wagmi';

import { useChainGuard } from '../hooks/useChainGuard.js';
import { Spinner } from './chrome/Spinner.js';
import { api, ApiError } from '../lib/api.js';
import { appRoutes } from '../lib/routes.js';

type Session = Awaited<ReturnType<typeof api.telegramSession>>;
type Pairing = Awaited<ReturnType<typeof api.telegramPair>>;
type RuleSetting = TelegramSettings['rules'][number];

export function TelegramNotifications(props: { agent: Address; owner: Address; ruleId?: string }) {
  const availability = useQuery({
    queryKey: ['telegram-availability'],
    queryFn: () => api.telegramAvailability(),
    staleTime: 60_000,
  });
  if (!availability.data?.available) return null;
  return <TelegramSettingsPanel key={`${props.agent}:${props.owner}`} {...props} />;
}

function TelegramSettingsPanel({
  agent,
  owner,
  ruleId,
}: {
  agent: Address;
  owner: Address;
  ruleId?: string;
}) {
  const heading = useId();
  const queryClient = useQueryClient();
  const sessionKey = ['telegram-session', agent.toLowerCase(), owner.toLowerCase()];
  const settingsKey = ['telegram-settings', agent.toLowerCase(), owner.toLowerCase()];
  const { signTypedDataAsync } = useSignTypedData();
  const guard = useChainGuard();
  const [pairing, setPairing] = useState<Pairing>();
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const { data: session } = useQuery<Session | null>({
    queryKey: sessionKey,
    queryFn: async () => null,
    enabled: false,
    gcTime: 20 * 60_000,
  });
  const settings = useQuery({
    queryKey: settingsKey,
    queryFn: () => api.telegramSettings(agent, session!.token),
    enabled: Boolean(session),
    retry: false,
    refetchInterval: (query) =>
      pairing || query.state.data?.testDelivery === 'pending' ? 2_000 : 15_000,
  });

  useEffect(() => {
    if (!session) return;
    const sessionTimer = setTimeout(
      () => {
        queryClient.setQueryData(
          ['telegram-session', agent.toLowerCase(), owner.toLowerCase()],
          null,
        );
      },
      Math.max(0, session.expiresAt * 1000 - Date.now()),
    );
    return () => clearTimeout(sessionTimer);
  }, [session, agent, owner, queryClient]);

  useEffect(() => {
    if (!pairing) return;
    const pairingTimer = setTimeout(
      () => {
        setPairing(undefined);
        setExpired(true);
        void queryClient.invalidateQueries({
          queryKey: ['telegram-settings', agent.toLowerCase(), owner.toLowerCase()],
        });
      },
      Math.max(0, pairing.expiresAt * 1000 - Date.now()),
    );
    return () => clearTimeout(pairingTimer);
  }, [pairing, agent, owner, queryClient]);

  const sessionRejected = settings.error instanceof ApiError && settings.error.status === 401;
  const authorized = sessionRejected ? undefined : session;
  const current = authorized ? settings.data : undefined;

  async function run(label: string, action: () => Promise<TelegramSettings | void>) {
    setBusy(label);
    setError(undefined);
    try {
      await queryClient.cancelQueries({ queryKey: settingsKey });
      const result = await action();
      if (result) queryClient.setQueryData(settingsKey, result);
      else await queryClient.invalidateQueries({ queryKey: settingsKey });
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) {
        queryClient.setQueryData(sessionKey, null);
        setPairing(undefined);
      }
      setError(
        failure instanceof ApiError
          ? failure.message
          : 'Telegram settings could not be updated. Try again.',
      );
    } finally {
      setBusy(undefined);
    }
  }

  async function verifyWallet() {
    const challenge = await api.telegramChallenge(agent, owner);
    if (challenge.origin !== window.location.origin)
      throw new Error('Unexpected Telegram sign-in origin');
    const signature = await guard(
      {
        chainId: LASNA_CHAIN_ID,
        target: agent,
        targetLabel: 'Automation account',
        effect: 'Verify ownership to manage Telegram notifications for this account.',
        amount: 'Off-chain signature. No gas or funds required.',
      },
      owner,
      (connector) =>
        signTypedDataAsync({ connector, account: owner, ...telegramSignIn(agent, challenge) }),
    );
    const verified = await api.telegramSession(agent, owner, challenge, signature);
    setPairing(undefined);
    setExpired(false);
    queryClient.setQueryData(sessionKey, verified);
  }

  function patchRule(rule: RuleSetting, preference: TelegramPreference) {
    if (authorized)
      void run('Saving preference…', () =>
        api.telegramPreferences(agent, authorized.token, { ruleId: rule.id, preference }),
      );
  }

  const rule = current?.rules.find(({ id }) => id === ruleId);
  const connected = current?.connection === 'connected';
  const candidate = expired ? null : current?.pendingPairing;

  return (
    <section
      aria-labelledby={heading}
      aria-busy={Boolean(busy)}
      className="app-panel app-panel-pad space-y-4"
    >
      <h2 id={heading} className="app-panel-heading">
        Telegram notifications
      </h2>
      {!authorized && (
        <div className="space-y-3">
          <p className="app-copy">
            Verify your wallet to connect Telegram or manage delivery preferences.
          </p>
          <button
            className="app-button"
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void run('Verifying wallet…', verifyWallet)}
          >
            Verify wallet
          </button>
        </div>
      )}
      {authorized && !current && !settings.isError && (
        <p className="app-copy rb-loading" role="status">
          <Spinner />
          Loading Telegram settings…
        </p>
      )}
      {authorized && settings.isError && (
        <button type="button" className="app-button" onClick={() => void settings.refetch()}>
          Retry loading Telegram settings
        </button>
      )}
      {authorized && current && ruleId && (
        <>
          {rule && current.configured && (
            <RuleDelivery
              rule={rule}
              settings={current}
              disabled={Boolean(busy)}
              onChange={patchRule}
            />
          )}
          {!rule && (
            <p className="app-copy">
              Delivery preferences appear after Rulebook indexes this rule.
            </p>
          )}
          {!connected && (
            <Link className="app-link" to={appRoutes.account}>
              Connect Telegram in Account
            </Link>
          )}
        </>
      )}
      {authorized && current && !ruleId && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="app-copy" role="status">
              {connected
                ? `Connected to ${current.profile}`
                : current.connection === 'blocked'
                  ? 'Bot blocked. Unblock it in Telegram, then reconnect.'
                  : 'Telegram is disconnected.'}
            </p>
            {current.connection !== 'disconnected' && (
              <button
                className="app-button"
                type="button"
                disabled={Boolean(busy)}
                onClick={() =>
                  void run('Disconnecting…', async () => {
                    const updated = await api.telegramDisconnect(agent, authorized.token);
                    setPairing(undefined);
                    return updated;
                  })
                }
              >
                Disconnect
              </button>
            )}
          </div>
          {!connected && candidate && (
            <div className="space-y-2">
              <p className="app-copy">
                Confirm {candidate.profile}.{' '}
                {current.configured
                  ? 'Your saved delivery preferences will apply.'
                  : 'All rules will send Telegram messages when they complete or raise an alert.'}
              </p>
              <button
                className="app-button app-button--primary"
                type="button"
                disabled={Boolean(busy)}
                onClick={() =>
                  void run('Connecting Telegram…', async () => {
                    const updated = await api.telegramConfirm(
                      agent,
                      authorized.token,
                      candidate.id,
                    );
                    setPairing(undefined);
                    return updated;
                  })
                }
              >
                {current.configured
                  ? 'Confirm Telegram connection'
                  : 'Connect and enable notifications'}
              </button>
            </div>
          )}
          {!connected && !candidate && pairing && (
            <div className="space-y-2">
              <p className="app-copy">
                Open the bot, tap Start, then return here to confirm the account.
              </p>
              <a
                className="app-button app-button--primary"
                href={pairing.url}
                target="_blank"
                rel="noreferrer"
              >
                Open Telegram bot
              </a>
            </div>
          )}
          {!connected && !candidate && !pairing && (
            <div className="space-y-2">
              {expired && (
                <p className="app-copy" role="status">
                  This pairing link expired. Get a new link to try again.
                </p>
              )}
              <button
                className="app-button app-button--primary"
                type="button"
                disabled={Boolean(busy)}
                onClick={() =>
                  void run('Creating pairing link…', async () => {
                    setPairing(await api.telegramPair(agent, authorized.token));
                    setExpired(false);
                  })
                }
              >
                {expired
                  ? 'Get a new pairing link'
                  : current.configured
                    ? 'Reconnect Telegram'
                    : 'Connect Telegram'}
              </button>
            </div>
          )}
          {current.configured && (
            <fieldset className="app-divider min-w-0 space-y-4 pt-4" disabled={Boolean(busy)}>
              <legend className="sr-only">Telegram delivery preferences</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="app-field">
                  <span id={`${heading}-delivery`}>Telegram delivery</span>
                  <select
                    className="app-input"
                    aria-labelledby={`${heading}-delivery`}
                    value={String(current.enabled)}
                    onChange={(event) => {
                      const enabled = event.currentTarget.value === 'true';
                      void run('Saving delivery status…', () =>
                        api.telegramPreferences(agent, authorized.token, { enabled }),
                      );
                    }}
                  >
                    <option value="true">On</option>
                    <option value="false">Off</option>
                  </select>
                </label>
                <label className="app-field">
                  <span id={`${heading}-default`}>Default for rules</span>
                  <select
                    className="app-input"
                    aria-labelledby={`${heading}-default`}
                    value={current.defaultMode}
                    onChange={(event) => {
                      const defaultMode = event.currentTarget.value === 'all' ? 'all' : 'selected';
                      void run('Saving account default…', () =>
                        api.telegramPreferences(agent, authorized.token, { defaultMode }),
                      );
                    }}
                  >
                    <option value="all">All rules</option>
                    <option value="selected">Only selected rules</option>
                  </select>
                </label>
              </div>
              {current.rules.length > 0 ? (
                <ul className="space-y-2">
                  {current.rules.map((item) => (
                    <li key={item.id}>
                      <RuleDelivery
                        rule={item}
                        settings={current}
                        onChange={patchRule}
                        disabled={Boolean(busy)}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="app-copy">Your rules will appear here once you create them.</p>
              )}
            </fieldset>
          )}
          {connected && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                className="app-button"
                type="button"
                disabled={Boolean(busy) || current.testDelivery === 'pending'}
                onClick={() =>
                  void run('Queueing test message…', () =>
                    api.telegramTest(agent, authorized.token),
                  )
                }
              >
                Send test message
              </button>
              {current.testDelivery && (
                <p className="app-copy" role="status">
                  {
                    {
                      pending: 'Test message queued.',
                      sent: 'Test message sent.',
                      failed: 'Test message failed. Try again.',
                    }[current.testDelivery]
                  }
                </p>
              )}
            </div>
          )}
        </>
      )}
      {busy && (
        <p className="rb-loading" role="status">
          <Spinner />
          {busy}
        </p>
      )}
      {error && (
        <p className="app-alert" data-tone="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function RuleDelivery({
  rule,
  settings,
  disabled,
  onChange,
}: {
  rule: RuleSetting;
  settings: TelegramSettings;
  disabled: boolean;
  onChange: (rule: RuleSetting, preference: TelegramPreference) => void;
}) {
  const shouldSend =
    rule.preference === 'send' || (rule.preference === 'inherit' && settings.defaultMode === 'all');
  const status =
    settings.connection === 'blocked'
      ? 'Telegram bot blocked'
      : settings.connection === 'disconnected'
        ? 'Telegram disconnected'
        : !settings.enabled
          ? 'Delivery off for account'
          : shouldSend
            ? 'Sends to Telegram'
            : 'Muted';
  const title = `Rule #${rule.id} · ${telegramRuleName(rule.template)}`;
  return (
    <label className="app-field app-divider items-center gap-x-4 gap-y-2 py-2 sm:grid-cols-[1fr_minmax(10rem,auto)]">
      <span>
        {title}
        <span className="app-copy mt-1 block">{status}</span>
      </span>
      <select
        className="app-input"
        aria-label={`Telegram delivery for rule #${rule.id}`}
        value={rule.preference}
        disabled={disabled}
        onChange={(event) => {
          const preference = event.currentTarget.value;
          if (preference === 'inherit' || preference === 'send' || preference === 'mute')
            onChange(rule, preference);
        }}
      >
        <option value="inherit">Use account default</option>
        <option value="send">Send</option>
        <option value="mute">Mute</option>
      </select>
    </label>
  );
}
