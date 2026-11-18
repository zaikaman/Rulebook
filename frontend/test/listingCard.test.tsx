import type { Listing } from '@rulebook/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ListingCard } from '../src/components/ListingCard.js';

const AGENT = '0x5eed000000000000000000000000000000000001' as const;
const AUTHOR = '0x7ea0000000000000000000000000000000000001' as const;

function listing(overrides: Partial<Listing> = {}): Listing {
  return {
    listing_id: 1n,
    agent: AGENT,
    rule_id: 1n,
    template: 1,
    author: AUTHOR,
    author_badge: 'team',
    name: 'Weekly USDC → WETH DCA',
    description: 'A plain weekly DCA into WETH, executed by the user’s own vault.',
    params_hash: `0x${'ab'.repeat(32)}`,
    runs: 1420,
    success_rate: 0.998,
    cloned_count: 0,
    ...overrides,
  };
}

describe('ListingCard', () => {
  it('shows the run count and success rate exactly as the API returned them', () => {
    render(<ListingCard listing={listing()} />);

    expect(screen.getByText('1420 runs')).toBeInTheDocument();
    expect(screen.getByText('99.8%')).toBeInTheDocument();
  });

  it('never recomputes statistics from another field on the card', () => {
    render(<ListingCard listing={listing({ runs: 7, success_rate: 0.25 })} />);

    expect(screen.getByText('7 runs')).toBeInTheDocument();
    expect(screen.getByText('25.0%')).toBeInTheDocument();
  });

  it('marks a team-authored rule with a visible team badge', () => {
    render(<ListingCard listing={listing()} />);

    expect(screen.getByLabelText('Team badge')).toHaveTextContent('Team');
  });

  it('does not claim a team badge for a community-authored rule', () => {
    render(<ListingCard listing={listing({ author_badge: 'community' })} />);

    expect(screen.queryByLabelText('Team badge')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Community badge')).toHaveTextContent('Community');
  });

  it('renders the author and the template name', () => {
    render(<ListingCard listing={listing()} />);

    expect(screen.getByText('0x7ea0…0001')).toBeInTheDocument();
    expect(screen.getByText('Weekly USDC → WETH DCA')).toBeInTheDocument();
    expect(screen.getByText('DCA')).toBeInTheDocument();
  });
});
