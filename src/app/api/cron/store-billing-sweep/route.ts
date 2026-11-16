import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import { getGooglePlayClient } from "@/lib/store-billing/google";
import {
  isStoreBillingEnabled,
  sweepStoreSubscriptions,
} from "@/lib/store-billing/service";
import { captureRouteError } from "@/lib/utils/sentry";

// Cron schedule: 15 5 * * * (dagligt)
//
// Sikkerhedsnet for køb i appen: butiksrækker hvis periode er overskredet
// uden en notifikation om fornyelse eller udløb. Google-rækker hentes frisk
// hos Google; Apple-rækker alarmeres til Sentry (kun række-id'er), da de
// kræver App Store Server API. Mørk indtil STORE_BILLING_ENABLED=1.
export const GET = withCronLogging("store-billing-sweep", async () => {
  if (!isStoreBillingEnabled()) {
    return { itemsProcessed: 0, metadata: { disabled: true } };
  }
  const result = await sweepStoreSubscriptions(db, getGooglePlayClient());
  if (result.appleOverdueIds.length > 0) {
    captureRouteError(
      new Error(
        `${result.appleOverdueIds.length} App Store-abonnement(er) er over perioden uden notifikation`,
      ),
      {
        route: "/api/cron/store-billing-sweep",
        type: "cron",
        extra: { subscriptionIds: result.appleOverdueIds },
      },
    );
  }
  // Et plan-skift, hvor det nye tokens notifikation gik tabt og appen aldrig
  // sendte det, ligner et udløb af det gamle token: meld det, så det kan
  // tjekkes (appens næste verifyGoogle retter det selv via linkedPurchaseToken).
  if (result.googleDowngradedIds.length > 0) {
    captureRouteError(
      new Error(
        `${result.googleDowngradedIds.length} Google Play-abonnement(er) mistede adgang i sweepen`,
      ),
      {
        route: "/api/cron/store-billing-sweep",
        type: "cron",
        extra: { subscriptionIds: result.googleDowngradedIds },
      },
    );
  }
  return {
    itemsProcessed: result.googleChecked + result.appleOverdueIds.length,
    itemsSucceeded: result.googleChecked - result.googleFailed,
    itemsFailed: result.googleFailed + result.appleOverdueIds.length,
    metadata: result,
  };
});
