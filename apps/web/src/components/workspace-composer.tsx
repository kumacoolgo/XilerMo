import { useNavigate } from "@tanstack/react-router";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { MemoComposer } from "@/components/memo-composer";
import { useMemoMutations } from "@/hooks/use-memo-mutations";
import { useNewMemoCapture } from "@/hooks/use-new-memo-capture";
import { useI18n } from "@/i18n";
import {
  enqueueMemoSubmission,
  flushQueuedMemoSubmissions,
  getNewMemoDraftId,
  isBrowserOnline,
  type MemoCaptureInput,
} from "@/lib/local-memo-capture";
import {
  shouldContinueQueuedSubmissionAfterFailure,
  shouldQueueAfterFailure,
  validateMemoCaptureSubmission,
} from "@/lib/memo-submission";

// Keep draft updates and upload progress inside the capture boundary. This
// component stays mounted across workspace filters so drafts and offline
// synchronization survive a visit to the archive or trash.
export const WorkspaceComposer = memo(function WorkspaceComposer({
  visible,
  composeRequested,
}: {
  visible: boolean;
  composeRequested: boolean;
}) {
  const { t } = useI18n();
  const navigate = useNavigate({ from: "/" });
  const [newMemoDraftId] = useState(getNewMemoDraftId);
  const capture = useNewMemoCapture({ draftId: newMemoDraftId });
  const { createMemoAsync, isCreatingMemo, handleMutationError } =
    useMemoMutations();
  const isQueueFlushing = useRef(false);
  const isQueueFlushPending = useRef(false);
  const isCaptureSubmitting = useRef(false);
  const restoredDraftNotified = useRef(false);
  const [isCaptureSubmissionPending, setIsCaptureSubmissionPending] =
    useState(false);

  const flushQueuedCaptures = useCallback(async () => {
    if (!isBrowserOnline()) return;
    // An "online" event that lands while a flush is running (e.g. the mount
    // flush) must schedule another pass instead of being swallowed.
    if (isQueueFlushing.current) {
      isQueueFlushPending.current = true;
      return;
    }

    isQueueFlushing.current = true;
    try {
      let submitted = 0;
      let failed = 0;
      do {
        isQueueFlushPending.current = false;
        const result = await flushQueuedMemoSubmissions(
          (submission) => createMemoAsync(submission),
          {
            shouldContinueAfterFailure:
              shouldContinueQueuedSubmissionAfterFailure,
          },
        );
        submitted += result.submittedIds.length;
        failed += result.failedIds.length;
      } while (isQueueFlushPending.current && isBrowserOnline());
      if (submitted > 0) {
        toast.success(t("toast.queueSynced"));
      }
      if (failed > 0) {
        toast.error(t("toast.queueNeedsAttention", { count: failed }));
      }
    } finally {
      isQueueFlushing.current = false;
    }
  }, [createMemoAsync, t]);

  useEffect(() => {
    void flushQueuedCaptures();
    const handleOnline = () => void flushQueuedCaptures();
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [flushQueuedCaptures]);

  useEffect(() => {
    if (!capture.didRestoreStoredDraft || restoredDraftNotified.current) return;
    restoredDraftNotified.current = true;
    toast.success(t("toast.draftRestored"));
  }, [capture.didRestoreStoredDraft, t]);

  // The PWA "new note" shortcut lands on `/?compose=1`. Focus the composer and
  // strip the flag so a later reload does not steal focus again.
  useEffect(() => {
    if (!composeRequested || !visible) return;
    const composer = document.getElementById("flaremo-composer-input");
    if (composer instanceof HTMLTextAreaElement) {
      composer.focus();
      composer.setSelectionRange(composer.value.length, composer.value.length);
    }
    void navigate({
      replace: true,
      search: (current) => ({ ...current, compose: undefined }),
    });
  }, [composeRequested, navigate, visible]);

  const handleCaptureSubmit = async (input: MemoCaptureInput) => {
    if (isCaptureSubmitting.current) return;

    isCaptureSubmitting.current = true;
    setIsCaptureSubmissionPending(true);
    const submission = {
      ...input,
      content: input.content || t("toast.untitledAttachment"),
    };
    try {
      const validationError = validateMemoCaptureSubmission(submission, t);
      if (validationError) {
        handleMutationError(validationError);
        throw validationError;
      }

      if (!isBrowserOnline()) {
        const queued = await enqueueMemoSubmission(submission);
        if (!queued) {
          const error = new Error(t("toast.offlineStorageUnavailable"));
          handleMutationError(error);
          throw error;
        }
        await capture.discardDraft();
        toast.success(t("toast.queuedForSync"));
        return;
      }

      try {
        await createMemoAsync(submission);
        await capture.discardDraft();
        toast.success(t("toast.saved"));
      } catch (error) {
        if (!shouldQueueAfterFailure(error)) {
          handleMutationError(error);
          throw error;
        }

        const queued = await enqueueMemoSubmission(submission);
        if (!queued) {
          handleMutationError(error);
          throw error;
        }
        await capture.discardDraft();
        toast.success(t("toast.queuedForSync"));
      }
    } finally {
      isCaptureSubmitting.current = false;
      setIsCaptureSubmissionPending(false);
    }
  };

  if (!visible) return null;
  return (
    <MemoComposer
      draft={capture.draft}
      isPending={isCreatingMemo || isCaptureSubmissionPending}
      onDraftChange={capture.updateDraft}
      onSubmit={handleCaptureSubmit}
    />
  );
});
