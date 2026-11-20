import { expect, it } from 'vitest';

import { starters } from '../src/workflows/model';
import {
  keepStepPositions,
  placeLibraryNode,
  placementProblem,
} from '../src/workflows/nodeLibraryModel';

const payment = starters.find((starter) => starter.id === 'payment')!.draft;

it('keeps the existing step’s coordinates when inserting before it', () => {
  const coordinates = { x: 160, y: 340 };
  const positions = { 'root-yes-step-1': coordinates };
  const target = { owner: 1, afterStep: 0 };

  const result = placeLibraryNode(payment, 'swap', target);
  expect(result.draft?.nodes[1]).toMatchObject({
    actions: [{ kind: 'send' }, { kind: 'swap' }, { kind: 'alert' }],
  });
  expect(keepStepPositions(positions, payment, 'swap', target)).toEqual({
    'root-yes-step-2': coordinates,
  });
});

it('checks the trigger and action constraints before changing the draft', () => {
  expect(placeLibraryNode(payment, 'price', { owner: 'trigger' })).toEqual({
    error: 'Change payment percentages to fixed amounts before switching triggers.',
  });
  expect(placeLibraryNode(payment, 'schedule', { owner: 'trigger' })).toEqual({
    error: 'Remove the conditions before switching to a schedule.',
  });

  const schedule = starters.find((starter) => starter.id === 'schedule')!.draft;
  expect(placementProblem(schedule, 'condition', { owner: 0 })).toBe(
    'Conditions need a payment or price trigger.',
  );
  expect(placementProblem(schedule, 'swap', { owner: 0 })).toBe(
    'A path can contain only one swap.',
  );
});
