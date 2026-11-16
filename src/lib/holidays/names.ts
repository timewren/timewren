import { sharedT } from "@/i18n/shared-text";

// Danske navne som `danishPublicHolidays`/`OPTIONAL_DAY_LABELS` leverer → nøgle i `sharedLabels.holidays`.
const HOLIDAY_KEYS: Record<string, string> = {
  Nytårsdag: "newYearsDay",
  Skærtorsdag: "maundyThursday",
  Langfredag: "goodFriday",
  Påskedag: "easterSunday",
  "2. påskedag": "easterMonday",
  "Kristi himmelfartsdag": "ascensionDay",
  Pinsedag: "whitSunday",
  "2. pinsedag": "whitMonday",
  Juledag: "christmasDay",
  "2. juledag": "boxingDay",
  "Store bededag": "greatPrayerDay",
  "1. maj": "may1",
  Grundlovsdag: "constitutionDay",
  "Fredag efter Kristi himmelfart": "dayAfterAscension",
  Juleaftensdag: "christmasEve",
  Nytårsaftensdag: "newYearsEve",
  Fridag: "dayOff",
};

/**
 * Fridagens navn på brugerens sprog. Kendte danske helligdage og standardnavnet "Fridag"
 * oversættes; egne fridage med brugerens eget navn returneres uændret.
 */
export function localizeDayOffName(
  name: string,
  locale?: string | null,
): string {
  const key = HOLIDAY_KEYS[name];
  return key
    ? sharedT("sharedLabels", `holidays.${key}`, undefined, locale)
    : name;
}
