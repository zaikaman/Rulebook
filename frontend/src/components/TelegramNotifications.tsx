import {
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
import { useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useSignTypedData } from 'wagmi';

import { useChainGuard } from '../hooks/useChainGuard.js';
import { Spinner } from './chrome/Spinner.js';
import { api, ApiError } from '../lib/api.js';
import { useNetworkMode, withNetworkQuery } from '../lib/networkMode.js';
import { appRoutes } from '../lib/routes.js';

type Pairing = Awaited<ReturnType<typeof api.telegramPair>>;

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
  const networkMode = useNetworkMode();
  const heading = useId();
  const availability = useQuery({
    queryKey: ['telegram-availability', workflow, networkMode.mode],
    queryFn: () => api.telegramAvailability(workflow, networkMode.mode),
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
  return (
    <TelegramSettingsPanel key={`${networkMode.mode}:${props.agent}:${props.owner}`} {...props} />
  );
}

function TelegramSettingsPanel(props: NotificationProps) {
  const { agent, owner } = props;
  const workflow = props.workflow === true;
  const networkMode = useNetworkMode();
  const itemId = props.workflow ? props.workflowId : props.ruleId;
  const name = workflow ? 'workflow' : 'rule';
  const heading = useId();
  const queryClient = useQueryClient();
  const settingsKey = useMemo(
    () =>
      ['telegram-settings', networkMode.mode, agent.toLowerCase(), owner.toLowerCase()] as const,
    [agent, networkMode.mode, owner],
  );
  const { signTypedDataAsync } = useSignTypedData();
  const guard = useChainGuard();
  const [pairing, setPairing] = useState<Pairing>();
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const settings = useQuery({
    queryKey: settingsKey,
    queryFn: async ({ signal }) => {
      try {
        return await api.telegramSettings(agent, signal, networkMode.mode);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    retry: false,
    refetchInterval: ({ state: { data } }) => {
      if (!data) return false;
      return pairing || data.testDelivery === 'pending' ? 2_000 : 15_000;
    },
  });

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

  const current = settings.isError ? undefined : settings.data;

  async function run(label: string, action: () => Promise<TelegramSettings | null | void>) {
    setBusy(label);
    setError(undefined);
    try {
      await queryClient.cancelQueries({ queryKey: settingsKey });
      const result = await action();
      if (result === undefined) {
        await queryClient.invalidateQueries({ queryKey: settingsKey });
      } else {
        await queryClient.cancelQueries({ queryKey: settingsKey });
        queryClient.setQueryData(settingsKey, result);
      }
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) {
        await queryClient.cancelQueries({ queryKey: settingsKey });
        queryClient.setQueryData(settingsKey, null);
        setPairing(undefined);
        setExpired(false);
      }
      setError(
        failure instanceof ApiError || failure instanceof Error
          ? failure.message
          : 'Telegram settings could not be updated. Try again.',
      );
    } finally {
      setBusy(undefined);
    }
  }

  async function verifyWallet() {
    const challenge = await api.telegramChallenge(agent, owner, networkMode.mode);
    if (challenge.origin !== window.location.origin)
      throw new Error('Unexpected Telegram sign-in origin');
    if (!challenge.browser) throw new Error('Browser verification is temporarily unavailable.');
    const { automationChainId } = networkMode;
    const signature = await guard(
      {
        chainId: automationChainId,
        target: agent,
        targetLabel: 'Automation account',
        effect: 'Trust this browser to manage Telegram notifications for this account.',
        amount: 'Off-chain signature. No gas or funds required.',
        offChain: true,
      },
      owner,
      (connector) =>
        signTypedDataAsync({
          connector,
          account: owner,
          ...telegramSignIn(agent, challenge, automationChainId),
        }),
    );
    await api.telegramSession(agent, owner, challenge, signature, networkMode.mode);
    setPairing(undefined);
    setExpired(false);
    try {
      return await api.telegramSettings(agent, undefined, networkMode.mode);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        throw new Error('Allow cookies for Rulebook, then try verifying this browser again.');
      }
      throw error;
    }
  }

  async function forgetBrowser() {
    await api.telegramForgetBrowser(agent, networkMode.mode);
    setPairing(undefined);
    setExpired(false);
    return null;
  }

  function patchDelivery(item: DeliverySetting, preference: TelegramPreference) {
    if (current)
      void run('Saving preference…', () =>
        api.telegramPreferences(
          agent,
          workflow ? { workflowId: item.id, preference } : { ruleId: item.id, preference },
          networkMode.mode,
        ),
      );
  }

  const items = workflow
    ? (current?.workflows ?? [])
    : (current?.rules.map(({ id, preference }) => ({
        id,
        title: `Rule #${id}`,
        preference,
      })) ?? []);
  const selected = items.find(({ id }) => id === itemId);
  const connected = current?.connection === 'connected';
  const blocked = current?.connection === 'blocked';
  const candidate = expired ? null : current?.pendingPairing;
  const state =
    current === null
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
        {state === 'verify' && (
          <div className="rb-notify-callout">
            <span className="rb-notify-callout-icon" aria-hidden="true">
              <HugeiconsIcon icon={SecurityCheckIcon} size={17} strokeWidth={1.7} />
            </span>
            <div className="rb-notify-callout-copy">
              <p className="rb-notify-title">Verify wallet ownership</p>
              <p className="rb-notify-copy">
                Sign once to manage Telegram settings in this browser.
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
        {state === 'loading' && (
          <p className="app-copy rb-loading" role="status">
            <Spinner />
            Loading Telegram settings…
          </p>
        )}
        {state === 'error' && (
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
        {current && itemId && (
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
                <Link
                  className="app-link"
                  to={withNetworkQuery(appRoutes.account, networkMode.mode)}
                >
                  Account &amp; Vault
                </Link>
                .
              </p>
            )}
            {!connected && (
              <Link className="app-link" to={withNetworkQuery(appRoutes.account, networkMode.mode)}>
                Connect Telegram in Account
              </Link>
            )}
          </>
        )}
        {current && !itemId && (
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
                      const updated = await api.telegramDisconnect(agent, networkMode.mode);
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
                        candidate.id,
                        networkMode.mode,
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
                      setPairing(await api.telegramPair(agent, networkMode.mode));
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
                          api.telegramPreferences(agent, { enabled }, networkMode.mode),
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
                          api.telegramPreferences(agent, { defaultMode }, networkMode.mode),
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
                                api.telegramPreferences(
                                  agent,
                                  {
                                    [key]: enabled,
                                  },
                                  networkMode.mode,
                                ),
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
                      api.telegramTest(agent, networkMode.mode),
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
        {current && !itemId && (
          <div className="rb-notify-step">
            <button
              className="app-button"
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void run('Forgetting browser…', forgetBrowser)}
            >
              Forget this browser
            </button>
          </div>
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
