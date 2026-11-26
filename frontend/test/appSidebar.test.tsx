import {
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  UNICHAIN_MAINNET_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
} from '@rulebook/shared';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUseNetworkMode = vi.fn();

vi.mock('../src/lib/networkMode.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/networkMode.js')>();
  return {
    ...actual,
    useNetworkMode: () => mockUseNetworkMode(),
  };
});

import { AppSidebar } from '../src/components/chrome/AppSidebar.js';
import { buildNetworkModeState } from '../src/lib/networkMode.js';

function renderSidebar() {
  return render(
    <MemoryRouter initialEntries={['/workflows']}>
      <AppSidebar />
    </MemoryRouter>,
  );
}

describe('AppSidebar', () => {
  beforeEach(() => {
    mockUseNetworkMode.mockReset();
  });

  it('renders Testnet environment, Reactive Lasna, and both testnet funds chains when configured', () => {
    mockUseNetworkMode.mockReturnValue({
      ...buildNetworkModeState('testnet'),
      configuredFundsChains: [UNICHAIN_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID],
      isDeploymentConfigured: true,
      setMode: vi.fn(),
    });

    const { container } = renderSidebar();

    const modeBadge = screen.getByTestId('sidebar-network-mode');
    expect(modeBadge).toHaveTextContent('Testnet');
    expect(modeBadge).toHaveClass('rb-chip--plain');
    expect(modeBadge).not.toHaveAttribute('data-tone');

    const automation = screen.getByTestId('sidebar-automation-network');
    expect(automation).toHaveTextContent('Reactive Lasna');
    expect(automation.querySelector('.app-live-dot')).not.toBeNull();

    expect(screen.getByTestId('sidebar-funds-summary')).toHaveTextContent(
      'Watches for triggers. Unichain Sepolia and Base Sepolia settle from your vaults.',
    );
    expect(container.querySelector('aside.app-rail')).toHaveAttribute(
      'data-network-mode',
      'testnet',
    );
    for (const link of Array.from(container.querySelectorAll('a'))) {
      expect(link.getAttribute('href')).not.toContain('network=');
    }
  });

  it('renders singular vault wording when Testnet has only Unichain Sepolia configured', () => {
    mockUseNetworkMode.mockReturnValue({
      ...buildNetworkModeState('testnet'),
      configuredFundsChains: [UNICHAIN_SEPOLIA_CHAIN_ID],
      isDeploymentConfigured: true,
      setMode: vi.fn(),
    });

    renderSidebar();

    const summary = screen.getByTestId('sidebar-funds-summary');
    expect(summary).toHaveTextContent(
      'Watches for triggers. Unichain Sepolia settles from your vault.',
    );
    expect(summary.textContent).not.toContain('Base Sepolia');
  });

  it('renders Mainnet environment, Reactive Mainnet, and both mainnet funds chains when configured', () => {
    mockUseNetworkMode.mockReturnValue({
      ...buildNetworkModeState('mainnet'),
      configuredFundsChains: [UNICHAIN_MAINNET_CHAIN_ID, BASE_MAINNET_CHAIN_ID],
      isDeploymentConfigured: true,
      setMode: vi.fn(),
    });

    const { container } = renderSidebar();

    const modeBadge = screen.getByTestId('sidebar-network-mode');
    expect(modeBadge).toHaveTextContent('Mainnet');
    expect(modeBadge).toHaveAttribute('data-tone', 'paused');
    expect(modeBadge).not.toHaveClass('rb-chip--plain');

    const automation = screen.getByTestId('sidebar-automation-network');
    expect(automation).toHaveTextContent('Reactive Mainnet');
    expect(automation.querySelector('.app-live-dot')).not.toBeNull();

    expect(screen.getByTestId('sidebar-funds-summary')).toHaveTextContent(
      'Watches for triggers. Unichain and Base settle from your vaults.',
    );

    const rail = container.querySelector('aside.app-rail');
    expect(rail).toHaveAttribute('data-network-mode', 'mainnet');
    expect(rail?.textContent).not.toContain('Testnet');
    expect(rail?.textContent).not.toContain('Reactive Lasna');
    expect(rail?.textContent).not.toContain('Unichain Sepolia');
    expect(rail?.textContent).not.toContain('Base Sepolia');

    const links = Array.from(container.querySelectorAll('a'));
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.getAttribute('href')).toContain('?network=mainnet');
    }
  });

  it('renders singular vault wording when Mainnet has only Unichain configured', () => {
    mockUseNetworkMode.mockReturnValue({
      ...buildNetworkModeState('mainnet'),
      configuredFundsChains: [UNICHAIN_MAINNET_CHAIN_ID],
      isDeploymentConfigured: true,
      setMode: vi.fn(),
    });

    const { container } = renderSidebar();

    const summary = screen.getByTestId('sidebar-funds-summary');
    expect(summary).toHaveTextContent('Watches for triggers. Unichain settles from your vault.');
    expect(summary.textContent).not.toContain('Base');
    expect(container.querySelector('aside.app-rail')?.textContent).not.toContain('Testnet');
    expect(container.querySelector('aside.app-rail')?.textContent).not.toContain('Sepolia');
  });

  it('omits the live dot and reports undeployed Mainnet status when deployment is unconfigured', () => {
    mockUseNetworkMode.mockReturnValue({
      ...buildNetworkModeState('mainnet'),
      configuredFundsChains: [UNICHAIN_MAINNET_CHAIN_ID],
      isDeploymentConfigured: false,
      setMode: vi.fn(),
    });

    const { container } = renderSidebar();

    const modeBadge = screen.getByTestId('sidebar-network-mode');
    expect(modeBadge).toHaveTextContent('Mainnet');
    expect(modeBadge).toHaveAttribute('data-tone', 'paused');

    const automation = screen.getByTestId('sidebar-automation-network');
    expect(automation).toHaveTextContent('Reactive Mainnet');
    expect(automation.querySelector('.app-live-dot')).toBeNull();

    expect(screen.getByTestId('sidebar-funds-summary')).toHaveTextContent(
      'Contracts are not deployed in this environment yet. Settlement targets Unichain.',
    );

    const rail = container.querySelector('aside.app-rail');
    expect(rail?.textContent).not.toContain('Testnet');
    expect(rail?.textContent).not.toContain('Reactive Lasna');
    expect(rail?.textContent).not.toContain('Unichain Sepolia');
    expect(rail?.textContent).not.toContain('Base Sepolia');
  });
});
