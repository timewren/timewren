"use client";

import { MessageSquare, ThumbsDown, ThumbsUp } from "lucide-react";
import { trpc } from "@/providers/trpc-provider";

function parseQuestionKey(key: string) {
  const [topicId, ...rest] = key.split("::");
  return { topicId: topicId || key, question: rest.join("::") || key };
}

export default function HelpFeedbackAdminPage() {
  const { data: summary, isLoading } = trpc.helpFeedback.summary.useQuery();

  const entries = summary
    ? Object.entries(summary)
        .map(([key, stats]) => ({
          key,
          ...parseQuestionKey(key),
          ...stats,
          score: stats.up - stats.down,
          ratio:
            stats.total > 0 ? Math.round((stats.up / stats.total) * 100) : 0,
        }))
        .sort((a, b) => a.score - b.score)
    : [];

  const totalFeedback = entries.reduce((sum, e) => sum + e.total, 0);
  const avgRatio =
    entries.length > 0
      ? Math.round(
          entries.reduce((sum, e) => sum + e.ratio, 0) / entries.length,
        )
      : 0;
  const needsImprovement = entries.filter((e) => e.ratio < 50);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Hjælp-feedback</h1>
        <p className="mt-1 text-sm text-gray-500">
          Se hvad brugerne synes om hjælp-artiklerne
        </p>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-gray-500">
          Indlæser feedback…
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center">
          <MessageSquare className="mx-auto mb-3 h-10 w-10 text-gray-400" />
          <p className="text-sm text-gray-500">
            Ingen feedback endnu. Brugere kan give thumbs up/down på
            hjælp-artiklerne.
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-sm text-gray-500">Total feedback</p>
              <p className="mt-1 text-2xl font-semibold text-gray-900">
                {totalFeedback}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-sm text-gray-500">Gennemsnitlig tilfredshed</p>
              <p className="mt-1 text-2xl font-semibold text-gray-900">
                {avgRatio}%
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-sm text-gray-500">Skal forbedres</p>
              <p className="mt-1 text-2xl font-semibold text-red-600">
                {needsImprovement.length}
              </p>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Spørgsmål
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Emne
                  </th>
                  <th className="w-20 px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500">
                    <ThumbsUp className="mx-auto h-4 w-4" />
                  </th>
                  <th className="w-20 px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500">
                    <ThumbsDown className="mx-auto h-4 w-4" />
                  </th>
                  <th className="w-24 px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500">
                    Score
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {entries.map((entry) => (
                  <tr
                    key={entry.key}
                    className={entry.ratio < 50 ? "bg-red-50/50" : undefined}
                  >
                    <td className="px-4 py-3 text-gray-900">
                      {entry.question}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                        {entry.topicId}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center font-medium text-green-600">
                      {entry.up}
                    </td>
                    <td className="px-4 py-3 text-center font-medium text-red-600">
                      {entry.down}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          entry.ratio >= 75
                            ? "bg-green-100 text-green-800"
                            : entry.ratio >= 50
                              ? "bg-yellow-100 text-yellow-800"
                              : "bg-red-100 text-red-800"
                        }`}
                      >
                        {entry.ratio}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
