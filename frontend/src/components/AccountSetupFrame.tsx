import { ArrowLeft01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router';

import { appRoutes } from '../lib/routes.js';
import { WalletControl } from './chrome/WalletControl.js';
import { Wordmark } from './chrome/Wordmark.js';
import '../styles/onboarding.css';

export const ACCOUNT_SETUP_STEPS = 5;

export function AccountSetupFrame({
  title,
  description,
  step,
  connected,
  focusOnMount = false,
  compact = false,
  children,
}: {
  title: string;
  description: string;
  step?: number;
  connected: boolean;
  focusOnMount?: boolean;
  compact?: boolean;
  children: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef(step);
  useEffect(() => {
    if (focusOnMount || previousStep.current !== step) heading.current?.focus();
    previousStep.current = step;
  }, [focusOnMount, step]);

  return (
    <div className="account-setup">
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
        {children}
        <Link to={appRoutes.rules} className="account-setup__exit">
          <HugeiconsIcon icon={ArrowLeft01Icon} size={15} aria-hidden="true" />
          Back to rules
        </Link>
      </div>
    </div>
  );
}
