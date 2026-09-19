import { Loader2Icon, SearchIcon, SparklesIcon, XIcon } from "lucide-react";
import { memo, type RefObject, useEffect, useState } from "react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { useI18n } from "@/i18n";

export const WorkspaceSearch = memo(function WorkspaceSearch({
  className,
  inputRef,
  query,
  isPending,
  semanticMode,
  onToggleSemantic,
  onQueryChange,
}: {
  className: string;
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  isPending: boolean;
  semanticMode: boolean;
  onToggleSemantic?: () => void;
  onQueryChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(query);
  const [sourceQuery, setSourceQuery] = useState(query);
  const [isComposing, setIsComposing] = useState(false);

  // URL changes (filters, history, the other responsive input) remain the
  // source of truth. Typing itself stays local and never rerenders the list.
  if (sourceQuery !== query) {
    setSourceQuery(query);
    setDraft(query);
  }

  useEffect(() => {
    if (isComposing || draft === query) return;
    const timeout = window.setTimeout(() => onQueryChange(draft), 250);
    return () => window.clearTimeout(timeout);
  }, [draft, isComposing, onQueryChange, query]);

  const clear = () => {
    setDraft("");
    onQueryChange("");
    inputRef.current?.focus();
  };

  return (
    <div className={className}>
      <InputGroup className="h-10">
        <InputGroupInput
          aria-label={t("common.search")}
          autoComplete="off"
          className="h-full min-w-0"
          enterKeyHint="search"
          placeholder={
            semanticMode
              ? t("search.semanticPlaceholder")
              : t("search.placeholder")
          }
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={() => setIsComposing(false)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || isComposing) return;
            if (event.key === "Escape") {
              event.preventDefault();
              clear();
            }
            if (event.key === "Enter") {
              event.preventDefault();
              onQueryChange(draft);
            }
          }}
        />
        <InputGroupAddon>
          {isPending || draft !== query ? (
            <Loader2Icon
              aria-hidden="true"
              className="ml-1 size-4 shrink-0 text-muted-foreground motion-safe:animate-spin"
            />
          ) : (
            <SearchIcon
              aria-hidden="true"
              className="ml-1 size-4 shrink-0 text-muted-foreground"
            />
          )}
        </InputGroupAddon>
        <InputGroupAddon align="inline-end">
          {draft && (
            <InputGroupButton
              aria-label={t("search.clear")}
              size="icon-sm"
              variant="ghost"
              onClick={clear}
            >
              <XIcon />
            </InputGroupButton>
          )}
          {onToggleSemantic && (
            <InputGroupButton
              aria-label={t("search.semanticToggle")}
              aria-pressed={semanticMode}
              size="icon-sm"
              title={t("search.semanticToggle")}
              variant={semanticMode ? "secondary" : "ghost"}
              onClick={onToggleSemantic}
            >
              <SparklesIcon />
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
});
