import { Component, type ReactNode } from 'react';
import { AlertCircle, RotateCcw } from './icons.ts';
import { EmptyState } from './EmptyState.tsx';

interface Props {
  children: ReactNode;
  fallback?: (err: Error, reset: () => void) => ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error('[error-boundary]', error);
  }

  reset = () => this.setState({ error: null });

  override render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error, this.reset);
      return (
        <EmptyState
          icon={AlertCircle}
          title="Something went wrong"
          description={<code className="empty-state-detail">{this.state.error.message}</code>}
          action={
            <button className="btn primary" onClick={this.reset}>
              <RotateCcw size={14} aria-hidden="true" />
              Try again
            </button>
          }
          tone="error"
        />
      );
    }
    return this.props.children;
  }
}
