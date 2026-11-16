"use client";

import { ImagePlus, Trash2, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { compressImage } from "@/lib/upload/compress-image";
import { trpc } from "@/providers/trpc-provider";

interface TaskAttachmentsProps {
  taskId: string;
}

export function TaskAttachments({ taskId }: TaskAttachmentsProps) {
  const t = useTranslations("tasks");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const { data: attachments, refetch } = trpc.tasks.listAttachments.useQuery({
    taskId,
  });
  const addMutation = trpc.tasks.addAttachment.useMutation({
    onSuccess: () => refetch(),
    onError: (error) =>
      toast.error(error.message || t("attachments.saveFailed")),
  });
  const deleteMutation = trpc.tasks.deleteAttachment.useMutation({
    onSuccess: () => {
      refetch();
      toast.success(t("attachments.deleted"));
    },
    onError: (error) =>
      toast.error(error.message || t("attachments.deleteFailed")),
  });

  const handleUpload = useCallback(
    async (file: File) => {
      setUploading(true);
      try {
        const compressed = await compressImage(file);
        const formData = new FormData();
        formData.append("file", compressed, file.name);

        const res = await fetch("/api/upload/task-image", {
          method: "POST",
          body: formData,
        });
        if (!res.ok) throw new Error("Upload failed");

        const { url, fileName, sizeBytes } = await res.json();
        await addMutation.mutateAsync({
          taskId,
          fileName,
          contentType: "image/jpeg",
          sizeBytes,
          storageUrl: url,
        });
        toast.success(t("attachments.uploaded"));
      } catch {
        toast.error(t("attachments.uploadFailed"));
      } finally {
        setUploading(false);
      }
    },
    [taskId, addMutation, t],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file?.type.startsWith("image/")) handleUpload(file);
    },
    [handleUpload],
  );

  const imageAttachments = attachments?.filter(
    (a) => a.storageUrl && a.contentType?.startsWith("image/"),
  );

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          {t("attachments.title")}{" "}
          {imageAttachments?.length ? `(${imageAttachments.length})` : ""}
        </h3>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-700 dark:text-brand-400"
        >
          <ImagePlus className="h-4 w-4" />
          {uploading ? t("attachments.uploading") : t("attachments.addImage")}
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        tabIndex={-1}
        aria-label={t("attachments.addImage")}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleUpload(file);
          e.target.value = "";
        }}
      />

      {!imageAttachments || imageAttachments.length === 0 ? (
        // biome-ignore lint/a11y/noStaticElementInteractions: træk-og-slip er mus-/touch-interaktion; samme handling findes som knapper/tastatur ved siden af
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          className="flex items-center justify-center rounded-lg border-2 border-dashed border-gray-200 dark:border-gray-700 p-6 text-sm text-gray-400"
        >
          <Upload className="h-4 w-4 mr-2" />
          {t("attachments.dropHint")}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {imageAttachments.map((att) => (
            <div
              key={att.id}
              className="group relative rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700"
            >
              {/* biome-ignore lint/performance/noImgElement: user-uploaded task attachment images */}
              <img
                src={att.storageUrl ?? undefined}
                alt={att.filename || t("attachments.altFallback")}
                className="w-full h-24 object-cover"
                loading="lazy"
                width={200}
                height={96}
              />
              <button
                type="button"
                onClick={() => deleteMutation.mutate({ id: att.id })}
                aria-label={t("attachments.delete")}
                className="absolute top-1 right-1 rounded-full bg-red-600 p-2 text-white sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 transition-opacity"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
