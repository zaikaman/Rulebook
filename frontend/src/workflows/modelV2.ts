import {
  draftHasAction,
  draftHasCheck,
  workflowFieldSpecs,
  workflowV2Action as A,
  workflowV2Check as C,
  workflowV2RecipeFields,
  workflowV2Trigger as T,
  type V2Draft,
  type TriggerCode,
  type CheckCode,
  type ActionCode,
  type WorkflowFieldName,
  type WorkflowV2RecipeId,
} from '@rulebook/shared';

export {
  actionDecimals,
  actions,
  checkDecimals,
  checks,
  emptyDraft,
  emptyPath,
  toDraft,
  toProgram,
  triggers,
  v2DraftSchema,
} from '@rulebook/shared';
export type {
  ActionCode,
  CheckCode,
  DraftPath,
  DraftStep,
  TriggerCode,
  V2Draft,
} from '@rulebook/shared';

export type NodeTool =
  | { group: 'trigger'; code: TriggerCode }
  | { group: 'check'; code: CheckCode }
  | { group: 'action'; code: ActionCode };
export function unavailable(tool: NodeTool, draft: V2Draft) {
  const { code } = tool;
  if (tool.group === 'check') {
    if (
      [
        C.trailing,
        C.aboveReference,
        C.belowReference,
        C.priceRisesThrough,
        C.priceFallsThrough,
      ].some((check) => check === code) &&
      draft.trigger !== T.price
    )
      return 'Needs the pool price trigger.';
    if (code === C.dipBy && draft.trigger !== T.schedule) return 'Needs a schedule.';
    if (code === C.inactivity && draft.trigger !== T.schedule) return 'Needs a schedule.';
    if (code === C.paymentFrom && draft.trigger !== T.payment)
      return 'Needs the USDC payment trigger.';
    if (
      (code === C.amountAtLeast || code === C.amountAbove) &&
      ![T.payment, T.transfer].some((trigger) => trigger === draft.trigger)
    )
      return 'Needs a payment or transfer trigger.';
  }
  if (tool.group === 'action') {
    if (code === A.refill && !draftHasCheck(draft, C.usdcBelow)) {
      return 'Needs a Vault USDC is below check.';
    }
    if (code === A.inactivityPayout) {
      if (draft.trigger !== T.schedule) return 'Needs a schedule.';
      if (draftHasAction(draft, A.inactivityPayout)) {
        return 'Only one inactivity payout per workflow.';
      }
      if (!draftHasCheck(draft, C.inactivity)) {
        return 'Needs a Wallet was inactive for check.';
      }
    }
  }
  return undefined;
}

export const recipeFields: Record<WorkflowV2RecipeId, readonly WorkflowFieldName[]> =
  workflowV2RecipeFields;

export const recipeLabels: Record<string, string> = Object.fromEntries(
  Object.entries(workflowFieldSpecs).map(([name, spec]) => [name, spec.label]),
);
