import { useEffect, useState } from "react";
import { toIntlLocale, useT } from "../../i18n";
import { ClockText } from "../../popup/components/ClockText";

export function ClockWidget() {
  const { locale } = useT();
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => {
      setTime(new Date());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString(toIntlLocale(locale), {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString(toIntlLocale(locale), {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  };

  // Capitalize first letter of weekday
  const formattedDate = formatDate(time);
  const capitalizedDate =
    formattedDate.charAt(0).toUpperCase() + formattedDate.slice(1);

  return (
    <div className="text-center py-4">
      <div className="clock-display">
        <ClockText value={formatTime(time)} />
      </div>
      <div className="date-display mt-2">{capitalizedDate}</div>
    </div>
  );
}
