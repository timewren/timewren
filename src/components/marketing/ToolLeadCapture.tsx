"use client";

import { Check, Loader2, Mail } from "lucide-react";
import { usePlausible } from "next-plausible";
import { useState } from "react";
import { TRPCProvider, trpc } from "@/providers/trpc-provider";

const CONSENT_TEXT =
  "Send mig guiden på mail. Ingen nyhedsbreve uden jeg beder om det.";

/**
 * Email-capture under et gratis værktøj: "få guiden på mail".
 * Leadet gemmes i marketing_leads og guide-mailen sendes via Resend.
 * Værktøjerne var rene CTA'er uden capture — lead magnets uden lead-delen.
 *
 * Medbringer sin egen tRPC-provider: den ligger ikke længere i root-layoutet,
 * så marketingsiderne slipper for tRPC/React Query-bundtet.
 */
export function ToolLeadCapture({ tool }: { tool: string }) {
  return (
    <TRPCProvider>
      <ToolLeadCaptureForm tool={tool} />
    </TRPCProvider>
  );
}

function ToolLeadCaptureForm({ tool }: { tool: string }) {
  const plausible = usePlausible();
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const capture = trpc.marketing.captureLead.useMutation({
    onSuccess: () => {
      setDone(true);
      plausible("lead_captured", { props: { tool } });
    },
    onError: (err) => {
      setError(err.message || "Noget gik galt. Prøv igen.");
    },
  });

  if (done) {
    return (
      <div className="mx-auto mt-8 flex max-w-lg items-center gap-3 rounded-xl border border-green-200 bg-green-50 p-4 text-green-800">
        <Check className="h-5 w-5 shrink-0" />
        <p className="text-sm">
          Guiden er på vej til din indbakke. God fornøjelse!
        </p>
      </div>
    );
  }

  return (
    <form
      className="mx-auto mt-8 max-w-lg rounded-xl border border-slate-200/60 bg-slate-50 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        setError("");
        capture.mutate({ email, tool, consentText: CONSENT_TEXT, website });
      }}
    >
      <p className="flex items-center gap-2 font-semibold text-slate-900">
        <Mail className="h-4 w-4 text-brand-600" />
        Få guiden på mail
      </p>
      <p className="mt-1 text-sm text-slate-600">{CONSENT_TEXT}</p>
      <div className="mt-3 flex gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="din@email.dk"
          className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
        />
        <button
          type="submit"
          disabled={capture.isPending}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
        >
          {capture.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "Send"
          )}
        </button>
      </div>
      {/* Honeypot — skjult for mennesker, bots udfylder det */}
      <input
        type="text"
        name="website"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute left-[-9999px] h-0 w-0 opacity-0"
      />
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </form>
  );
}
