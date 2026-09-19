import {
  HashIcon,
  ImageIcon,
  ListIcon,
  Loader2Icon,
  PaperclipIcon,
  SendIcon,
  XIcon,
} from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { uploadAttachment } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n";
import {
  extractImageFiles,
  inlineImageMarkdown,
  insertSnippetAt,
} from "@/lib/image-insert";
import type { MemoCaptureInput } from "@/lib/local-memo-capture";
import { extractTags } from "@/lib/memo";

type MemoComposerProps = {
  draft: MemoCaptureInput;
  isPending: boolean;
  onDraftChange: (draft: MemoCaptureInput) => void;
  onSubmit: (input: MemoCaptureInput) => Promise<void>;
};

const fileKeys = new WeakMap<File, string>();
let nextFileKey = 0;

function getFileKey(file: File) {
  const existing = fileKeys.get(file);
  if (existing) return existing;

  const key = `file-${nextFileKey}`;
  nextFileKey += 1;
  fileKeys.set(file, key);
  return key;
}

export function MemoComposer({
  draft,
  isPending,
  onDraftChange,
  onSubmit,
}: MemoComposerProps) {
  const { t } = useI18n();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canSubmit = Boolean(draft.content.trim() || draft.files.length > 0);
  const [isUploadingImages, setIsUploadingImages] = useState(false);
  // Uploads read the latest draft through a ref: the async chain would
  // otherwise insert into a stale closure while the user keeps typing.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const pendingUploadsRef = useRef(0);
  const uploadChainRef = useRef<Promise<void>>(Promise.resolve());

  // Pasted/dropped images upload immediately (unbound; the send flow claims
  // them afterwards) and their references land at the recorded caret once the
  // upload settles. Tasks chain so two rapid pastes never drift positions.
  const enqueueInlineUploads = (files: File[], caret: number) => {
    if (files.length === 0) return;
    pendingUploadsRef.current += files.length;
    setIsUploadingImages(true);
    uploadChainRef.current = uploadChainRef.current
      .catch(() => undefined)
      .then(async () => {
        let cursor = caret;
        try {
          for (const file of files) {
            let attachment: Awaited<ReturnType<typeof uploadAttachment>>;
            try {
              attachment = await uploadAttachment({ file });
            } catch {
              toast.error(t("composer.imageUploadFailed"));
              break;
            }
            // Read after the upload: the user may have kept typing while the
            // network was pending. Never replace that text with an old draft.
            const current = draftRef.current;
            const next = insertSnippetAt(
              current.content,
              cursor,
              inlineImageMarkdown(attachment.id, attachment.filename),
            );
            cursor = next.caret;
            const nextDraft = {
              ...current,
              content: next.content,
              tags: extractTags(next.content),
              preuploadedAttachmentNames: [
                ...(current.preuploadedAttachmentNames ?? []),
                attachment.name,
              ],
            };
            draftRef.current = nextDraft;
            onDraftChange(nextDraft);
          }
        } finally {
          // A failed batch also releases the files skipped after the failure.
          pendingUploadsRef.current -= files.length;
          setIsUploadingImages(pendingUploadsRef.current > 0);
        }
      });
  };

  // The composer grows with the draft instead of scrolling, up to a cap.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure the height whenever the draft text changes.
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 320)}px`;
  }, [draft.content]);

  const updateContent = (content: string) =>
    onDraftChange({
      ...draft,
      content,
      tags: extractTags(content),
    });
  const appendText = (value: string) => {
    updateContent(
      `${draft.content}${draft.content && !draft.content.endsWith("\n") ? " " : ""}${value}`,
    );
  };
  const submit = async () => {
    // Images still uploading have no reference in the content yet; sending
    // now would lose them to the orphan GC.
    if (!canSubmit || isUploadingImages) {
      return;
    }
    try {
      await onSubmit(draft);
    } catch {
      // The mutation owns user-facing error feedback; keep the draft intact.
    }
  };

  return (
    <form
      className="group relative flex w-full flex-col rounded-xl border border-border bg-card shadow-xs motion-safe:animate-rise motion-safe:transition-[border-color,box-shadow] motion-safe:duration-200 focus-within:border-flame-400/60 focus-within:shadow-md focus-within:ring-2 focus-within:ring-flame-400/25"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Textarea
        aria-label={t("composer.ariaLabel")}
        className="min-h-32 resize-none overflow-y-auto rounded-t-xl border-0 px-4 pt-4 pb-2 text-[15px] leading-7 shadow-none focus-visible:ring-0"
        disabled={isPending}
        id="flaremo-composer-input"
        placeholder={t("composer.placeholder")}
        ref={textareaRef}
        value={draft.content}
        onChange={(event) => updateContent(event.target.value)}
        onKeyDown={(event) => {
          // Enter sends; IME composition and Shift+Enter never submit.
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            if (!isUploadingImages) void submit();
            return;
          }
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            if (!isUploadingImages) void submit();
          }
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
          }
        }}
        onDrop={(event) => {
          const files = extractImageFiles(event.dataTransfer.files);
          if (files.length === 0) return;
          event.preventDefault();
          enqueueInlineUploads(
            files,
            event.currentTarget.selectionStart ?? draft.content.length,
          );
        }}
        onPaste={(event) => {
          const files = extractImageFiles(event.clipboardData.files);
          if (files.length === 0) return;
          event.preventDefault();
          enqueueInlineUploads(
            files,
            event.currentTarget.selectionStart ?? draft.content.length,
          );
        }}
      />
      {draft.files.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pb-2">
          {draft.files.map((file) => (
            <div
              className="flex max-w-full items-center gap-2 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground"
              key={getFileKey(file)}
            >
              <PaperclipIcon />
              <span className="truncate">{file.name}</span>
              <Button
                aria-label={t("composer.removeFile", { filename: file.name })}
                disabled={isPending}
                size="icon-xs"
                type="button"
                variant="ghost"
                onClick={() =>
                  onDraftChange({
                    ...draft,
                    files: draft.files.filter((item) => item !== file),
                  })
                }
              >
                <XIcon />
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="flex h-10 items-center justify-between gap-2 rounded-b-xl bg-card px-3 pb-1">
        <div className="flex min-w-0 items-center gap-1">
          <Button
            aria-label={t("composer.addTag")}
            disabled={isPending}
            size="icon-sm"
            type="button"
            variant="ghost"
            onClick={() => appendText("#")}
          >
            <HashIcon />
          </Button>
          <Button asChild disabled={isPending} size="icon-sm" variant="ghost">
            <label
              aria-label={t("composer.addAttachment")}
              htmlFor="flaremo-attachment-input"
            >
              <ImageIcon />
              <Input
                className="hidden"
                id="flaremo-attachment-input"
                multiple
                type="file"
                disabled={isPending}
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = "";
                  if (files.length === 0) return;
                  onDraftChange({
                    ...draft,
                    files: [...draft.files, ...files],
                  });
                }}
              />
            </label>
          </Button>
          <div className="hidden h-4 w-px bg-border sm:block" />
          <Button
            aria-label={t("composer.bulletList")}
            disabled={isPending}
            size="icon-sm"
            type="button"
            variant="ghost"
            onClick={() => appendText("- ")}
          >
            <ListIcon />
          </Button>
        </div>
        <Button
          className="h-8 shrink-0 self-center px-3"
          disabled={isPending || isUploadingImages || !canSubmit}
          type="submit"
          variant="brand"
        >
          {isPending ? (
            <>
              <Loader2Icon
                className="motion-safe:animate-spin"
                data-icon="inline-start"
              />
              {t("composer.sending")}
            </>
          ) : (
            <SendIcon
              className="motion-safe:animate-scale-in"
              data-icon="inline-start"
            />
          )}
          <span>{t("composer.send")}</span>
        </Button>
      </div>
    </form>
  );
}
