import {
  assistantMessageLimit,
  assistantSignIn,
  type AssistantPage,
  type AssistantReference,
} from '@rulebook/shared';
import {
  Alert02Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  LockKeyIcon,
  MessageQuestionIcon,
  Pulse01Icon,
  Shield01Icon,
  SparklesIcon,
  Wallet01Icon,
  Add01Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import { useAccount, useSignMessage } from 'wagmi';

import { WalletControl } from '@/components/chrome/WalletControl';
import { ApiError, api } from '@/lib/api';
import { streamAssistant } from '@/lib/assistant';
import { isWalletRejection } from '@/lib/errors';
import { Button, Callout, Dialog, ErrorState } from '@/ui';
import '../styles/assistant.css';

type Session = { owner: string; token: string };
type ToolState = 'start' | 'done' | 'error';
type ToolRead = { name: string; label: string; state: ToolState; detail?: string };
type Message = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  tools: ToolRead[];
  references: AssistantReference[];
  error?: string;
};

function id() {
  return crypto.randomUUID();
}

export function suggestionsFor(pathname: string | undefined) {
  if (pathname?.startsWith('/account'))
    return [
      'How much execution and watching credit is left?',
      'What are my Vault balances?',
      'What should I fund next?',
    ];
  if (pathname?.startsWith('/activity'))
    return ['Why did my last run fail?', 'Which runs are still pending?', 'Show my last five runs'];
  if (pathname?.startsWith('/marketplace'))
    return ['What workflows can I copy right now?', 'Find a workflow for a recurring transfer'];
  if (/^\/workflows\/[^/]+/.test(pathname ?? ''))
    return [
      'What does this workflow do?',
      'When did it last run?',
      'Is anything blocking this workflow?',
    ];
  if (pathname?.startsWith('/workflows'))
    return [
      'Which workflows need attention?',
      'How much of my weekly budget is left?',
      'How many workflows are active?',
    ];
  if (pathname?.startsWith('/cost'))
    return ['What pays for a run?', 'How much credit is left on each network?'];
  return [
    'Which of my workflows need attention?',
    'What did my last run do?',
    'How much credit is left?',
    'What are my Vault balances?',
  ];
}

export function AssistantPanel({
  open,
  page,
  onClose,
}: {
  readonly open: boolean;
  readonly page: AssistantPage;
  readonly onClose: () => void;
}) {
  const titleId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const operation = useRef<AbortController>(undefined);
  const { address, connector } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const availability = useQuery({
    queryKey: ['assistant-availability'],
    queryFn: ({ signal }) => api.assistantAvailability(signal),
    enabled: open,
    retry: false,
    staleTime: 60_000,
  });
  const [session, setSession] = useState<Session>();
  const [verifying, setVerifying] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string>();
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();

  const usableSession = session && address && session.owner === address ? session : undefined;

  useEffect(() => {
    if (session && address && session.owner !== address) {
      setSession(undefined);
      setMessages([]);
      setConversationId(undefined);
    }
  }, [address, session]);

  useEffect(() => () => operation.current?.abort(), []);

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages, status]);

  async function verify() {
    if (!address || verifying) return;
    if (!connector) {
      setError('Reconnect your wallet, then try again.');
      return;
    }
    setVerifying(true);
    setError(undefined);
    try {
      const challenge = await api.assistantChallenge(address, new AbortController().signal);
      if (challenge.origin !== window.location.origin || challenge.owner !== address.toLowerCase())
        throw new Error('Bookkeeper received an unexpected wallet challenge.');
      const signature = await signMessageAsync({
        connector,
        account: address,
        message: assistantSignIn(challenge),
      });
      const response = await api.assistantSession(
        challenge.nonce,
        signature,
        new AbortController().signal,
      );
      setSession({ owner: address, ...response });
      setMessages([]);
      setConversationId(undefined);
    } catch (cause) {
      setError(
        isWalletRejection(cause)
          ? 'Wallet verification declined. Try again when you are ready.'
          : cause instanceof ApiError && cause.code !== 'http_error'
            ? cause.message
            : 'Wallet verification failed. Try again.',
      );
    } finally {
      setVerifying(false);
    }
  }

  function updateAssistant(messageId: string, update: (message: Message) => Message) {
    setMessages((previous) =>
      previous.map((message) => (message.id === messageId ? update(message) : message)),
    );
  }

  async function send(value?: string) {
    const question = (value ?? input).trim();
    if (!question || !usableSession || operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    const assistantId = id();
    let finished = false;
    setInput('');
    setError(undefined);
    setStreaming(true);
    setStatus('Reading your account');
    setMessages((previous) => [
      ...previous,
      { id: id(), role: 'user', text: question, tools: [], references: [] },
      { id: assistantId, role: 'assistant', text: '', tools: [], references: [] },
    ]);

    try {
      await streamAssistant(
        { message: question, conversationId, page },
        usableSession.token,
        (event) => {
          if (operation.current !== controller) return;
          if (event.type === 'status') {
            setStatus(event.label);
            return;
          }
          if (event.type === 'tool') {
            updateAssistant(assistantId, (message) => {
              const tools = [...message.tools];
              const index = tools.findIndex(
                (tool) => tool.name === event.name && tool.state === 'start',
              );
              if (event.state === 'start') {
                tools.push({ name: event.name, label: event.label, state: 'start' });
              } else if (index !== -1) {
                tools[index] = {
                  ...tools[index]!,
                  state: event.state,
                  detail: event.detail ?? event.label,
                };
              } else {
                tools.push({
                  name: event.name,
                  label: event.label,
                  state: event.state,
                  detail: event.detail,
                });
              }
              return { ...message, tools };
            });
            return;
          }
          if (event.type === 'delta') {
            updateAssistant(assistantId, (message) => ({
              ...message,
              text: message.text + event.text,
            }));
            return;
          }
          if (event.type === 'done') {
            finished = true;
            setConversationId(event.conversationId);
            updateAssistant(assistantId, (message) => ({
              ...message,
              references: event.references,
            }));
            return;
          }
          finished = true;
          updateAssistant(assistantId, (message) => ({ ...message, error: event.message }));
        },
        controller.signal,
      );
      if (operation.current === controller && !finished && !controller.signal.aborted)
        updateAssistant(assistantId, (message) => ({
          ...message,
          error: 'Bookkeeper stopped before it finished. Try again.',
        }));
    } catch (cause) {
      if (operation.current === controller && !controller.signal.aborted) {
        if (cause instanceof ApiError && cause.status === 401) {
          setSession(undefined);
          setConversationId(undefined);
          setError('Your Bookkeeper session expired. Verify your wallet again.');
          updateAssistant(assistantId, (message) => ({
            ...message,
            error: 'Your verification expired. Verify the wallet again.',
          }));
        } else {
          updateAssistant(assistantId, (message) => ({
            ...message,
            error:
              cause instanceof Error && cause.name !== 'TimeoutError'
                ? cause.message
                : 'Bookkeeper did not respond. Try again.',
          }));
        }
      }
    } finally {
      if (operation.current === controller) {
        operation.current = undefined;
        if (!controller.signal.aborted) {
          setStreaming(false);
          setStatus(undefined);
        }
      }
    }
  }

  function resetChat() {
    operation.current?.abort();
    operation.current = undefined;
    setMessages([]);
    setConversationId(undefined);
    setInput('');
    setStreaming(false);
    setStatus(undefined);
    setError(undefined);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void send();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !streaming) {
      event.preventDefault();
      void send();
    }
  }

  function renderBody() {
    if (availability.isPending)
      return (
        <p className="app-assistant-state" role="status">
          Checking Bookkeeper availability…
        </p>
      );
    if (availability.isError)
      return (
        <ErrorState
          message="Bookkeeper could not check availability."
          detail={availability.error?.message}
          onRetry={() => void availability.refetch()}
        />
      );
    if (!availability.data?.available)
      return (
        <Callout
          title="Bookkeeper is unavailable"
          action={<Button onClick={() => void availability.refetch()}>Check again</Button>}
        >
          <p>
            The assistant needs the backend model configuration. You can still build, fund, and
            monitor workflows from the workspace.
          </p>
        </Callout>
      );
    if (!address)
      return (
        <Callout title="Connect a wallet to start" action={<WalletControl />}>
          <p>
            Bookkeeper answers from the account behind the connected wallet. Connect the wallet that
            owns the Agent and Vault.
          </p>
        </Callout>
      );
    if (!usableSession)
      return (
        <div className="app-assistant-verify">
          <span className="app-assistant-verify-mark" aria-hidden="true">
            <HugeiconsIcon icon={SparklesIcon} size={22} strokeWidth={1.6} />
          </span>
          <div className="app-assistant-verify-copy">
            <h3>Ask your own account</h3>
            <p>
              Bookkeeper reads your workflows, runs, balances, credits, and notification settings
              when a question needs them.
            </p>
          </div>
          <ul className="app-assistant-facts">
            <li>
              <HugeiconsIcon icon={LockKeyIcon} size={13} strokeWidth={1.8} aria-hidden="true" />
              Off-chain signature
            </li>
            <li>
              <HugeiconsIcon
                icon={CheckmarkCircle02Icon}
                size={13}
                strokeWidth={1.8}
                aria-hidden="true"
              />
              No gas or approvals
            </li>
            <li>
              <HugeiconsIcon icon={Pulse01Icon} size={13} strokeWidth={1.8} aria-hidden="true" />
              No session timeout
            </li>
            <li>
              <HugeiconsIcon icon={Shield01Icon} size={13} strokeWidth={1.8} aria-hidden="true" />
              Read-only account access
            </li>
          </ul>
          <Button
            autoFocus
            variant="primary"
            disabled={verifying}
            onClick={() => void verify()}
            className="app-assistant-verify-action"
          >
            {verifying ? 'Waiting for your wallet…' : 'Verify wallet'}
          </Button>
          <p className="app-assistant-disclaimer">
            Questions and the records each answer reads are sent to the configured model provider.
            Nothing is fetched until a question needs it.
          </p>
        </div>
      );

    if (!messages.length)
      return (
        <div className="app-assistant-welcome">
          <span className="app-assistant-welcome-mark" aria-hidden="true">
            <HugeiconsIcon icon={MessageQuestionIcon} size={20} strokeWidth={1.7} />
          </span>
          <h3>What do you want to know?</h3>
          <p>Workflows, runs, funds, credits, weekly budgets, or alerts. Ask in plain language.</p>
          <div className="app-assistant-suggestions">
            {suggestionsFor(page.path).map((prompt) => (
              <button
                key={prompt}
                type="button"
                className="app-assistant-suggestion"
                disabled={streaming}
                onClick={() => void send(prompt)}
              >
                <span>{prompt}</span>
                <HugeiconsIcon icon={ArrowRight01Icon} size={14} aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
      );

    return (
      <ol className="app-assistant-thread" aria-label="Conversation" aria-busy={streaming}>
        {messages.map((message) => (
          <li key={message.id} className="app-assistant-message" data-role={message.role}>
            {message.role === 'assistant' && message.tools.length > 0 && (
              <ul className="app-assistant-tools" aria-label="Records Bookkeeper read">
                {message.tools.map((tool, index) => (
                  <li key={`${tool.name}-${index}`} data-state={tool.state}>
                    <span className="app-assistant-tool-mark" aria-hidden="true">
                      {tool.state === 'start' ? (
                        <span className="app-assistant-tool-pulse" />
                      ) : tool.state === 'error' ? (
                        <HugeiconsIcon icon={Alert02Icon} size={12} strokeWidth={2} />
                      ) : (
                        <HugeiconsIcon icon={CheckmarkCircle02Icon} size={12} strokeWidth={2} />
                      )}
                    </span>
                    <span>{tool.state === 'start' ? tool.label : (tool.detail ?? tool.label)}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="app-assistant-bubble">
              {message.text ? (
                message.text
              ) : message.error ? null : (
                <span className="app-assistant-thinking" role="status">
                  {status ?? 'Thinking'}
                </span>
              )}
            </div>
            {message.error && (
              <p className="app-assistant-message-error" role="alert">
                <HugeiconsIcon icon={Alert02Icon} size={14} strokeWidth={1.8} aria-hidden="true" />
                {message.error}
              </p>
            )}
            {message.references.length > 0 && (
              <div className="app-assistant-refs" aria-label="Open related pages">
                {message.references.map((reference) => (
                  <Link
                    key={`${reference.kind}-${reference.id}-${reference.href}`}
                    className="app-assistant-ref"
                    to={reference.href}
                    data-kind={reference.kind}
                    onClick={onClose}
                  >
                    {reference.label}
                    <HugeiconsIcon icon={ArrowRight01Icon} size={12} aria-hidden="true" />
                  </Link>
                ))}
              </div>
            )}
          </li>
        ))}
      </ol>
    );
  }

  if (!open) return null;

  return (
    <Dialog labelledBy={titleId} onCancel={onClose} className="app-assistant-dialog">
      <div className="app-assistant">
        <header className="app-assistant-head">
          <span className="app-assistant-mark" aria-hidden="true">
            <HugeiconsIcon icon={SparklesIcon} size={19} strokeWidth={1.6} />
          </span>
          <div className="app-assistant-heading">
            <span className="app-assistant-eyebrow">Account assistant</span>
            <h2 id={titleId} className="app-panel-heading">
              Bookkeeper
            </h2>
            <p>Ask anything about this wallet’s Rulebook data.</p>
          </div>
          <div className="app-assistant-head-actions">
            {usableSession && messages.length > 0 && (
              <Button
                variant="quiet"
                className="app-icon-button"
                aria-label="Start a new chat"
                onClick={resetChat}
              >
                <HugeiconsIcon icon={Add01Icon} size={16} strokeWidth={1.8} aria-hidden="true" />
              </Button>
            )}
            <Button
              variant="quiet"
              className="app-icon-button"
              aria-label="Close Bookkeeper"
              onClick={onClose}
            >
              <HugeiconsIcon icon={Cancel01Icon} size={16} strokeWidth={1.8} aria-hidden="true" />
            </Button>
          </div>
        </header>

        {usableSession && (
          <div className="app-assistant-context" aria-label="Assistant guarantees">
            <span>
              <HugeiconsIcon icon={Pulse01Icon} size={12} strokeWidth={1.9} aria-hidden="true" />
              Fetches only what it needs
            </span>
            <span>
              <HugeiconsIcon icon={Shield01Icon} size={12} strokeWidth={1.9} aria-hidden="true" />
              Read-only
            </span>
            <span>
              <HugeiconsIcon icon={LockKeyIcon} size={12} strokeWidth={1.9} aria-hidden="true" />
              Private session
            </span>
            <span className="app-assistant-wallet" title={address ?? undefined}>
              {address ? `${address.slice(0, 6)}…${address.slice(-4)}` : 'No wallet'}
            </span>
          </div>
        )}

        <div className="app-assistant-body" ref={scrollRef}>
          {renderBody()}
          {error && (
            <p className="app-assistant-error" role="alert">
              <HugeiconsIcon icon={Alert02Icon} size={14} strokeWidth={1.8} aria-hidden="true" />
              {error}
            </p>
          )}
          <p className="sr-only" role="status">
            {streaming ? (status ?? 'Bookkeeper is answering') : ''}
          </p>
        </div>

        {usableSession && (
          <form className="app-assistant-composer" aria-busy={streaming} onSubmit={handleSubmit}>
            <label className="app-assistant-field">
              <span className="sr-only">Ask Bookkeeper about your account</span>
              <textarea
                className="app-input app-assistant-input"
                rows={2}
                maxLength={assistantMessageLimit}
                value={input}
                autoFocus
                placeholder={
                  page.workflowId
                    ? 'Ask about this workflow…'
                    : 'Ask about your workflows, runs, or balances…'
                }
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
              />
            </label>
            <div className="app-assistant-composer-foot">
              <span className="app-assistant-count">
                {input.length}/{assistantMessageLimit}
              </span>
              <Button
                type="submit"
                variant="primary"
                className="app-icon-button"
                aria-label="Send question"
                disabled={streaming || !input.trim()}
              >
                {streaming ? (
                  <span className="app-assistant-spinner" aria-hidden="true" />
                ) : (
                  <HugeiconsIcon
                    icon={ArrowRight01Icon}
                    size={16}
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                )}
              </Button>
            </div>
            <p className="app-assistant-note">
              <HugeiconsIcon icon={Wallet01Icon} size={12} strokeWidth={1.8} aria-hidden="true" />
              Read-only. Check the chain before acting on an answer.
            </p>
          </form>
        )}
      </div>
    </Dialog>
  );
}
