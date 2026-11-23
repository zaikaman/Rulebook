export const workflowRootKey = 'root';

export type LibraryTarget = { owner: 'trigger' | number; afterStep?: number };

export function branchPathKey(path: string, branch: 'yes' | 'otherwise') {
  return `${path}-${branch}`;
}

export function stepPathKey(path: string, index: number) {
  return index === 0 ? path : `${path}-step-${index}`;
}
