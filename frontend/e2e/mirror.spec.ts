import { expect, test } from '@playwright/test';

const REACTIVE_HASH = `0x${'a'.repeat(64)}`;
const LEADER_HASH = `0x${'b'.repeat(64)}`;
const FOLLOWER_HASH = `0x${'c'.repeat(64)}`;

test('shows the leader and follower destination transactions on one proof', async ({ page }) => {
  await page.route('**/v1/proofs/**', async (route) => {
    expect(new URL(route.request().url()).searchParams.get('include')).toBe('mirrors');
    await route.fulfill({
      json: {
        reactive_tx: REACTIVE_HASH,
        source: 'chain',
        rows: [
          {
            role: 'automation',
            chain_id: 5_318_007,
            tx_hash: REACTIVE_HASH,
            explorer_url: `https://reactscan.net/tx/${REACTIVE_HASH}`,
          },
          {
            role: 'destination',
            execution_role: 'leader',
            chain_id: 1301,
            tx_hash: LEADER_HASH,
            explorer_url: `https://sepolia.uniscan.xyz/tx/${LEADER_HASH}`,
          },
          {
            role: 'destination',
            execution_role: 'follower',
            chain_id: 1301,
            tx_hash: FOLLOWER_HASH,
            explorer_url: `https://sepolia.uniscan.xyz/tx/${FOLLOWER_HASH}`,
          },
        ],
      },
    });
  });
  await page.goto(`/proof/${REACTIVE_HASH}`);

  const destinations = page.locator('[data-role="destination"]');
  await expect(destinations).toHaveCount(2);
  await expect(destinations.filter({ hasText: 'Leader trade' }).getByRole('link')).toHaveAttribute(
    'href',
    `https://sepolia.uniscan.xyz/tx/${LEADER_HASH}`,
  );
  await expect(
    destinations.filter({ hasText: 'Follower trade' }).getByRole('link'),
  ).toHaveAttribute('href', `https://sepolia.uniscan.xyz/tx/${FOLLOWER_HASH}`);
});
