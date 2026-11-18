import { Link } from 'react-router';

import { appRoutes } from '@/lib/routes.js';
import { PhoneShowcase } from './phone-showcase.js';
import { SectionHeading } from './section-heading.js';

const steps = [
  {
    title: 'The pool price moves',
    body: 'A price update on Unichain Sepolia puts WETH below your limit.',
  },
  {
    title: 'Your rule is evaluated',
    body: 'Your automation account on Reactive Lasna sees the update and asks your vault to make the trade.',
  },
  {
    title: 'Your vault checks the trade',
    body: 'The vault checks the price again and swaps USDC for WETH if the trade still meets your rule.',
  },
] as const;

export function ExecutionSection() {
  return (
    <section id="proof" className="relative z-10 mx-auto max-w-6xl scroll-mt-28 px-6 py-20">
      <SectionHeading
        title="See what happened when a rule ran"
        lede="Open an execution proof to see what triggered the rule, how it was evaluated, and what happened on the destination chain. Each recorded step links to its block explorer."
      />

      <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <PhoneShowcase />

        <div className="max-w-lg">
          <h3 className="mb-3 text-sm font-medium text-blue-300">Example limit buy</h3>
          <ol className="divide-y divide-white/10">
            {steps.map((step) => (
              <li key={step.title} className="space-y-1.5 py-4 first:pt-0">
                <h4 className="text-base font-medium text-white">{step.title}</h4>
                <p className="text-sm leading-relaxed text-neutral-400">{step.body}</p>
              </li>
            ))}
          </ol>
          <Link
            to={appRoutes.proof}
            className="mt-4 inline-block text-sm font-medium text-blue-200 underline underline-offset-4 hover:text-white"
          >
            Open Proof Explorer
          </Link>
        </div>
      </div>
    </section>
  );
}
