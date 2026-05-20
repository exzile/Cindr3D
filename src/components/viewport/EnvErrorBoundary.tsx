import { Component } from 'react';
import type { ReactNode } from 'react';

export class EnvErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * CrashBoundary — logs the actual error object to console.error so the real
 * message/stack is visible (R3F's CanvasImpl boundary uses console.warn %s %s
 * which only shows a format string in some dev-tool views). Renders null on
 * failure so the rest of the viewport keeps working. Resets when `resetKey`
 * changes (e.g. when activeDialog changes) so the tool can be retried.
 */
export class CrashBoundary extends Component<
  { children: ReactNode; label?: string; resetKey?: unknown },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string }) {
    console.error(`[CrashBoundary${this.props.label ? ` ${this.props.label}` : ''}] render error:`, error);
    if (info?.componentStack) {
      console.error('[CrashBoundary] component stack:', info.componentStack);
    }
  }

  componentDidUpdate(prev: { resetKey?: unknown }) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
