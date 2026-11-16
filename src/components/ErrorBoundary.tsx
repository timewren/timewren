"use client";

import { AlertTriangle, Home, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

function ErrorFallback({ error }: { error?: Error }) {
  const t = useTranslations("shell.errorBoundary");
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-8 shadow-lg">
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
            <AlertTriangle className="h-8 w-8 text-red-600" />
          </div>

          <h1 className="mb-2 text-2xl font-bold text-gray-900">
            {t("title")}
          </h1>

          <p className="mb-6 text-gray-600">{t("body")}</p>

          {process.env.NODE_ENV === "development" && error && (
            <div className="mb-6 w-full rounded-lg bg-gray-100 p-4 text-left">
              <p className="mb-2 text-sm font-semibold text-gray-900">
                {t("devDetails")}
              </p>
              <pre className="overflow-x-auto text-xs text-red-600">
                {error.message}
              </pre>
              {error.stack && (
                <pre className="mt-2 overflow-x-auto text-xs text-gray-600">
                  {error.stack.split("\n").slice(0, 5).join("\n")}
                </pre>
              )}
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white transition-colors hover:bg-brand-700"
            >
              <RefreshCw className="h-4 w-4" />
              {t("reload")}
            </button>

            <a
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              <Home className="h-4 w-4" />
              {t("home")}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return <ErrorFallback error={this.state.error} />;
    }

    return this.props.children;
  }
}
