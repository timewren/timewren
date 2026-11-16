"use client";

import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Image,
  Loader2,
  Minus,
  Save,
  Square,
  Type,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";
import { trpc } from "@/providers/trpc-provider";

type BlockType =
  | "header"
  | "text"
  | "button"
  | "divider"
  | "image"
  | "spacer"
  | "footer";

interface EmailBlock {
  id: string;
  type: BlockType;
  content: {
    logoUrl?: string;
    title?: string;
    text?: string;
    buttonText?: string;
    buttonUrl?: string;
    imageUrl?: string;
    altText?: string;
  };
  styles?: {
    backgroundColor?: string;
    textColor?: string;
    padding?: string;
    alignment?: "left" | "center" | "right";
    fontSize?: "small" | "medium" | "large";
  };
}

const blockTypeIcons: Record<BlockType, typeof Type> = {
  header: Type,
  text: Type,
  button: Square,
  divider: Minus,
  image: Image,
  spacer: Square,
  footer: Type,
};

const BLOCK_TYPES = Object.keys(blockTypeIcons) as BlockType[];

type Translator = ReturnType<typeof useTranslations>;

export default function EditEmailTemplatePage() {
  const t = useTranslations("settingsEmailTemplates.editor");
  const t2 = useTranslations("settingsEmailTemplates");
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const params = useParams();
  const templateId = params.id as string;
  const isNew = templateId === "new";

  const utils = trpc.useUtils();

  // Template data
  const { data: template, isLoading } = trpc.emailTemplates.getById.useQuery(
    { id: templateId },
    { enabled: !isNew && !!templateId },
  );

  // Form state
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [type, setType] = useState<string>("custom");
  const [isDefault, setIsDefault] = useState(false);
  const [blocks, setBlocks] = useState<EmailBlock[]>([]);
  const [selectedBlock, setSelectedBlock] = useState<string | null>(null);
  const [_draggedBlock, _setDraggedBlock] = useState<string | null>(null);

  // Available variables for selected type
  const { data: variables } =
    trpc.emailTemplates.getAvailableVariables.useQuery(
      { type: type as "invoice" | "custom" },
      { enabled: !!type },
    );

  // Populate form when template loads
  // biome-ignore lint/correctness/useExhaustiveDependencies: formularen må ikke nulstilles ved sprogskift, så t står ikke i deps
  useEffect(() => {
    if (template) {
      setName(template.name);
      setSubject(template.subject);
      setType(template.type);
      setIsDefault(template.isDefault ?? false);
      setBlocks(template.content as EmailBlock[]);
    } else if (isNew) {
      // Default blocks for new template
      setBlocks([
        {
          id: "header-1",
          type: "header",
          content: { title: t("newHeaderTitle") },
          styles: { alignment: "center" },
        },
        {
          id: "text-1",
          type: "text",
          content: { text: t("newText") },
          styles: {},
        },
        {
          id: "footer-1",
          type: "footer",
          content: {
            text: `${t("regards")}\n{{dit_navn}}\n{{firmanavn}}`,
          },
          styles: {},
        },
      ]);
    }
  }, [template, isNew]);

  // Mutations
  const createMutation = trpc.emailTemplates.create.useMutation({
    onSuccess: (data) => {
      utils.emailTemplates.list.invalidate();
      toast.success(t("created"));
      router.push(`/dashboard/settings/email-templates/${data?.id}`);
    },
    onError: (error) => {
      toast.error(error.message || t("createFailed"));
    },
  });

  const updateMutation = trpc.emailTemplates.update.useMutation({
    onSuccess: () => {
      utils.emailTemplates.list.invalidate();
      utils.emailTemplates.getById.invalidate({ id: templateId });
      toast.success(t("saved"));
    },
    onError: (error) => {
      toast.error(error.message || t("saveFailed"));
    },
  });

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error(t("nameRequired"));
      return;
    }
    if (!subject.trim()) {
      toast.error(t("subjectRequired"));
      return;
    }

    if (isNew) {
      await createMutation.mutateAsync({
        name: name.trim(),
        subject: subject.trim(),
        type: type as "invoice" | "custom",
        content: blocks,
        isDefault,
      });
    } else {
      await updateMutation.mutateAsync({
        id: templateId,
        name: name.trim(),
        subject: subject.trim(),
        content: blocks,
        isDefault,
      });
    }
  };

  const addBlock = useCallback(
    (blockType: BlockType) => {
      const newBlock: EmailBlock = {
        id: `${blockType}-${Date.now()}`,
        type: blockType,
        content: getDefaultContent(blockType, t),
        styles: getDefaultStyles(blockType),
      };
      setBlocks((prev) => [...prev, newBlock]);
      setSelectedBlock(newBlock.id);
    },
    [t],
  );

  const removeBlock = useCallback((blockId: string) => {
    setBlocks((prev) => prev.filter((b) => b.id !== blockId));
    setSelectedBlock(null);
  }, []);

  const moveBlock = useCallback((blockId: string, direction: "up" | "down") => {
    setBlocks((prev) => {
      const index = prev.findIndex((b) => b.id === blockId);
      if (index === -1) return prev;
      if (direction === "up" && index === 0) return prev;
      if (direction === "down" && index === prev.length - 1) return prev;

      const newBlocks = [...prev];
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      [newBlocks[index], newBlocks[targetIndex]] = [
        newBlocks[targetIndex],
        newBlocks[index],
      ];
      return newBlocks;
    });
  }, []);

  const updateBlockContent = useCallback(
    (blockId: string, content: Partial<EmailBlock["content"]>) => {
      setBlocks((prev) =>
        prev.map((b) =>
          b.id === blockId
            ? { ...b, content: { ...b.content, ...content } }
            : b,
        ),
      );
    },
    [],
  );

  const updateBlockStyles = useCallback(
    (blockId: string, styles: Partial<EmailBlock["styles"]>) => {
      setBlocks((prev) =>
        prev.map((b) =>
          b.id === blockId ? { ...b, styles: { ...b.styles, ...styles } } : b,
        ),
      );
    },
    [],
  );

  if (isPending || (!isNew && isLoading)) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-brand-600 dark:text-brand-400" />
      </div>
    );
  }

  if (!session) {
    return null;
  }

  const selectedBlockData = blocks.find((b) => b.id === selectedBlock);

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/dashboard/settings/email?tab=skabeloner"
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              {isNew ? t("newTitle") : t("editTitle")}
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t("subtitle")}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={createMutation.isPending || updateMutation.isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-6 py-2.5 font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50"
        >
          {createMutation.isPending || updateMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {t("save")}
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left Sidebar - Block Palette */}
        <div className="lg:col-span-2">
          <div className="sticky top-6 space-y-4">
            <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
              <h3 className="mb-3 text-sm font-medium text-gray-900 dark:text-white">
                {t("addBlock")}
              </h3>
              <div className="space-y-2">
                {BLOCK_TYPES.map((blockType) => {
                  const Icon = blockTypeIcons[blockType];
                  return (
                    <button
                      key={blockType}
                      type="button"
                      onClick={() => addBlock(blockType)}
                      className="flex w-full items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 p-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                      <Icon className="h-4 w-4" />
                      {t(`blocks.${blockType}`)}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Center - Email Preview */}
        <div className="lg:col-span-6">
          <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
            {/* Template Settings */}
            <div className="mb-6 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="name"
                    className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
                  >
                    {t("templateName")}
                  </label>
                  <input
                    id="name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                    placeholder={t("namePlaceholder")}
                  />
                </div>
                <div>
                  <label
                    htmlFor="type"
                    className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
                  >
                    {t("type")}
                  </label>
                  <select
                    id="type"
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                    disabled={!isNew}
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 disabled:opacity-50"
                  >
                    <option value="invoice">{t2("types.invoice")}</option>
                    <option value="invoice_reminder">
                      {t2("types.invoice_reminder")}
                    </option>
                    <option value="portal_welcome">
                      {t2("types.portal_welcome")}
                    </option>
                    <option value="portal_invitation">
                      {t2("types.portal_invitation")}
                    </option>
                    <option value="project_update">
                      {t2("types.project_update")}
                    </option>
                    <option value="prepaid_alert">
                      {t2("types.prepaid_alert")}
                    </option>
                    <option value="prepaid_expiry">
                      {t2("types.prepaid_expiry")}
                    </option>
                    <option value="time_approval">
                      {t2("types.time_approval")}
                    </option>
                    <option value="custom">{t2("types.custom")}</option>
                  </select>
                </div>
              </div>
              <div>
                <label
                  htmlFor="subject"
                  className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
                >
                  {t("subject")}
                </label>
                <input
                  id="subject"
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                  placeholder={t("subjectPlaceholder", {
                    invoiceNumber: "{{fakturanummer}}",
                    company: "{{firmanavn}}",
                  })}
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isDefault"
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-brand-600 dark:text-brand-400 focus:ring-brand-500"
                />
                <label
                  htmlFor="isDefault"
                  className="text-sm text-gray-700 dark:text-gray-300"
                >
                  {t("useAsDefault")}
                </label>
              </div>
            </div>

            {/* Email Preview */}
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 p-4">
              <p className="mb-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                {t("preview")}
              </p>
              <div className="space-y-2">
                {blocks.map((block, index) => (
                  // biome-ignore lint/a11y/noStaticElementInteractions: blokken er en markeringsflade med egne knapper og tastaturhåndtering (Enter/mellemrum)
                  // biome-ignore lint/a11y/useKeyWithClickEvents: blokken er en markeringsflade med egne knapper og tastaturhåndtering (Enter/mellemrum)
                  <div
                    key={block.id}
                    onClick={() => setSelectedBlock(block.id)}
                    className={`group relative cursor-pointer rounded-lg border-2 p-3 transition-all ${
                      selectedBlock === block.id
                        ? "border-brand-500 bg-brand-50 dark:bg-tt-gran-lys"
                        : "border-transparent hover:border-gray-300 dark:hover:border-gray-600"
                    }`}
                  >
                    {/* Block Controls */}
                    <div className="absolute -left-10 top-1/2 -translate-y-1/2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          moveBlock(block.id, "up");
                        }}
                        disabled={index === 0}
                        className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                      >
                        <ChevronUp className="h-4 w-4" />
                      </button>
                      <GripVertical className="h-4 w-4 text-gray-400" />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          moveBlock(block.id, "down");
                        }}
                        disabled={index === blocks.length - 1}
                        className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                      >
                        <ChevronDown className="h-4 w-4" />
                      </button>
                    </div>

                    {/* Block Content Preview */}
                    <BlockPreview block={block} t={t} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right Sidebar - Block Settings */}
        <div className="lg:col-span-4">
          <div className="sticky top-6 space-y-4">
            {selectedBlockData ? (
              <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-sm font-medium text-gray-900 dark:text-white">
                    {t("editBlock", {
                      block: t(`blocks.${selectedBlockData.type}`),
                    })}
                  </h3>
                  <button
                    type="button"
                    onClick={() => removeBlock(selectedBlockData.id)}
                    className="text-sm text-red-600 hover:text-red-700"
                  >
                    {t("remove")}
                  </button>
                </div>

                <BlockEditor
                  t={t}
                  block={selectedBlockData}
                  onUpdateContent={(content) =>
                    updateBlockContent(selectedBlockData.id, content)
                  }
                  onUpdateStyles={(styles) =>
                    updateBlockStyles(selectedBlockData.id, styles)
                  }
                />
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-800 p-6 text-center">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t("clickBlock")}
                </p>
              </div>
            )}

            {/* Variables */}
            {variables && (
              <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
                <h3 className="mb-3 text-sm font-medium text-gray-900 dark:text-white">
                  {t("variables")}
                </h3>
                <div className="max-h-60 overflow-y-auto space-y-1">
                  {Object.entries(variables).map(([variable, description]) => (
                    <div
                      key={variable}
                      className="flex items-center justify-between text-xs py-1"
                    >
                      <code className="text-brand-600 dark:text-brand-400">
                        {variable}
                      </code>
                      <span className="text-gray-500 dark:text-gray-400 text-right ml-2">
                        {description}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function getDefaultContent(
  type: BlockType,
  t: Translator,
): EmailBlock["content"] {
  switch (type) {
    case "header":
      return { title: t("defaultHeader") };
    case "text":
      return { text: t("defaultText") };
    case "button":
      return { buttonText: t("defaultButton"), buttonUrl: "{{portal_link}}" };
    case "image":
      return { imageUrl: "", altText: t("defaultAlt") };
    case "footer":
      return { text: `${t("regards")}\n{{dit_navn}}` };
    default:
      return {};
  }
}

function getDefaultStyles(type: BlockType): EmailBlock["styles"] {
  switch (type) {
    case "header":
      return { alignment: "center", fontSize: "large" };
    case "button":
      return { alignment: "center" };
    default:
      return {};
  }
}

function BlockPreview({ block, t }: { block: EmailBlock; t: Translator }) {
  switch (block.type) {
    case "header":
      return (
        <h2
          className={`text-xl font-bold text-gray-900 dark:text-white ${
            block.styles?.alignment === "center"
              ? "text-center"
              : block.styles?.alignment === "right"
                ? "text-right"
                : "text-left"
          }`}
        >
          {block.content.title || t("previewHeader")}
        </h2>
      );
    case "text":
      return (
        <p
          className={`text-gray-700 dark:text-gray-300 whitespace-pre-wrap ${
            block.styles?.alignment === "center"
              ? "text-center"
              : block.styles?.alignment === "right"
                ? "text-right"
                : "text-left"
          }`}
        >
          {block.content.text || t("previewText")}
        </p>
      );
    case "button":
      return (
        <div
          className={`${
            block.styles?.alignment === "center"
              ? "text-center"
              : block.styles?.alignment === "right"
                ? "text-right"
                : "text-left"
          }`}
        >
          <span
            className="inline-block rounded-lg px-6 py-2 font-medium text-white"
            style={{
              backgroundColor: block.styles?.backgroundColor || "#3b82f6",
            }}
          >
            {block.content.buttonText || t("previewButton")}
          </span>
        </div>
      );
    case "divider":
      return <hr className="border-gray-200 dark:border-gray-800" />;
    case "spacer":
      return <div className="h-8" />;
    case "image":
      return block.content.imageUrl ? (
        // biome-ignore lint/performance/noImgElement: bruger-uploadet billede fra vilkårlig URL i skabelon-forhåndsvisning, ikke egnet til next/image
        <img
          src={block.content.imageUrl}
          alt={block.content.altText || ""}
          className="max-w-full h-auto mx-auto"
        />
      ) : (
        <div className="flex items-center justify-center h-24 bg-gray-100 dark:bg-gray-800 rounded">
          <Image className="h-8 w-8 text-gray-400" />
        </div>
      );
    case "footer":
      return (
        <p className="text-sm text-gray-500 dark:text-gray-400 whitespace-pre-wrap text-center">
          {block.content.text || t("previewFooter")}
        </p>
      );
    default:
      return null;
  }
}

function BlockEditor({
  t,
  block,
  onUpdateContent,
  onUpdateStyles,
}: {
  t: Translator;
  block: EmailBlock;
  onUpdateContent: (content: Partial<EmailBlock["content"]>) => void;
  onUpdateStyles: (styles: Partial<EmailBlock["styles"]>) => void;
}) {
  const fid = useId();
  return (
    <div className="space-y-4">
      {/* Content fields based on block type */}
      {block.type === "header" && (
        <div>
          <label
            htmlFor={`${fid}-f1`}
            className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300"
          >
            {t("fieldHeader")}
          </label>
          <input
            id={`${fid}-f1`}
            type="text"
            value={block.content.title || ""}
            onChange={(e) => onUpdateContent({ title: e.target.value })}
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
          />
        </div>
      )}

      {(block.type === "text" || block.type === "footer") && (
        <div>
          <label
            htmlFor={`${fid}-f2`}
            className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300"
          >
            {t("fieldText")}
          </label>
          <textarea
            id={`${fid}-f2`}
            value={block.content.text || ""}
            onChange={(e) => onUpdateContent({ text: e.target.value })}
            rows={4}
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
          />
        </div>
      )}

      {block.type === "button" && (
        <>
          <div>
            <label
              htmlFor={`${fid}-f3`}
              className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300"
            >
              {t("buttonText")}
            </label>
            <input
              id={`${fid}-f3`}
              type="text"
              value={block.content.buttonText || ""}
              onChange={(e) => onUpdateContent({ buttonText: e.target.value })}
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
            />
          </div>
          <div>
            <label
              htmlFor={`${fid}-f4`}
              className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300"
            >
              {t("linkUrl")}
            </label>
            <input
              id={`${fid}-f4`}
              type="text"
              value={block.content.buttonUrl || ""}
              onChange={(e) => onUpdateContent({ buttonUrl: e.target.value })}
              placeholder={t("linkPlaceholder", { variable: "{{variabel}}" })}
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
            />
          </div>
          <div>
            <label
              htmlFor={`${fid}-f5`}
              className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300"
            >
              {t("buttonColor")}
            </label>
            <input
              id={`${fid}-f5`}
              type="color"
              value={block.styles?.backgroundColor || "#3b82f6"}
              onChange={(e) =>
                onUpdateStyles({ backgroundColor: e.target.value })
              }
              className="h-10 w-full cursor-pointer rounded border border-gray-200 dark:border-gray-700"
            />
          </div>
        </>
      )}

      {block.type === "image" && (
        <>
          <div>
            <label
              htmlFor={`${fid}-f6`}
              className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300"
            >
              {t("imageUrl")}
            </label>
            <input
              id={`${fid}-f6`}
              type="text"
              value={block.content.imageUrl || ""}
              onChange={(e) => onUpdateContent({ imageUrl: e.target.value })}
              placeholder={t("imagePlaceholder")}
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
            />
          </div>
          <div>
            <label
              htmlFor={`${fid}-f7`}
              className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300"
            >
              {t("altText")}
            </label>
            <input
              id={`${fid}-f7`}
              type="text"
              value={block.content.altText || ""}
              onChange={(e) => onUpdateContent({ altText: e.target.value })}
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
            />
          </div>
        </>
      )}

      {/* Alignment for most blocks */}
      {["header", "text", "button", "footer"].includes(block.type) && (
        <div>
          <span className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
            {t("alignment")}
          </span>
          <div className="flex gap-2">
            {(["left", "center", "right"] as const).map((align) => (
              <button
                key={align}
                type="button"
                onClick={() => onUpdateStyles({ alignment: align })}
                className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  block.styles?.alignment === align
                    ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-tt-gran-lys dark:text-brand-400"
                    : "border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                }`}
              >
                {t(align)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
