import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowRight02Icon, Book02Icon } from '@hugeicons/core-free-icons';
import { Link } from 'react-router';
import { BackgroundEffects } from '@/components/landing/background-effects.js';
import { ClosingCta } from '@/components/landing/closing-cta.js';
import { CustodySection } from '@/components/landing/custody-section.js';
import { ExecutionSection } from '@/components/landing/execution-section.js';
import { HowItWorksSection } from '@/components/landing/how-it-works-section.js';
import { HeroShowcase } from '@/components/landing/hero-showcase.js';
import { PulseDot } from '@/components/landing/pulse-dot.js';
import { SiteFooter } from '@/components/landing/site-footer.js';
import { SiteNav } from '@/components/landing/site-nav.js';
import { StackSection } from '@/components/landing/stack-section.js';
import { UseCasesSection } from '@/components/landing/use-cases-section.js';
import { appRoutes } from '@/lib/routes.js';

export function LandingPage() {
  return (
    <div id="top" className="relative min-h-screen overflow-x-hidden bg-[#020202] text-neutral-300">
      <BackgroundEffects />
      <SiteNav />

      <main className="relative z-10">
        <section className="px-6 pb-12 pt-36">
          <div className="mx-auto mb-16 max-w-4xl text-center">
            <div className="animate-on-scroll [animation:fadeInUp_0.8s_ease-out_0.1s_both] mb-8 inline-flex items-center gap-2 rounded-full border border-blue-500/20 bg-blue-950/10 px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-blue-200 shadow-[0_0_15px_rgba(59,130,246,0.15)]">
              <PulseDot />
              Available on testnet
            </div>

            <h1 className="animate-on-scroll [animation:fadeInUp_0.8s_ease-out_0.2s_both] mb-6 text-balance text-4xl font-medium leading-[1.05] tracking-tight text-white sm:text-5xl lg:text-[3.5rem]">
              Automate trades, transfers, and alerts
            </h1>

            <p className="animate-on-scroll [animation:fadeInUp_0.8s_ease-out_0.3s_both] mx-auto mb-9 max-w-xl text-pretty text-base font-light md:text-lg leading-relaxed text-neutral-300 tracking-tight">
              Pick a template and fill in the blanks. Your rule can be as simple as “Buy 10 USDC
              worth of WETH every week.”
            </p>

            <div className="animate-on-scroll [animation:fadeInUp_0.8s_ease-out_0.4s_both] flex flex-wrap items-center justify-center gap-4">
              <Link
                to={appRoutes.create}
                className="group relative flex items-center gap-2 rounded-full bg-white text-black px-8 py-3 text-sm font-medium transition-all hover:bg-neutral-200"
              >
                <span>Create a rule</span>
                <HugeiconsIcon
                  icon={ArrowRight02Icon}
                  size={16}
                  aria-hidden="true"
                  className="transition-transform group-hover:translate-x-0.5"
                />
              </Link>
              <Link
                to={appRoutes.marketplace}
                className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-6 py-3 text-sm font-medium text-white transition-all hover:bg-white/[0.08]"
              >
                <HugeiconsIcon
                  icon={Book02Icon}
                  size={16}
                  className="text-neutral-400"
                  aria-hidden="true"
                />
                <span>Browse public rules</span>
              </Link>
            </div>
          </div>

          <HeroShowcase />
        </section>
        <UseCasesSection />
        <HowItWorksSection />
        <ExecutionSection />
        <CustodySection />
        <StackSection />
        <ClosingCta />
      </main>
      <SiteFooter />
    </div>
  );
}
