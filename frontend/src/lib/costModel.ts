const dailyDca = { monitoringReactPerYear: '44', ethPerSwap: '0.0000006' } as const;

export const costModel = {
  measuredOn: '2026-11-16',
  dailyDca,
  baseFees: [
    ['Reactive Lasna', '100 gwei'],
    ['Unichain Sepolia', '0.0015 gwei'],
  ],
  calls: [
    ['Add a rule', '0.022 REACT'],
    ['Cron tick, no fire', '0.013 REACT'],
    ['Cron tick, fires', '0.022 REACT'],
    ['Price event, no fire', '0.014 REACT'],
    ['Price event, fires', '0.023 REACT'],
    ['Unichain callback swap', `${dailyDca.ethPerSwap} ETH`],
  ],
  annual: [
    ['Daily DCA, Cron10000', `${dailyDca.monitoringReactPerYear} REACT`],
    ['Weekly DCA, Cron10000', '42 REACT'],
    ['Daily DCA, Cron1000', '410 REACT'],
    ['Daily DCA, Cron100', '4,100 REACT'],
    ['Price rule, 10 events/day', '51 REACT'],
    ['Price rule, 1,000 events/day', '5,100 REACT'],
  ],
} as const satisfies {
  measuredOn: `${number}-${number}-${number}`;
  dailyDca: { monitoringReactPerYear: string; ethPerSwap: string };
  baseFees: readonly (readonly [string, string])[];
  calls: readonly (readonly [string, string])[];
  annual: readonly (readonly [string, string])[];
};
