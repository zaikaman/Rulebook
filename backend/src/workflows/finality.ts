import { isAutomationChain } from '@rulebook/shared';

export function workflowConfirmationDepth(chain: number) {
  return isAutomationChain(chain) ? 20n : 12n;
}
