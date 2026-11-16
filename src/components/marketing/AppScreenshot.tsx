import Image from "next/image";

interface AppScreenshotProps {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  className?: string;
  priority?: boolean;
  /**
   * Hvor bredt billedet vises. Uden `sizes` genererer next/image kun 1x/2x
   * af den fulde bredde (1280 → 3840 px-varianten på retina-mobiler), så
   * standarden her lader browseren vælge ud fra viewporten i stedet.
   */
  sizes?: string;
}

export function AppScreenshot({
  src,
  alt,
  width = 1280,
  height = 800,
  className = "",
  priority = false,
  sizes = "(min-width: 1280px) 1280px, 100vw",
}: AppScreenshotProps) {
  return (
    <div
      className={`overflow-hidden rounded-2xl border border-slate-200/60 bg-white shadow-2xl ${className}`}
    >
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/80 px-4 py-3">
        <div className="flex gap-1.5">
          <div className="h-3 w-3 rounded-full bg-red-300" />
          <div className="h-3 w-3 rounded-full bg-yellow-300" />
          <div className="h-3 w-3 rounded-full bg-green-300" />
        </div>
        <div className="ml-2 text-xs text-slate-400">TimeTrack</div>
      </div>
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        className="w-full"
        priority={priority}
        sizes={sizes}
        quality={85}
      />
    </div>
  );
}
