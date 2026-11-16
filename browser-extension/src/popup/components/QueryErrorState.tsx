import { useT } from "../../i18n";
import { userErrorMessage } from "../../lib/api-error";

interface QueryErrorStateProps {
  error: unknown;
  fallback: string;
  onRetry: () => void;
  className?: string;
}

/** En fejlet hentning skal ligne en fejl — ikke en tom liste eller 0 t. */
export function QueryErrorState({
  error,
  fallback,
  onRetry,
  className = "",
}: QueryErrorStateProps) {
  const { t } = useT();
  return (
    <div
      className={`flex flex-col items-center justify-center text-center ${className}`}
      role="alert"
    >
      <p className="text-sm text-red-700">
        {userErrorMessage(error, fallback)}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 text-sm font-medium text-primary-600 hover:underline"
      >
        {t("popup.queryError.retry")}
      </button>
    </div>
  );
}
