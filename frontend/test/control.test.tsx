import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { RuleActions } from '../src/components/RuleActions.js';
import { RuleOrderList } from '../src/components/RuleOrderList.js';

const noop = () => Promise.resolve();

describe('RuleActions', () => {
  it('updates the status pill within one render cycle when pause is pressed', async () => {
    const user = userEvent.setup();
    const never = new Promise<never>(() => {});
    render(
      <RuleActions
        ruleId={1n}
        status="active"
        onPause={() => never}
        onResume={noop}
        onCancel={noop}
      />,
    );

    expect(screen.getByText('Active')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Pause' }));

    expect(screen.getByText('Paused')).toBeInTheDocument();
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
  });

  it('restores the previous status and names the reason when pause reverts', async () => {
    const user = userEvent.setup();
    const onPause = vi.fn().mockRejectedValue(new Error('Only the owner can do this.'));
    render(
      <RuleActions ruleId={1n} status="active" onPause={onPause} onResume={noop} onCancel={noop} />,
    );

    await user.click(screen.getByRole('button', { name: 'Pause' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Only the owner can do this.');
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('asks for confirmation before cancelling a rule', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn().mockResolvedValue(undefined);
    render(
      <RuleActions
        ruleId={1n}
        status="active"
        onPause={noop}
        onResume={noop}
        onCancel={onCancel}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Cancel rule' }));
    expect(onCancel).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Confirm cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('RuleOrderList', () => {
  const labels = { '1': 'Price alert', '2': 'DCA', '3': 'Stop loss' };

  it('marks the first rule as the one checked first', () => {
    render(<RuleOrderList ids={[1n, 2n, 3n]} labels={labels} onReorder={noop} />);

    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveAttribute('data-testid', 'rule-order-1');
    expect(rows[0]).toHaveTextContent('Evaluated first');
  });

  it('rolls the visual order back and shows the error when the reorder reverts', async () => {
    const user = userEvent.setup();
    const onReorder = vi.fn().mockRejectedValue(new Error('InvalidTemplateParams'));
    render(<RuleOrderList ids={[1n, 2n, 3n]} labels={labels} onReorder={onReorder} />);

    await user.click(screen.getByRole('button', { name: 'Move rule DCA up' }));

    expect(onReorder).toHaveBeenCalledWith([2n, 1n, 3n]);
    expect(await screen.findByRole('alert')).toHaveTextContent('InvalidTemplateParams');

    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveAttribute('data-testid', 'rule-order-1');
    expect(rows[1]).toHaveAttribute('data-testid', 'rule-order-2');
  });

  it('persists a keyboard move without a drag gesture', async () => {
    const user = userEvent.setup();
    const onReorder = vi.fn().mockResolvedValue(undefined);
    render(<RuleOrderList ids={[1n, 2n, 3n]} labels={labels} onReorder={onReorder} />);

    await user.click(screen.getByRole('button', { name: 'Move rule Stop loss up' }));

    expect(onReorder).toHaveBeenCalledWith([1n, 3n, 2n]);
    const rows = screen.getAllByRole('listitem');
    expect(rows[1]).toHaveAttribute('data-testid', 'rule-order-3');
  });
});
