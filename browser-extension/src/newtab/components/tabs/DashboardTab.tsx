import { useSettingsStore } from "../../../stores/settingsStore";
import { WidgetGrid } from "../WidgetGrid";

export function DashboardTab() {
  const { settings } = useSettingsStore();

  return (
    <div className="animate-tab-enter">
      <WidgetGrid widgets={settings.newTabWidgets} />
    </div>
  );
}
