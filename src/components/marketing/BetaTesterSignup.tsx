"use client";

import { Check, Loader2, Smartphone } from "lucide-react";
import { usePlausible } from "next-plausible";
import { useState } from "react";
import { TRPCProvider, trpc } from "@/providers/trpc-provider";

type Platform = "ios" | "android" | "both";

const PLATFORMS: { value: Platform; label: string }[] = [
  { value: "ios", label: "iPhone" },
  { value: "android", label: "Android" },
  { value: "both", label: "Begge" },
];

/**
 * Tilmelding som betatester af mobilappen, før den er i App Store og
 * Google Play. Tilmeldingen sendes til admin, som inviterer via TestFlight
 * eller Play-testsporet.
 *
 * Medbringer sin egen tRPC-provider ligesom ToolLeadCapture, så
 * marketingsiderne ikke skal have den i layoutet.
 */
export function BetaTesterSignup() {
  return (
    <TRPCProvider>
      <BetaTesterForm />
    </TRPCProvider>
  );
}

function BetaTesterForm() {
  const plausible = usePlausible();
  const [email, setEmail] = useState("");
  // iOS er i App Store; testerne er nu primært til Android.
  const [platform, setPlatform] = useState<Platform>("android");
  const [website, setWebsite] = useState(""); // honeypot
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const signup = trpc.contact.betaTester.useMutation({
    onSuccess: () => {
      setDone(true);
      plausible("beta_tester_signup", { props: { platform } });
    },
    onError: (err) => {
      setError(err.message || "Noget gik galt. Prøv igen.");
    },
  });

  if (done) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-green-200 bg-green-50 p-5 text-green-900">
        <Check className="mt-0.5 h-5 w-5 shrink-0" />
        <p className="text-sm">
          Tak! Du hører fra os på mail med en invitation til at teste appen.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError("");
        signup.mutate({ email, platform, website: website || undefined });
      }}
      className="space-y-4"
    >
      <div className="absolute -left-[9999px]" aria-hidden="true">
        <label htmlFor="beta-website">Website</label>
        <input
          id="beta-website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-gray-700">
          Din telefon
        </legend>
        <div className="grid grid-cols-3 gap-2">
          {PLATFORMS.map((p) => (
            <label
              key={p.value}
              className={`flex cursor-pointer items-center justify-center rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                platform === p.value
                  ? "border-brand-600 bg-brand-50 text-brand-700"
                  : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              <input
                type="radio"
                name="beta-platform"
                value={p.value}
                checked={platform === p.value}
                onChange={() => setPlatform(p.value)}
                className="sr-only"
              />
              {p.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="beta-email" className="sr-only">
          Email
        </label>
        <input
          id="beta-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={email}
          onChange={(e) => setEmail(e.target.value.trim())}
          placeholder="din@email.dk"
          className="min-w-0 flex-1 rounded-lg border border-gray-300 px-4 py-3 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 sm:text-sm"
        />
        <button
          type="submit"
          disabled={signup.isPending}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
        >
          {signup.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Smartphone className="h-4 w-4" />
          )}
          Bliv betatester
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <p className="text-xs text-gray-500">
        Brug den email, der hører til din Apple- eller Google-konto, så kan jeg
        invitere dig direkte. Jeg bruger den kun til testinvitationen.
      </p>
    </form>
  );
}
