import {
  LASNA_CHAIN_ID,
  telegramRuleName,
  telegramSessionSchema,
  telegramSignIn,
  type Address,
  type TelegramPreference,
  type TelegramSettings,
} from '@rulebook/shared';
import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  Link01Icon,
  SecurityCheckIcon,
  TelegramIcon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useSignTypedData } from 'wagmi';

import { useChainGuard } from '../hooks/useChainGuard.js';
import { Spinner } from './chrome/Spinner.js';
import { api, apiBaseUrl, ApiError } from '../lib/api.js';
import { appRoutes } from '../lib/routes.js';

type Session = Awaited<ReturnType<typeof api.telegramSession>>;
type Pairing = Awaited<ReturnType<typeof api.telegramPair>>;

function storeSession(key: string, session: Session | null) {
  try {
    if (session) window.sessionStorage.setItem(key, JSON.stringify(session));
    else window.sessionStorage.removeItem(key);
  } catch {
    // The signed-in panel still works in memory if browser storage is unavailable.
  }
}

function restoreSession(key: string): Session | null {
  try {
    const stored = window.sessionStorage.getItem(key);
    if (!stored) return null;
    const session = telegramSessionSchema.safeParse(JSON.parse(stored));
    if (
      session.success &&
      /^[A-Za-z0-9_-]{43}$/.test(session.data.token) &&
      session.data.expiresAt * 1000 > Date.now()
    ) {
      return session.data;
    }
  } catch {
    // Old or malformed entries should be treated as signed out.
  }
  storeSession(key, null);
  return null;
}

type DeliverySetting = {
  id: string;
  title: string;
  preference: TelegramPreference;
};
type NotificationProps = { agent: Address; owner: Address } & (
  { workflow?: false; ruleId?: string } | { workflow: true; workflowId?: string }
);

export function TelegramNotifications(props: NotificationProps) {
  const workflow = props.workflow === true;
  const heading = useId();
  const availability = useQuery({
    queryKey: ['telegram-availability', workflow],
    queryFn: () => api.telegramAvailability(workflow),
    staleTime: 60_000,
  });
  if (!availability.data?.available) {
    if (!workflow || props.workflowId || availability.isPending) return null;
    return (
      <section className="app-panel rb-notify" aria-labelledby={heading}>
        <header className="rb-panel-head">
          <div className="rb-notify-heading">
            <span className="rb-notify-mark" aria-hidden="true">
              <HugeiconsIcon icon={TelegramIcon} size={18} strokeWidth={1.7} />
            </span>
            <div>
              <h2 id={heading} className="rb-panel-title">
                Telegram notifications
              </h2>
              <p className="rb-panel-copy">Delivery for workflows owned by this wallet.</p>
            </div>
          </div>
          <span className="rb-chip">Unavailable</span>
        </header>
        <div className="rb-panel-body">
          {availability.isError ? (
            <div className="rb-notify-callout" data-tone="error">
              <span className="rb-notify-callout-icon" aria-hidden="true">
                <HugeiconsIcon icon={Alert02Icon} size={17} strokeWidth={1.7} />
              </span>
              <div className="rb-notify-callout-copy">
                <p className="rb-notify-title">Availability could not be checked.</p>
                <p className="rb-notify-copy">Try again before configuring delivery.</p>
              </div>
              <button
                type="button"
                className="app-button"
                onClick={() => void availability.refetch()}
              >
                Check again
              </button>
            </div>
          ) : (
            <p className="rb-notify-copy">
              Telegram notifications are unavailable on this deployment.
            </p>
          )}
        </div>
      </section>
    );
  }
  return <TelegramSettingsPanel key={`${props.agent}:${props.owner}`} {...props} />;
}

function TelegramSettingsPanel(props: NotificationProps) {
  const { agent, owner } = props;
  const workflow = props.workflow === true;
  const itemId = props.workflow ? props.workflowId : props.ruleId;
  const name = workflow ? 'workflow' : 'rule';
  const heading = useId();
  const queryClient = useQueryClient();
  const { sessionKey, settingsKey, storageKey } = useMemo(() => {
    const scope = [apiBaseUrl, agent.toLowerCase(), owner.toLowerCase()] as const;
    return {
      sessionKey: ['telegram-session', ...scope] as const,
      settingsKey: ['telegram-settings', ...scope] as const,
      storageKey: `rulebook:telegram-session:v1:${JSON.stringify(scope)}`,
    };
  }, [agent, owner]);
  const { signTypedDataAsync } = useSignTypedData();
  const guard = useChainGuard();
  const [pairing, setPairing] = useState<Pairing>();
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const { data: session } = useQuery<Session | null>({
    queryKey: sessionKey,
    queryFn: () => null,
    enabled: false,
    gcTime: 20 * 60_000,
    initialData: () => restoreSession(storageKey),
  });
  const activeSession = session && session.expiresAt * 1000 > Date.now() ? session : null;
  const settings = useQuery({
    queryKey: settingsKey,
    queryFn: () => api.telegramSettings(agent, activeSession!.token),
    enabled: Boolean(activeSession),
    retry: false,
    refetchInterval: (query) =>
      pairing || query.state.data?.testDelivery === 'pending' ? 2_000 : 15_000,
  });
  const sessionRejected = settings.error instanceof ApiError && settings.error.status === 401;

  const clearSession = useCallback(
    (expected: Session) => {
      if (queryClient.getQueryData<Session | null>(sessionKey)?.token !== expected.token) return;
      storeSession(storageKey, null);
      queryClient.setQueryData(sessionKey, null);
      queryClient.removeQueries({ queryKey: settingsKey, exact: true });
      setPairing(undefined);
      setExpired(false);
    },
    [queryClient, sessionKey, settingsKey, storageKey],
  );
  useEffect(() => {
    if (!session) return;
    if (sessionRejected) {
      clearSession(session);
      return;
    }
    const sessionTimer = setTimeout(
      () => clearSession(session),
      Math.max(0, session.expiresAt * 1000 - Date.now()),
    );
    return () => clearTimeout(sessionTimer);
  }, [session, sessionRejected, clearSession]);

  useEffect(() => {
    if (!pairing) return;
    const pairingTimer = setTimeout(
      () => {
        setPairing(undefined);
        setExpired(true);
        void queryClient.invalidateQueries({ queryKey: settingsKey });
      },
      Math.max(0, pairing.expiresAt * 1000 - Date.now()),
    );
    return () => clearTimeout(pairingTimer);
  }, [pairing, queryClient, settingsKey]);

  const authorized = sessionRejected ? null : activeSession;
  const current = authorized ? settings.data : undefined;

  async function run(label: string, action: () => Promise<TelegramSettings | void>) {
    setBusy(label);
    setError(undefined);
    try {
      await queryClient.cancelQueries({ queryKey: settingsKey });
      const result = await action();
      if (!result) {
        await queryClient.invalidateQueries({ queryKey: settingsKey });
      } else if (
        session &&
        queryClient.getQueryData<Session | null>(sessionKey)?.token === session.token
      ) {
        queryClient.setQueryData(settingsKey, result);
      }
    } catch (failure) {
      if (session && failure instanceof ApiError && failure.status === 401) clearSession(session);
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
    queryClient.removeQueries({ queryKey: settingsKey, exact: true });
    storeSession(storageKey, verified);
    queryClient.setQueryData(sessionKey, verified);
  }

  function patchDelivery(item: DeliverySetting, preference: TelegramPreference) {
    if (authorized)
      void run('Saving preference…', () =>
        api.telegramPreferences(
          agent,
          authorized.token,
          workflow ? { workflowId: item.id, preference } : { ruleId: item.id, preference },
        ),
      );
  }

  const items = workflow
    ? (current?.workflows ?? [])
    : (current?.rules.map(({ id, template, preference }) => ({
        id,
        title: `Rule #${id} · ${telegramRuleName(template)}`,
        preference,
      })) ?? []);
  const selected = items.find(({ id }) => id === itemId);
  const connected = current?.connection === 'connected';
  const blocked = current?.connection === 'blocked';
  const candidate = expired ? null : current?.pendingPairing;
  const state = !authorized
    ? 'verify'
    : settings.isError
      ? 'error'
      : !current
        ? 'loading'
        : connected
          ? 'connected'
          : blocked
            ? 'blocked'
            : 'disconnected';
  const chipLabel = {
    verify: 'Verify wallet',
    error: 'Unavailable',
    loading: 'Checking',
    connected: 'Connected',
    blocked: 'Blocked',
    disconnected: 'Not connected',
  }[state];
  const chipTone =
    state === 'connected'
      ? ('active' as const)
      : state === 'error' || state === 'blocked'
        ? ('danger' as const)
        : state === 'verify' || state === 'loading'
          ? ('info' as const)
          : undefined;
  const subtitle =
    state === 'verify'
      ? 'Verify the owner wallet to manage delivery for this account.'
      : state === 'error'
        ? 'Telegram settings could not be loaded. Retry below.'
        : state === 'loading'
          ? 'Checking the Telegram connection for this wallet.'
          : state === 'connected'
            ? `Messages go to ${current?.profile ?? 'your connected chat'}.`
            : state === 'blocked'
              ? 'Telegram blocked the bot. Unblock it, then reconnect.'
              : `Connect Telegram to receive ${name} messages.`;
  const connectionIcon = connected ? CheckmarkCircle02Icon : blocked ? Alert02Icon : Link01Icon;

  return (
    <section
      aria-labelledby={heading}
      aria-busy={Boolean(busy)}
      className="app-panel rb-notify"
      data-state={state}
    >
      <header className="rb-panel-head">
        <div className="rb-notify-heading">
          <span className="rb-notify-mark" data-tone={chipTone} aria-hidden="true">
            <HugeiconsIcon icon={TelegramIcon} size={18} strokeWidth={1.7} />
          </span>
          <div>
            <h2 id={heading} className="rb-panel-title">
              Telegram notifications
            </h2>
            <p className="rb-panel-copy">{subtitle}</p>
          </div>
        </div>
        <span className="rb-chip" data-tone={chipTone}>
          {chipLabel}
        </span>
      </header>
      <div className="rb-panel-body rb-notify-body">
        {!authorized && (
          <div className="rb-notify-callout">
            <span className="rb-notify-callout-icon" aria-hidden="true">
              <HugeiconsIcon icon={SecurityCheckIcon} size={17} strokeWidth={1.7} />
            </span>
            <div className="rb-notify-callout-copy">
              <p className="rb-notify-title">Verify wallet ownership</p>
              <p className="rb-notify-copy">
                Telegram settings are tied to the wallet that owns this account.
              </p>
            </div>
            <button
              className="app-button app-button--primary"
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
          <div className="rb-notify-callout" data-tone="error">
            <span className="rb-notify-callout-icon" aria-hidden="true">
              <HugeiconsIcon icon={Alert02Icon} size={17} strokeWidth={1.7} />
            </span>
            <div className="rb-notify-callout-copy">
              <p className="rb-notify-title">Telegram settings are unavailable.</p>
              <p className="rb-notify-copy">The connection could not be read.</p>
            </div>
            <button type="button" className="app-button" onClick={() => void settings.refetch()}>
              Retry loading Telegram settings
            </button>
          </div>
        )}
        {authorized && current && itemId && (
          <>
            {selected && current.configured && (
              <DeliveryPreference
                item={selected}
                workflow={workflow}
                settings={current}
                disabled={Boolean(busy)}
                onChange={patchDelivery}
              />
            )}
            {!selected && (
              <p className="app-copy">
                Delivery preferences appear after Rulebook indexes this {name}.
              </p>
            )}
            {connected && workflow && current.actionAlerts !== undefined && (
              <p className="app-copy">
                This setting covers run confirmations and workflow alerts. Manage action alerts in{' '}
                <Link className="app-link" to={appRoutes.account}>
                  Account &amp; Vault
                </Link>
                .
              </p>
            )}
            {!connected && (
              <Link className="app-link" to={appRoutes.account}>
                Connect Telegram in Account
              </Link>
            )}
          </>
        )}
        {authorized && current && !itemId && (
          <>
            <div
              className="rb-notify-connection"
              data-tone={connected ? 'connected' : blocked ? 'blocked' : 'disconnected'}
            >
              <span className="rb-notify-state-icon" aria-hidden="true">
                <HugeiconsIcon icon={connectionIcon} size={17} strokeWidth={1.8} />
              </span>
              <div className="rb-notify-connection-copy">
                <p className="rb-notify-title" role="status">
                  {connected
                    ? `Connected to ${current.profile}`
                    : blocked
                      ? 'Bot blocked'
                      : 'Telegram is disconnected.'}
                </p>
                <p className="rb-notify-copy">
                  {connected
                    ? current.enabled
                      ? 'Telegram delivery is on for this account.'
                      : 'Delivery is paused for this account.'
                    : blocked
                      ? 'Unblock the Rulebook bot in Telegram, then reconnect.'
                      : candidate
                        ? `Confirm ${candidate.profile} to finish connecting.`
                        : pairing
                          ? 'Open the bot, tap Start, then return here to confirm.'
                          : workflow
                            ? 'Connect the bot to get funding alerts and workflow updates.'
                            : 'Connect the bot to get rule updates.'}
                </p>
              </div>
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
              <div className="rb-notify-step">
                <p className="app-copy">
                  Confirm {candidate.profile}.{' '}
                  {current.configured
                    ? 'Your saved delivery preferences will apply.'
                    : workflow
                      ? 'Funding alerts, action alerts, and workflow updates will be on.'
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
              <div className="rb-notify-step">
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
              <div className="rb-notify-step">
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
              <fieldset className="rb-notify-preferences" disabled={Boolean(busy)}>
                <legend className="sr-only">Telegram delivery preferences</legend>
                <div className="rb-notify-preference-grid">
                  <label className="app-field">
                    <span id={`${heading}-delivery`}>Telegram delivery</span>
                    <select
                      className="app-input rb-notify-select"
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
                    <span id={`${heading}-default`}>
                      {workflow ? 'Default for workflow updates' : 'Default for rules'}
                    </span>
                    <select
                      className="app-input rb-notify-select"
                      aria-labelledby={`${heading}-default`}
                      value={current.defaultMode}
                      onChange={(event) => {
                        const defaultMode =
                          event.currentTarget.value === 'all' ? 'all' : 'selected';
                        void run('Saving account default…', () =>
                          api.telegramPreferences(agent, authorized.token, { defaultMode }),
                        );
                      }}
                    >
                      <option value="all">All {name}s</option>
                      <option value="selected">Only selected {name}s</option>
                    </select>
                  </label>
                  {workflow &&
                    (
                      [
                        {
                          key: 'fundingAlerts',
                          title: 'Funding alerts',
                          copy: 'Low, empty, or restored fee credit, and unpaid fees.',
                        },
                        {
                          key: 'actionAlerts',
                          title: 'Action needed',
                          copy: 'Payout warnings and failed or expired runs.',
                        },
                      ] as const
                    ).map(({ key, title, copy }) =>
                      current[key] === undefined ? null : (
                        <label className="app-field" key={key}>
                          <span id={`${heading}-${key}`}>{title}</span>
                          <select
                            className="app-input rb-notify-select"
                            aria-labelledby={`${heading}-${key}`}
                            aria-describedby={`${heading}-${key}-description`}
                            value={String(current[key])}
                            onChange={(event) => {
                              const enabled = event.currentTarget.value === 'true';
                              void run('Saving alert preference…', () =>
                                api.telegramPreferences(agent, authorized.token, {
                                  [key]: enabled,
                                }),
                              );
                            }}
                          >
                            <option value="true">On</option>
                            <option value="false">Off</option>
                          </select>
                          <span className="rb-notify-copy" id={`${heading}-${key}-description`}>
                            {copy}
                          </span>
                        </label>
                      ),
                    )}
                </div>
                {items.length > 0 ? (
                  <ul className="rb-notify-list">
                    {items.map((item) => (
                      <li key={item.id}>
                        <DeliveryPreference
                          item={item}
                          workflow={workflow}
                          settings={current}
                          onChange={patchDelivery}
                          disabled={Boolean(busy)}
                        />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="app-copy">
                    {workflow
                      ? 'Workflows appear here after activation is indexed.'
                      : 'Your rules will appear here once you create them.'}
                  </p>
                )}
              </fieldset>
            )}
            {connected && workflow && current.lastProblemDelivery && (
              <p className="app-copy" role="status">
                {current.lastProblemDelivery.status === 'sent'
                  ? 'The last funding or action alert was sent.'
                  : 'The last funding or action alert failed to send. Send a test message to check your connection.'}
              </p>
            )}
            {connected && (
              <div className="rb-notify-test">
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
        {error && (
          <p className="app-alert" data-tone="error" role="alert">
            {error}
          </p>
        )}
      </div>
      {busy && (
        <p className="rb-notify-progress" role="status">
          <Spinner />
          {busy}
        </p>
      )}
    </section>
  );
}

function DeliveryPreference({
  item,
  workflow,
  settings,
  disabled,
  onChange,
}: {
  item: DeliverySetting;
  workflow: boolean;
  settings: TelegramSettings;
  disabled: boolean;
  onChange: (item: DeliverySetting, preference: TelegramPreference) => void;
}) {
  const shouldSend =
    item.preference === 'send' || (item.preference === 'inherit' && settings.defaultMode === 'all');
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
  const tone =
    settings.connection === 'blocked' ||
    settings.connection === 'disconnected' ||
    !settings.enabled ||
    !shouldSend
      ? 'muted'
      : 'active';
  return (
    <label className="rb-delivery-row" data-tone={tone}>
      <span className="rb-delivery-copy">
        <span className="rb-delivery-title">{item.title}</span>
        <span className="rb-delivery-status">{status}</span>
      </span>
      <select
        className="app-input rb-delivery-select"
        aria-label={`Telegram delivery for ${workflow ? item.title : `rule #${item.id}`}`}
        value={item.preference}
        disabled={disabled}
        onChange={(event) => {
          const preference = event.currentTarget.value;
          if (preference === 'inherit' || preference === 'send' || preference === 'mute')
            onChange(item, preference);
        }}
      >
        <option value="inherit">Use account default</option>
        <option value="send">Send</option>
        <option value="mute">Mute</option>
      </select>
    </label>
  );
}
