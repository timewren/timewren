import { XCircle } from "lucide-react";

/** Kort med en fejl/afslutning på OAuth-siderne (samme kort som /auth/device). */
export function OAuthMessage({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 dark:bg-gray-900">
      <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-lg dark:bg-gray-800">
        <div className="text-center" role="alert">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
            <XCircle className="h-8 w-8 text-red-600 dark:text-red-400" />
          </div>
          <h1 className="mt-4 text-xl font-semibold text-gray-900 dark:text-white">
            {title}
          </h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            {text}
          </p>
        </div>
      </div>
    </div>
  );
}
