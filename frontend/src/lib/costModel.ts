const dailyDca = { monitoringReactPerYear: '44', ethPerSwap: '0.0000006' } as const;

export interface FeeFigure {
  readonly amount: string;
  readonly unit: string;
}

export interface RateRow {
  readonly operation: string;
  readonly trigger: string;
  readonly cost: FeeFigure;
}

export interface AnnualScenario {
  readonly label: string;
  readonly detail: string;
  readonly reactPerYear: number;
}

export const costModel = {
  measuredOn: '2026-11-16',
  dailyDca,
  networks: {
    automation: {
      baseFee: { amount: '100', unit: 'gwei' },
      feeToken: 'test REACT',
      reserve: 'Agent’s REACT reserve',
    },
    funds: {
      baseFee: { amount: '0.0015', unit: 'gwei' },
      feeToken: 'test ETH',
      reserve: 'Vault’s ETH reserve',
    },
  },
  rates: {
    automation: [
      {
        operation: 'Add a rule',
        trigger: 'Once',
        cost: { amount: '0.022', unit: 'REACT' },
      },
      {
        operation: 'Cron tick',
        trigger: 'No fire',
        cost: { amount: '0.013', unit: 'REACT' },
      },
      {
        operation: 'Cron tick',
        trigger: 'Fires',
        cost: { amount: '0.022', unit: 'REACT' },
      },
      {
        operation: 'Price event',
        trigger: 'No fire',
        cost: { amount: '0.014', unit: 'REACT' },
      },
      {
        operation: 'Price event',
        trigger: 'Fires',
        cost: { amount: '0.023', unit: 'REACT' },
      },
    ],
    funds: [
      {
        operation: 'Callback swap',
        trigger: 'Executes',
        cost: { amount: dailyDca.ethPerSwap, unit: 'ETH' },
      },
    ],
  },
  annual: {
    schedule: [
      {
        label: 'Daily DCA',
        detail: 'Checks every ~3 hours · Cron10000',
        reactPerYear: Number(dailyDca.monitoringReactPerYear),
      },
      {
        label: 'Weekly DCA',
        detail: 'Checks every ~3 hours · Cron10000',
        reactPerYear: 42,
      },
      {
        label: 'Daily DCA',
        detail: 'Checks every ~17 minutes · Cron1000',
        reactPerYear: 410,
      },
      {
        label: 'Daily DCA',
        detail: 'Checks every ~2 minutes · Cron100',
        reactPerYear: 4_100,
      },
    ],
    price: [
      {
        label: 'Price rule',
        detail: 'About 10 events a day',
        reactPerYear: 51,
      },
      {
        label: 'Price rule',
        detail: 'About 1,000 events a day',
        reactPerYear: 5_100,
      },
    ],
  },
} as const satisfies {
  measuredOn: `${number}-${number}-${number}`;
  dailyDca: { monitoringReactPerYear: string; ethPerSwap: string };
  networks: Record<
    'automation' | 'funds',
    { baseFee: FeeFigure; feeToken: string; reserve: string }
  >;
  rates: Record<'automation' | 'funds', readonly RateRow[]>;
  annual: Record<'schedule' | 'price', readonly AnnualScenario[]>;
};
