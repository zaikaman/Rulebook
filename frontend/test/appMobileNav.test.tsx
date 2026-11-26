import {
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  UNICHAIN_MAINNET_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
} from '@rulebook/shared';
import { fireEvent, render, screen } from '@testing-library/react';
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

vi.mock('../src/assistant/AssistantContext.js', () => ({
  useAssistant: () => ({
    isOpen: false,
    open: vi.fn(),
    close: vi.fn(),
  }),
}));

vi.mock('../src/components/chrome/WalletControl.js', () => ({
  WalletControl: () => <button type="button">Connect wallet</button>,
}));

import { AppMobileNav } from '../src/components/chrome/AppMobileNav.js';
import { buildNetworkModeState } from '../src/lib/networkMode.js';

function renderMobileNav() {
  return render(
    <MemoryRouter initialEntries={['/workflows']}>
      <AppMobileNav />
    </MemoryRouter>,
  );
}

describe('AppMobileNav', () => {
  beforeEach(() => {
    mockUseNetworkMode.mockReset();
  });

  it('renders Testnet badge, automation network, and switcher state when Testnet is active', () => {
    mockUseNetworkMode.mockReturnValue({
      ...buildNetworkModeState('testnet'),
      configuredFundsChains: [UNICHAIN_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID],
      isDeploymentConfigured: true,
      setMode: vi.fn(),
    });

    const { container } = renderMobileNav();

    const modeBadge = screen.getByTestId('mobile-network-mode');
    expect(modeBadge).toHaveTextContent('Testnet');
    expect(modeBadge).toHaveClass('rb-chip--plain');
    expect(modeBadge).not.toHaveAttribute('data-tone');

    const automation = screen.getByTestId('mobile-automation-network');
    expect(automation).toHaveTextContent('Reactive Lasna');
    expect(automation.querySelector('.app-live-dot')).not.toBeNull();

    expect(screen.getByTestId('mobile-network-mode-testnet')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByTestId('mobile-network-mode-mainnet')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(container.querySelector('.app-mobile')).toHaveAttribute('data-network-mode', 'testnet');
    expect(screen.getByTestId('mobile-network-bar')).toHaveAttribute(
      'data-network-mode',
      'testnet',
    );
  });

  it('calls setMode when switching between Testnet and Mainnet', () => {
    const setMode = vi.fn();
    mockUseNetworkMode.mockReturnValue({
      ...buildNetworkModeState('testnet'),
      configuredFundsChains: [UNICHAIN_SEPOLIA_CHAIN_ID],
      isDeploymentConfigured: true,
      setMode,
    });

    renderMobileNav();

    fireEvent.click(screen.getByTestId('mobile-network-mode-mainnet'));
    expect(setMode).toHaveBeenNthCalledWith(1, 'mainnet');

    fireEvent.click(screen.getByTestId('mobile-network-mode-testnet'));
    expect(setMode).toHaveBeenNthCalledWith(2, 'testnet');
  });

  it('renders Mainnet real-funds indicator and Reactive Mainnet when Mainnet is active', () => {
    mockUseNetworkMode.mockReturnValue({
      ...buildNetworkModeState('mainnet'),
      configuredFundsChains: [UNICHAIN_MAINNET_CHAIN_ID, BASE_MAINNET_CHAIN_ID],
      isDeploymentConfigured: true,
      setMode: vi.fn(),
    });

    const { container } = renderMobileNav();

    const modeBadge = screen.getByTestId('mobile-network-mode');
    expect(modeBadge).toHaveTextContent('Mainnet · Real funds');
    expect(modeBadge).toHaveAttribute('data-tone', 'paused');
    expect(modeBadge).not.toHaveClass('rb-chip--plain');

    const automation = screen.getByTestId('mobile-automation-network');
    expect(automation).toHaveTextContent('Reactive Mainnet');
    expect(automation.querySelector('.app-live-dot')).not.toBeNull();

    expect(screen.getByTestId('mobile-network-mode-mainnet')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByTestId('mobile-network-mode-testnet')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(container.querySelector('.app-mobile')).toHaveAttribute('data-network-mode', 'mainnet');
    expect(screen.getByTestId('mobile-network-bar')).toHaveAttribute(
      'data-network-mode',
      'mainnet',
    );
  });

  it('omits the live dot when Mainnet deployment is unconfigured while keeping the warning badge', () => {
    mockUseNetworkMode.mockReturnValue({
      ...buildNetworkModeState('mainnet'),
      configuredFundsChains: [UNICHAIN_MAINNET_CHAIN_ID],
      isDeploymentConfigured: false,
      setMode: vi.fn(),
    });

    renderMobileNav();

    const modeBadge = screen.getByTestId('mobile-network-mode');
    expect(modeBadge).toHaveTextContent('Mainnet · Real funds');
    expect(modeBadge).toHaveAttribute('data-tone', 'paused');

    const automation = screen.getByTestId('mobile-automation-network');
    expect(automation).toHaveTextContent('Reactive Mainnet');
    expect(automation.querySelector('.app-live-dot')).toBeNull();
  });
});
