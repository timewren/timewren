import * as Sentry from "@sentry/react";
import i18n from "i18next";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./Button";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Top-level error boundary that catches unhandled React errors
 * and shows a user-friendly fallback UI instead of a blank screen.
 *
 * Forklaringen var engelsk hvis sprogstillingen var `en` og **dansk ellers**,
 * så svenske, norske og tyske brugere læste dansk i det øjeblik appen var gået
 * ned. Overskriften, knapperne og resten af skærmen kommer fra `errors.*` i alle
 * fem sprog, så hele skærmen er oversat på én måde.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, info);
    Sentry.captureException(error, {
      extra: { componentStack: info.componentStack },
    });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen flex-col items-center justify-center bg-(--color-bg) px-6 text-center">
          <AlertTriangle size={48} className="mb-4 text-amber-400" />
          <h1 className="text-lg font-semibold text-(--color-text)">
            {i18n.t("errors.generic")}
          </h1>
          <p className="mt-2 max-w-md text-sm text-(--color-text-muted)">
            {i18n.t("errors.unexpected")}
          </p>

          {this.state.error && (
            <pre className="mt-4 max-w-lg overflow-auto rounded-lg border border-(--color-border) bg-(--color-surface) p-3 text-left text-xs text-red-400">
              {this.state.error.message}
            </pre>
          )}

          <div className="mt-6 flex items-center gap-3">
            <Button variant="secondary" size="sm" onClick={this.handleReset}>
              {i18n.t("errors.tryAgain")}
            </Button>
            <Button size="sm" onClick={this.handleReload}>
              <RefreshCw size={14} />
              {i18n.t("errors.reloadApp")}
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
