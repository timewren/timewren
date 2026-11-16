import { useEffect } from "react";
import { useSettingsStore } from "../stores/settingsStore";

export function useTheme() {
  const theme = useSettingsStore((s) => s.settings.theme);

  useEffect(() => {
    const root = document.documentElement;

    if (theme === "dark") {
      root.classList.add("dark");
      root.classList.remove("light");
    } else if (theme === "light") {
      root.classList.add("light");
      root.classList.remove("dark");
    } else {
      root.classList.remove("dark", "light");
    }
  }, [theme]);
}
