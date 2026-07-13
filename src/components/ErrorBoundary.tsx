import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Chess Studio render failure', error, info.componentStack);
  }

  private reload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="fatal-error" role="alert">
        <div className="fatal-error-card">
          <p className="eyebrow">Application recovery</p>
          <h1>Chess Studio hit an unexpected error</h1>
          <p>Your saved games are still on this device. Reload the app to recover.</p>
          <pre>{this.state.error.message}</pre>
          <button className="primary-button" onClick={this.reload}>Reload Chess Studio</button>
        </div>
      </main>
    );
  }
}
