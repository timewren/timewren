import { Outlet } from "@tanstack/react-router";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useNarrowLayout } from "@/hooks/useNarrowLayout";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { Titlebar } from "./Titlebar";

export function AppShell() {
  useKeyboardShortcuts();
  const smalt = useNarrowLayout();

  return (
    <div className="flex h-screen flex-col">
      <Titlebar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        {/* `min-w-0`: et flex-barn har ellers `min-width: auto`, så ét bredt
            barn (ugentidslinjens syv dage, et langt projektnavn) trykker
            main ud over sin andel og skyder sidebaren væk. I et smalt vindue
            er de 48 px `p-6`også 5 % af skærmen, så paddingen følger bredden. */}
        <main
          className={`min-w-0 flex-1 overflow-y-auto ${smalt ? "p-3" : "p-6"}`}
        >
          <Outlet />
        </main>
      </div>
      <StatusBar />
    </div>
  );
}
