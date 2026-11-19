import { driver, type Driver } from 'driver.js';
import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';

import 'driver.js/dist/driver.css';
import '../styles/first-rule-guide.css';

export function useFirstRuleGuide() {
  const location = useLocation();
  const navigate = useNavigate();
  const instance = useRef<Driver>(null);
  const replayButton = useRef<HTMLButtonElement>(null);
  const autoStart = location.state?.firstRuleGuide === true;

  const stop = useCallback(() => {
    instance.current?.destroy();
  }, []);

  const start = useCallback(() => {
    if (instance.current?.isActive()) return;
    const guide = driver({
      animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      duration: 180,
      overlayOpacity: 0.64,
      overlayClickBehavior: 'none',
      stagePadding: 4,
      stageRadius: 10,
      popoverClass: 'first-rule-guide',
      showProgress: true,
      progressText: '{{current}} of {{total}}',
      doneBtnText: 'Finish guide',
      closeBtnLabel: 'Skip guide',
      onDestroyed: (_element, _step, { reason }) => {
        instance.current = null;
        if (reason !== 'api') {
          // Driver restores its own return focus after this callback.
          queueMicrotask(() => replayButton.current?.focus({ preventScroll: true }));
        }
      },
      steps: [
        {
          element: '.rule-composer__template-row',
          popover: {
            title: 'Choose a rule type',
            description:
              'Start with a scheduled buy, a transfer, or an alert. The sentence updates when you change the type.',
            showButtons: ['next', 'close'],
            side: 'bottom',
            align: 'start',
          },
        },
        {
          element: '.rule-composer__canvas',
          popover: {
            title: 'Fill in the sentence',
            description:
              'Select each blank to pick a value or enter your own where available. Read the sentence back to check what the rule will do.',
            side: 'bottom',
            align: 'start',
          },
        },
        {
          element: '#review-create-rule',
          popover: {
            title: 'Review and sign',
            description:
              'Once your sentence is complete, select Review and create rule. Check the details, then approve the request in your wallet on Reactive Lasna.',
            side: 'top',
            align: 'start',
          },
        },
      ],
    });
    instance.current = guide;
    guide.drive();
  }, []);

  useEffect(() => {
    if (!autoStart) return;
    const frame = window.requestAnimationFrame(() => {
      start();
      void navigate(location.pathname, { replace: true, state: null });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [autoStart, location.pathname, navigate, start]);

  useEffect(() => stop, [stop]);

  return { start, stop, replayButton };
}
