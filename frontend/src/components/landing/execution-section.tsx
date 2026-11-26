import { Link } from 'react-router';

import { useNetworkMode, withNetworkQuery } from '@/lib/networkMode.js';
import { appRoutes } from '@/lib/routes.js';
import { PhoneShowcase } from './phone-showcase.js';
import { SectionHeading } from './section-heading.js';

const steps = [
  {
    title: 'The pool price moves',
    body: 'A price update on Unichain puts WETH below your limit.',
  },
  {
    title: 'Your workflow chooses a path',
    body: 'Your Agent on Reactive Network sees the update, checks your conditions, and asks your Vault to run the chosen steps.',
  },
  {
    title: 'Your vault checks the trade',
    body: 'The Vault checks the price again and swaps USDC for WETH if the price still meets your condition.',
  },
] as const;

export function ExecutionSection() {
  const { mode } = useNetworkMode();
  return (
    <section id="proof" className="relative z-10 mx-auto max-w-6xl scroll-mt-28 px-6 py-20">
      <SectionHeading
        title="See which path ran"
        lede="Open a run to see what started it, which path the Agent chose, and which actions the Vault completed. Follow the links to verify each transaction."
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
            to={withNetworkQuery(appRoutes.workflows, mode)}
            className="mt-4 inline-block text-sm font-medium text-blue-200 underline underline-offset-4 hover:text-white"
          >
            Open Workflows
          </Link>
        </div>
      </div>
    </section>
  );
}
