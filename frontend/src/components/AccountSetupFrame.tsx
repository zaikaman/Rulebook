import {
  ArrowLeft01Icon,
  Coins01Icon,
  Pulse01Icon,
  Shield01Icon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router';

import { appRoutes } from '../lib/routes.js';
import { WalletControl } from './chrome/WalletControl.js';
import { Wordmark } from './chrome/Wordmark.js';
import '../styles/onboarding.css';

export const ACCOUNT_SETUP_STEPS = 5;

const setupStepLabels = ['Wallet', 'Networks', 'Tokens', 'Account', 'Funding'] as const;

export function AccountSetupFrame({
  title,
  description,
  step,
  connected,
  focusOnMount = false,
  compact = false,
  workflow = false,
  manageAccount = false,
  children,
}: {
  title: string;
  description: string;
  step?: number;
  connected: boolean;
  focusOnMount?: boolean;
  compact?: boolean;
  workflow?: boolean;
  manageAccount?: boolean;
  children: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef(step);
  useEffect(() => {
    if (focusOnMount || previousStep.current !== step) heading.current?.focus();
    previousStep.current = step;
  }, [focusOnMount, step]);

  return (
    <div className="account-setup" data-workflow={workflow || undefined}>
      <header className="account-setup__toolbar">
        <Link to={appRoutes.landing} className="account-setup__brand" aria-label="Rulebook home">
          <Wordmark />
        </Link>
        {connected && (
          <div className="account-setup__session">
            <WalletControl />
          </div>
        )}
      </header>

      <div
        className={
          compact ? 'account-setup__stage account-setup__stage--compact' : 'account-setup__stage'
        }
      >
        <header className="account-setup__heading">
          <div>
            <h1
              id="account-setup-title"
              ref={heading}
              tabIndex={-1}
              aria-describedby={step ? 'setup-step-count' : undefined}
            >
              {title}
            </h1>
            <p>{description}</p>
          </div>
          <div className="account-setup__meta">
            {step && (
              <span id="setup-step-count">
                Step {step} of {ACCOUNT_SETUP_STEPS}
              </span>
            )}
            <span className="account-setup__environment">
              <span aria-hidden="true" />
              Testnet
            </span>
          </div>
        </header>

        {step && (
          <ol className="account-setup__progress" aria-label="Account setup progress">
            {setupStepLabels.map((label, index) => {
              const position = index + 1;
              const state = position < step ? 'done' : position === step ? 'current' : 'upcoming';
              return (
                <li
                  key={label}
                  data-state={state}
                  aria-label={label}
                  aria-current={position === step ? 'step' : undefined}
                >
                  <span className="account-setup__progress-dot" aria-hidden="true">
                    {state === 'done' ? (
                      <HugeiconsIcon icon={Tick02Icon} size={11} strokeWidth={2.2} />
                    ) : (
                      position
                    )}
                  </span>
                  <span className="account-setup__progress-label" aria-hidden="true">
                    {label}
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        <div
          className={
            step ? 'account-setup__layout' : 'account-setup__layout account-setup__layout--single'
          }
        >
          <div className="account-setup__main">{children}</div>
          {step ? (
            <aside className="account-setup__aside" aria-label="What account setup creates">
              <p className="account-setup__aside-label">Setup creates</p>
              <ul className="account-setup__aside-list">
                <li>
                  <span className="account-setup__aside-icon" aria-hidden="true">
                    <HugeiconsIcon icon={Pulse01Icon} size={15} strokeWidth={1.8} />
                  </span>
                  <div>
                    <strong>Automation account</strong>
                    <p>Watches for triggers and evaluates runs on Reactive Lasna.</p>
                  </div>
                </li>
                <li>
                  <span className="account-setup__aside-icon" aria-hidden="true">
                    <HugeiconsIcon icon={Shield01Icon} size={15} strokeWidth={1.8} />
                  </span>
                  <div>
                    <strong>Vault</strong>
                    <p>Holds test funds and settles approved actions on Unichain Sepolia.</p>
                  </div>
                </li>
                <li>
                  <span className="account-setup__aside-icon" aria-hidden="true">
                    <HugeiconsIcon icon={Coins01Icon} size={15} strokeWidth={1.8} />
                  </span>
                  <div>
                    <strong>Fee credit</strong>
                    <p>Pays for trigger checks and settlement callbacks as workflows run.</p>
                  </div>
                </li>
              </ul>
              <p className="account-setup__aside-foot">
                Testnet only. Your keys stay in your wallet throughout setup.
              </p>
            </aside>
          ) : null}
        </div>

        <div className="account-setup__links">
          <Link
            to={workflow ? appRoutes.workflows : appRoutes.rules}
            className="account-setup__exit"
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} size={15} aria-hidden="true" />
            {workflow ? 'Back to workflows' : 'Back to rules'}
          </Link>
          {manageAccount && (
            <Link className="account-setup__exit" to={appRoutes.accountFunds}>
              Manage vault funds
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
