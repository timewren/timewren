"use client";

import { Camera, Loader2, Trash2 } from "lucide-react";
import Image from "next/image";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useUiScope } from "./use-ui-text";

interface ImageUploadProps {
  value: string | null | undefined;
  onChange: (url: string | null) => void;
  folder: string;
  /** Shape of the preview */
  shape?: "circle" | "rectangle";
  /** Size in pixels for the preview container */
  size?: number;
  label?: string;
  className?: string;
}

export function ImageUpload({
  value,
  onChange,
  folder,
  shape = "circle",
  size = 96,
  label,
  className = "",
}: ImageUploadProps) {
  const t = useUiScope("image");
  const [isUploading, setIsUploading] = useState(false);
  // Husk hvilken URL der fejlede, så et dødt billede (fx en blokeret
  // OAuth-avatar) viser kamera-placeholderen i stedet for broken image
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset input so the same file can be re-selected
    e.target.value = "";

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("folder", folder);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t("uploadFailed"));
      }

      const { url } = await res.json();
      onChange(url);
      toast.success(t("uploaded"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("uploadError"));
    } finally {
      setIsUploading(false);
    }
  };

  const shapeClass = shape === "circle" ? "rounded-full" : "rounded-lg";

  return (
    <div className={`flex items-center gap-4 ${className}`}>
      <div
        className={`relative flex items-center justify-center overflow-hidden border-2 border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 ${shapeClass}`}
        style={{ width: size, height: size }}
      >
        {value && failedSrc !== value ? (
          <Image
            src={value}
            alt={label || t("alt")}
            fill
            className={`object-cover ${shapeClass}`}
            sizes={`${size}px`}
            onError={() => setFailedSrc(value)}
          />
        ) : (
          <Camera className="h-6 w-6 text-gray-400" />
        )}
        {isUploading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <Loader2 className="h-6 w-6 animate-spin text-white" />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {label && (
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {label}
          </span>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={isUploading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            {value ? t("change") : t("upload")}
          </button>
          {value && (
            <button
              type="button"
              onClick={() => onChange(null)}
              disabled={isUploading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 dark:border-red-800 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm font-medium text-red-600 dark:text-red-400 transition-colors hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t("remove")}
            </button>
          )}
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">{t("hint")}</p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/svg+xml"
        onChange={handleFileChange}
        className="hidden"
      />
    </div>
  );
}
