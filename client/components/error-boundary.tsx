import { Component, type ReactNode } from 'react';
import { ApiError, NetworkError } from '../lib/api-error.js';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  debugBlock: string | null;
  consecutiveErrors: number;
  resetKey: number;
  debugExpanded: boolean;
}

/**
 * Maximum consecutive errors before disabling "Try again".
 */
const MAX_CONSECUTIVE_ERRORS = 3;

/**
 * React error boundary that catches render/lifecycle errors.
 *
 * Features:
 * - Friendly error message with expandable debug block
 * - "Try again" button (re-renders via key reset, not page reload)
 * - After 3 consecutive errors, disables "Try again" and shows only "Reload"
 * - Posts errors to /api/log-client-error (fire-and-forget)
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      debugBlock: null,
      consecutiveErrors: 0,
      resetKey: 0,
      debugExpanded: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
      debugBlock: ErrorBoundary.extractDebugBlock(error),
    };
  }

  /**
   * Extract or generate a debug block from an error.
   */
  private static extractDebugBlock(error: Error): string {
    if (error instanceof ApiError) {
      return error.debugBlock;
    }
    if (error instanceof NetworkError) {
      return error.toDebugBlock();
    }
    // Generic Error - generate a debug block
    return `--- DEBUG BLOCK ---\n${JSON.stringify({
      ts: new Date().toISOString(),
      error: error.name,
      message: error.message,
      stack: error.stack,
    }, null, 2)}\n--- END DEBUG BLOCK ---`;
  }

  componentDidCatch(error: Error): void {
    // Increment consecutive error count
    this.setState((prev) => ({
      consecutiveErrors: prev.consecutiveErrors + 1,
    }));

    // Post error to server (fire-and-forget using raw fetch)
    const debugBlock = ErrorBoundary.extractDebugBlock(error);
    fetch('/api/log-client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        debugBlock,
        url: window.location.href,
        userAgent: navigator.userAgent,
      }),
    }).catch((err) => {
      console.error('Failed to log error to server:', err);
    });
  }

  componentDidUpdate(_prevProps: ErrorBoundaryProps, prevState: ErrorBoundaryState): void {
    // Reset consecutive error count on successful render
    // (i.e., we were in error state but now we're not)
    if (prevState.hasError && !this.state.hasError) {
      this.setState({ consecutiveErrors: 0 });
    }
  }

  private handleTryAgain = (): void => {
    this.setState((prev) => ({
      hasError: false,
      error: null,
      debugBlock: null,
      resetKey: prev.resetKey + 1,
      debugExpanded: false,
    }));
  };

  private handleReload = (): void => {
    window.location.reload();
  };

  private toggleDebug = (): void => {
    this.setState((prev) => ({
      debugExpanded: !prev.debugExpanded,
    }));
  };

  private handleCopy = async (): Promise<void> => {
    if (!this.state.debugBlock) return;

    try {
      await navigator.clipboard.writeText(this.state.debugBlock);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  render(): ReactNode {
    const { children } = this.props;
    const { hasError, error, debugBlock, consecutiveErrors, resetKey, debugExpanded } = this.state;

    if (hasError) {
      const canTryAgain = consecutiveErrors < MAX_CONSECUTIVE_ERRORS;

      return (
        <div style={{ padding: '20px', fontFamily: 'system-ui, sans-serif' }}>
          <h1 style={{ color: '#c00', margin: '0 0 10px' }}>Something went wrong</h1>
          <p style={{ margin: '0 0 20px', color: '#666' }}>
            {error?.message || 'An unexpected error occurred'}
          </p>

          <div style={{ marginBottom: '20px' }}>
            {canTryAgain ? (
              <button
                onClick={this.handleTryAgain}
                style={{
                  padding: '8px 16px',
                  marginRight: '10px',
                  cursor: 'pointer',
                }}
              >
                Try again
              </button>
            ) : (
              <p style={{ color: '#c00', marginBottom: '10px' }}>
                Multiple errors detected. Please reload the page.
              </p>
            )}
            <button
              onClick={this.handleReload}
              style={{ padding: '8px 16px', cursor: 'pointer' }}
            >
              Reload page
            </button>
          </div>

          {debugBlock && (
            <div>
              <button
                onClick={this.toggleDebug}
                style={{
                  padding: '4px 8px',
                  marginBottom: '10px',
                  cursor: 'pointer',
                  fontSize: '12px',
                }}
              >
                {debugExpanded ? 'Hide' : 'Show'} debug info
              </button>

              {debugExpanded && (
                <div>
                  <button
                    onClick={this.handleCopy}
                    style={{
                      padding: '4px 8px',
                      marginBottom: '10px',
                      marginLeft: '10px',
                      cursor: 'pointer',
                      fontSize: '12px',
                    }}
                  >
                    Copy
                  </button>
                  <pre
                    style={{
                      background: '#f5f5f5',
                      padding: '10px',
                      overflow: 'auto',
                      fontSize: '12px',
                      fontFamily: 'monospace',
                      border: '1px solid #ddd',
                      userSelect: 'text',
                    }}
                  >
                    {debugBlock}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      );
    }

    // Key reset triggers remount of children
    return <div key={resetKey}>{children}</div>;
  }
}
