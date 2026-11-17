import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowRight02Icon, Book02Icon } from '@hugeicons/core-free-icons';
import { Link } from 'react-router';
import { BackgroundEffects } from '@/components/landing/background-effects.js';
import { BriefSection } from '@/components/landing/brief-section.js';
import { ClosingCta } from '@/components/landing/closing-cta.js';
import { CoverageSection } from '@/components/landing/coverage-section.js';
import { EmailLoopSection } from '@/components/landing/email-loop-section.js';
import { HowItWorksSection } from '@/components/landing/how-it-works-section.js';
import { HeroShowcase } from '@/components/landing/hero-showcase.js';
import { ProblemSection } from '@/components/landing/problem-section.js';
import { PulseDot } from '@/components/landing/pulse-dot.js';
import { SiteFooter } from '@/components/landing/site-footer.js';
import { SiteNav } from '@/components/landing/site-nav.js';
import { StackSection } from '@/components/landing/stack-section.js';
import { TrustSection } from '@/components/landing/trust-section.js';
import { appRoutes } from '@/lib/routes.js';

export function LandingPage() {
  return (
    <div id="top" className="relative min-h-screen overflow-x-hidden bg-[#020202] text-neutral-300">
      <BackgroundEffects />
      <SiteNav />

      <main className="relative z-10 px-6 pb-12 pt-36">
        <div className="mx-auto mb-16 max-w-4xl text-center">
          <div className="animate-on-scroll [animation:fadeInUp_0.8s_ease-out_0.1s_both] mb-8 inline-flex items-center gap-2 rounded-full border border-blue-500/20 bg-blue-950/10 px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-blue-200 shadow-[0_0_15px_rgba(59,130,246,0.15)]">
            <PulseDot />
            Autonomous On-Chain Personal Automations
          </div>

          <h1 className="animate-on-scroll [animation:fadeInUp_0.8s_ease-out_0.2s_both] mb-6 text-balance text-4xl font-medium leading-[1.05] tracking-tight text-white sm:text-5xl lg:text-[3.5rem]">
            Assemble a money rule in one sentence.
            <br />
            <span className="text-neutral-400">You keep the money. The operator pays the gas.</span>
          </h1>

          <p className="animate-on-scroll [animation:fadeInUp_0.8s_ease-out_0.3s_both] mx-auto mb-9 max-w-xl text-base font-light md:text-lg leading-relaxed text-neutral-300 tracking-tight">
            Rulebook turns personal financial intent into self-executing smart contracts on Reactive
            Network. Zero code, 100% self-custody in your personal Vault, and nobody has to keep a
            server awake.
          </p>

          <div className="animate-on-scroll [animation:fadeInUp_0.8s_ease-out_0.4s_both] flex flex-wrap items-center justify-center gap-4">
            <Link
              to={appRoutes.rules}
              className="group relative flex items-center gap-2 rounded-full bg-white text-black px-8 py-3 text-sm font-medium transition-all hover:bg-neutral-200"
            >
              <span>Launch Rulebook</span>
              <HugeiconsIcon
                icon={ArrowRight02Icon}
                size={16}
                className="transition-transform group-hover:translate-x-0.5"
              />
            </Link>
            <Link
              to={appRoutes.marketplace}
              className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-6 py-3 text-sm font-medium text-white transition-all hover:bg-white/[0.08]"
            >
              <HugeiconsIcon icon={Book02Icon} size={16} className="text-neutral-400" />
              <span>Browse 13 templates</span>
            </Link>
          </div>
        </div>

        <HeroShowcase />
      </main>

      <StackSection />
      <ProblemSection />
      <HowItWorksSection />
      <EmailLoopSection />
      <BriefSection />
      <CoverageSection />
      <TrustSection />
      <ClosingCta />
      <SiteFooter />
    </div>
  );
}
