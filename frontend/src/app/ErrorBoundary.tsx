import { Component, type ReactNode } from 'react';

import { ErrorState } from '../components/ErrorState.js';

interface Props {
  readonly children: ReactNode;
}

interface State {
  readonly error: Error | null;
}

/** Catches render failures and shows the message rather than a blank screen. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override render() {
    if (this.state.error) {
      return (
        <ErrorState
          message="Something went wrong while rendering this view."
          detail={this.state.error.message}
        />
      );
    }
    return this.props.children;
  }
}
