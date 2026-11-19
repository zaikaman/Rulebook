import { appRoutes } from './routes.js';
import { testnetTokens } from './testnetTokens.js';

export type RuleFee = 'watching' | 'execution';

export const ruleFees = {
  watching: {
    title: 'Monitoring fees',
    description: 'REACT pays for checking when your rules should run.',
    token: testnetTokens.react,
    target: testnetTokens.react.network.systemContract,
  },
  execution: {
    title: 'Execution fees',
    description: 'ETH pays for carrying out trades and transfers.',
    token: testnetTokens.eth,
    target: testnetTokens.eth.network.callbackProxy,
  },
} as const;

export function ruleFeeFundingRoute(fee: RuleFee) {
  return `${appRoutes.account}?fund=${fee}`;
}
