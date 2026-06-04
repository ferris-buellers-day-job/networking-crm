// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ErrorBoundary } from './error-boundary.js';

// Suppress React error boundary console errors during tests
const originalConsoleError = console.error;
beforeEach(() => {
  console.error = vi.fn();
});
afterEach(() => {
  console.error = originalConsoleError;
});

// Component that throws on render
function ThrowingChild({ shouldThrow = true }: { shouldThrow?: boolean }) {
  if (shouldThrow) {
    throw new Error('Test error from child');
  }
  return <div>Child rendered successfully</div>;
}

// Controllable throwing component - always throws
function AlwaysThrows(): never {
  throw new Error('Persistent error');
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    // Mock fetch for error logging
    global.fetch = vi.fn().mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('error catching', () => {
    it('renders children when no error', () => {
      render(
        <ErrorBoundary>
          <div>Normal content</div>
        </ErrorBoundary>
      );

      expect(screen.getByText('Normal content')).toBeInTheDocument();
    });

    it('shows error UI when child throws', () => {
      render(
        <ErrorBoundary>
          <ThrowingChild />
        </ErrorBoundary>
      );

      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      expect(screen.getByText('Test error from child')).toBeInTheDocument();
    });

    it('shows Try again button', () => {
      render(
        <ErrorBoundary>
          <ThrowingChild />
        </ErrorBoundary>
      );

      expect(screen.getByText('Try again')).toBeInTheDocument();
    });

    it('shows Reload page button', () => {
      render(
        <ErrorBoundary>
          <ThrowingChild />
        </ErrorBoundary>
      );

      expect(screen.getByText('Reload page')).toBeInTheDocument();
    });
  });

  describe('debug block', () => {
    it('has Show debug info button', () => {
      render(
        <ErrorBoundary>
          <ThrowingChild />
        </ErrorBoundary>
      );

      expect(screen.getByText('Show debug info')).toBeInTheDocument();
    });

    it('expands debug block when clicked', () => {
      render(
        <ErrorBoundary>
          <ThrowingChild />
        </ErrorBoundary>
      );

      fireEvent.click(screen.getByText('Show debug info'));

      expect(screen.getByText('Hide debug info')).toBeInTheDocument();
      expect(screen.getByText(/DEBUG BLOCK/)).toBeInTheDocument();
    });
  });

  describe('Try again behavior', () => {
    it('re-renders children on Try again click', () => {
      // First render will throw, second won't
      let shouldThrow = true;
      function ConditionalThrower() {
        if (shouldThrow) {
          throw new Error('Initial error');
        }
        return <div>Recovered successfully</div>;
      }

      render(
        <ErrorBoundary>
          <ConditionalThrower />
        </ErrorBoundary>
      );

      expect(screen.getByText('Something went wrong')).toBeInTheDocument();

      // Fix the condition before clicking Try again
      shouldThrow = false;
      fireEvent.click(screen.getByText('Try again'));

      expect(screen.getByText('Recovered successfully')).toBeInTheDocument();
    });
  });

  describe('3-strike disable logic', () => {
    it('disables Try again after 3 consecutive errors', async () => {
      render(
        <ErrorBoundary>
          <AlwaysThrows />
        </ErrorBoundary>
      );

      // First error - Try again should be available
      await waitFor(() => {
        expect(screen.getByText('Try again')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Try again'));

      // Second error - Try again should still be available
      await waitFor(() => {
        expect(screen.getByText('Try again')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Try again'));

      // Third error - Try again should be gone, only Reload remains
      await waitFor(() => {
        expect(screen.queryByText('Try again')).not.toBeInTheDocument();
      });
      expect(screen.getByText(/Multiple errors detected/)).toBeInTheDocument();
      expect(screen.getByText('Reload page')).toBeInTheDocument();
    });

    it('fresh ErrorBoundary instance starts with fresh count', async () => {
      const { unmount } = render(
        <ErrorBoundary>
          <AlwaysThrows />
        </ErrorBoundary>
      );

      // Use up 2 tries
      await waitFor(() => {
        expect(screen.getByText('Try again')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Try again'));

      await waitFor(() => {
        expect(screen.getByText('Try again')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Try again'));

      // Unmount and remount (simulates fresh instance)
      unmount();

      render(
        <ErrorBoundary>
          <AlwaysThrows />
        </ErrorBoundary>
      );

      // Fresh instance should have Try again available (fresh count)
      await waitFor(() => {
        expect(screen.getByText('Try again')).toBeInTheDocument();
      });
    });
  });

  describe('error logging', () => {
    it('posts error to /api/log-client-error', async () => {
      render(
        <ErrorBoundary>
          <ThrowingChild />
        </ErrorBoundary>
      );

      // Wait for the fire-and-forget fetch to complete
      await vi.waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/log-client-error',
          expect.objectContaining({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          })
        );
      });

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.debugBlock).toContain('DEBUG BLOCK');
      expect(body.url).toBeDefined();
      expect(body.userAgent).toBeDefined();
    });
  });
});
