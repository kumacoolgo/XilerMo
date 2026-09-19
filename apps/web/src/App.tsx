import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  CalendarIcon,
  DownloadIcon,
  LanguagesIcon,
  MenuIcon,
  SettingsIcon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  getMemoStats,
  getTagHierarchy,
  getVectorUsage,
  listMemos,
  type MemoStatsResponse,
  type MemoVisibility,
  semanticSearchMemos,
} from "@/api";
import type { ExplorerView as ViewMode } from "@/components/flaremo-explorer";
import { FlareMoExplorer } from "@/components/flaremo-explorer";
import { InfoTip } from "@/components/info-tip";
import { MemoList } from "@/components/memo-list";
import { NotificationBell } from "@/components/notification-bell";
import { PwaUpdatePrompt } from "@/components/pwa-update-prompt";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { UpdateStatus } from "@/components/update-status";
import { WorkspaceComposer } from "@/components/workspace-composer";
import { WorkspaceSearch } from "@/components/workspace-search";
import { useDataTransfer } from "@/hooks/use-data-transfer";
import { useMemoMutations, viewToMemoState } from "@/hooks/use-memo-mutations";
import { type TranslationKey, useI18n } from "@/i18n";
import { dayFilterFromQuery, formatDayTitle } from "@/lib/calendar-date";
import { cn } from "@/lib/utils";
import { AppRoutes } from "@/router-tree";
import { indexRoute, registerWorkspaceComponent } from "@/routes/index-route";

const PAGE_SIZE = 30;
const EMPTY_STATS: MemoStatsResponse = {
  counts: { normal: 0, archived: 0, trashed: 0, total: 0 },
  active_days: 0,
  tags: [],
  activity: [],
};

// Breaks the App ↔ router-tree import cycle: the route tree renders the
// workspace through this registry instead of importing `@/App`. Module-eval
// order guarantees registration before the router's first render.
registerWorkspaceComponent(FlareMoApp);

export function FlareMoApp() {
  const { locale, t, toggleLocale } = useI18n();
  const navigate = useNavigate({ from: "/" });
  const search = indexRoute.useSearch();
  const view = search.view ?? "all";
  const activeTag = search.tag;
  const untagged = Boolean(search.untagged);
  const query = search.q ?? "";
  const composeRequested = Boolean(search.compose);
  // A query that is exactly one local day is not a text search; it renders as
  // a removable date chip and the search box stays empty.
  const dayFilter = dayFilterFromQuery(query);
  const setView = useCallback(
    (nextView: ViewMode) => {
      void navigate({
        replace: true,
        search: (current) => ({ ...current, view: nextView }),
      });
    },
    [navigate],
  );
  const setActiveTag = useCallback(
    (tag: string | undefined) => {
      void navigate({
        replace: true,
        search: (current) => ({ ...current, tag, untagged: undefined }),
      });
    },
    [navigate],
  );
  const setUntagged = useCallback(
    (next: boolean) => {
      void navigate({
        replace: true,
        search: (current) => ({
          ...current,
          tag: undefined,
          untagged: next || undefined,
        }),
      });
    },
    [navigate],
  );
  const setQuery = useCallback(
    (q: string) => {
      void navigate({
        replace: true,
        search: (current) => ({
          ...current,
          q: q || undefined,
          view: q.trim() ? "all" : "view" in current ? current.view : undefined,
        }),
      });
    },
    [navigate],
  );
  const clearFilters = useCallback(() => {
    void navigate({
      replace: true,
      search: (current) => ({
        ...current,
        q: undefined,
        tag: undefined,
        untagged: undefined,
      }),
    });
  }, [navigate]);
  const [timeZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  const desktopSearchRef = useRef<HTMLInputElement>(null);
  const mobileSearchRef = useRef<HTMLInputElement>(null);
  const [isTimelineScrolled, setIsTimelineScrolled] = useState(false);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [shortcutsOpen, setShowShortcutsOpen] = useState(false);
  const searchQuery = query.trim();
  const isSearching = Boolean(searchQuery);
  const [semanticMode, setSemanticMode] = useState(false);

  const vectorUsageQuery = useQuery({
    queryKey: ["vector-usage"],
    queryFn: () => getVectorUsage(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  // Semantic search is hidden when the plan has no budget for it (quota 0)
  // or the capability itself is disabled server-side.
  const semanticEnabled = useMemo(() => {
    const plan = vectorUsageQuery.data?.plan;
    if (!plan) return false;
    const limit =
      plan.user?.limits.semanticSearchQueriesPerMonth ??
      plan.limits.semanticSearchQueriesPerMonth;
    return typeof limit === "number" && limit > 0;
  }, [vectorUsageQuery.data]);

  const isSemanticSearch =
    semanticMode && semanticEnabled && isSearching && !dayFilter;
  const toggleSemantic = useCallback(
    () => setSemanticMode((value) => !value),
    [],
  );
  const semanticResultsQuery = useQuery({
    queryKey: ["semantic-search", searchQuery],
    enabled: isSemanticSearch,
    queryFn: ({ signal }) => semanticSearchMemos(searchQuery, 20, signal),
    retry: false,
  });
  const semanticMemos = useMemo(
    () => semanticResultsQuery.data?.memos ?? [],
    [semanticResultsQuery.data],
  );

  useEffect(() => {
    const focusSearch = () => {
      const desktop = window.matchMedia("(min-width: 768px)").matches;
      (desktop ? desktopSearchRef : mobileSearchRef).current?.focus();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const editable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable);
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLocaleLowerCase() === "k"
      ) {
        event.preventDefault();
        focusSearch();
        return;
      }
      if (event.key === "/" && !editable) {
        event.preventDefault();
        focusSearch();
        return;
      }
      // "c" jumps straight into the composer for quick capture.
      if (event.key.toLocaleLowerCase() === "c" && !editable) {
        const composer = document.getElementById("flaremo-composer-input");
        if (composer instanceof HTMLTextAreaElement) {
          event.preventDefault();
          composer.focus();
        }
      }
      // "?" lists the available keyboard shortcuts.
      if (event.key === "?" && !editable) {
        event.preventDefault();
        setShowShortcutsOpen(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const memosQuery = useInfiniteQuery({
    queryKey: ["memos", view, searchQuery, activeTag, untagged],
    initialPageParam: undefined as string | undefined,
    enabled: !isSemanticSearch,
    queryFn: ({ pageParam, signal }) =>
      listMemos(
        {
          include_deleted: !isSearching && view === "trashed",
          page_size: PAGE_SIZE,
          page_token: pageParam,
          q: searchQuery || undefined,
          state: isSearching ? undefined : viewToMemoState(view),
          tag: activeTag,
          untagged,
        },
        signal,
      ),
    getNextPageParam: (lastPage) => lastPage.next_page_token,
    retry: false,
  });
  const statsQuery = useQuery({
    queryKey: ["memo-stats", timeZone],
    queryFn: () => getMemoStats(timeZone),
    retry: false,
  });
  const tagHierarchyQuery = useQuery({
    queryKey: ["tag-hierarchy"],
    queryFn: () => getTagHierarchy(),
    retry: false,
  });

  const memos = useMemo(
    () => memosQuery.data?.pages.flatMap((page) => page.memos) ?? [],
    [memosQuery.data],
  );
  const displayedMemos = isSemanticSearch ? semanticMemos : memos;
  const attachmentsByMemo = useMemo(
    () =>
      new Map(
        displayedMemos.map(
          (memo) => [memo.name, memo.attachments ?? []] as const,
        ),
      ),
    [displayedMemos],
  );
  const stats = statsQuery.data ?? EMPTY_STATS;

  const {
    deleteTagMutation,
    handleMutationError,
    hardDeleteMutation,
    invalidateWorkspace,
    renameTagMutation,
    restoreMutation,
    sharesByMemo,
    shareMutation,
    trashMutation,
    updateMutation,
  } = useMemoMutations();

  const { handleExport, handleImportFile } = useDataTransfer({
    handleMutationError,
    invalidateWorkspace,
  });

  const { mutate: updateMemo, mutateAsync: updateMemoAsync } = updateMutation;
  const { mutate: trashMemo } = trashMutation;
  const { mutate: restoreMemo } = restoreMutation;
  const { mutate: shareMemo } = shareMutation;
  const { mutateAsync: hardDeleteMemo } = hardDeleteMutation;
  const handleArchive = useCallback(
    (id: string) => {
      const source = displayedMemos.find(
        (item) => item.name === id || item.id === id,
      );
      updateMemo({
        id,
        input: { status: source?.state === "archived" ? "normal" : "archived" },
      });
    },
    [displayedMemos, updateMemo],
  );
  const handlePin = useCallback(
    (id: string, pinned: boolean) => updateMemo({ id, input: { pinned } }),
    [updateMemo],
  );
  const handleUpdate = useCallback(
    async (
      id: string,
      input: { content: string; visibility: MemoVisibility },
    ) => {
      await updateMemoAsync({ id, input });
    },
    [updateMemoAsync],
  );
  const handleHardDelete = useCallback(
    async (id: string) => {
      await hardDeleteMemo(id);
    },
    [hardDeleteMemo],
  );
  const { fetchNextPage, refetch, isFetchNextPageError } = memosQuery;
  const { refetch: refetchSemantic } = semanticResultsQuery;
  const handleLoadMore = useCallback(() => {
    void fetchNextPage();
  }, [fetchNextPage]);
  const handleRetry = useCallback(() => {
    if (isSemanticSearch) void refetchSemantic();
    else if (isFetchNextPageError) void fetchNextPage();
    else void refetch();
  }, [
    isSemanticSearch,
    isFetchNextPageError,
    fetchNextPage,
    refetch,
    refetchSemantic,
  ]);
  const isUpdating = isSemanticSearch
    ? semanticResultsQuery.isFetching
    : memosQuery.isFetching && !memosQuery.isFetchingNextPage;
  const hasFilters = Boolean(query.trim() || activeTag || untagged);

  const renderExplorer = (importInputId: string, onNavigate?: () => void) => (
    <FlareMoExplorer
      activeTag={activeTag}
      activeView={view}
      headerAction={
        <div className="mr-8 flex items-center gap-1 lg:mr-0">
          <NotificationBell />
          <UpdateStatus />
          <Button
            asChild
            aria-label={t("auth.accountTitle")}
            size="icon-sm"
            variant="ghost"
          >
            <Link
              onClick={onNavigate}
              title={t("auth.accountTitle")}
              to="/account"
            >
              <SettingsIcon />
            </Link>
          </Button>
        </div>
      }
      footer={
        <div className="flex items-center gap-1 text-muted-foreground">
          <Button
            aria-label={t("language.toggle")}
            className="w-12 px-2"
            size="sm"
            title={t("language.toggle")}
            variant="ghost"
            onClick={toggleLocale}
          >
            <LanguagesIcon data-icon="inline-start" />
            <span className="text-xs font-medium">{t("language.next")}</span>
          </Button>
          <Button
            aria-label={t("common.export")}
            size="icon-sm"
            title={t("common.export")}
            variant="ghost"
            onClick={() => void handleExport()}
          >
            <DownloadIcon />
          </Button>
          <Button asChild size="icon-sm" variant="ghost">
            <label
              aria-label={t("common.import")}
              htmlFor={importInputId}
              title={t("common.import")}
            >
              <UploadIcon />
              <Input
                accept="application/json"
                className="hidden"
                id={importInputId}
                type="file"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  try {
                    const text = await file.text();
                    void handleImportFile(JSON.parse(text) as unknown);
                  } catch {
                    toast.error(t("toast.invalidImport"));
                  }
                }}
              />
            </label>
          </Button>
        </div>
      }
      stats={stats}
      hierarchy={tagHierarchyQuery.data?.tags ?? []}
      untagged={untagged}
      onDeleteTag={(tag) => deleteTagMutation.mutate(tag)}
      onRenameTag={(from, to) => renameTagMutation.mutate({ from, to })}
      onTagChange={setActiveTag}
      onUntaggedChange={setUntagged}
      onViewChange={setView}
      onNavigate={onNavigate}
    />
  );

  return (
    <div className="h-svh overflow-hidden bg-background">
      <div className="mx-auto flex h-full w-full max-w-[950px]">
        <div className="no-scrollbar hidden h-full w-[312px] shrink-0 overflow-y-auto border-r bg-background lg:block">
          {renderExplorer("flaremo-import-file-desktop")}
        </div>
        <div className="flex h-full min-w-0 flex-1 flex-col">
          <header
            className={cn(
              "z-20 shrink-0 border-b bg-background/90 backdrop-blur-md motion-safe:transition-[border-color,box-shadow] motion-safe:duration-200",
              isTimelineScrolled
                ? "border-border shadow-xs"
                : "border-transparent",
            )}
          >
            <div className="flex h-14 items-center gap-2 px-5 lg:px-3">
              <Sheet open={mobileSheetOpen} onOpenChange={setMobileSheetOpen}>
                <SheetTrigger asChild>
                  <Button
                    aria-label={t("sidebar.toggle")}
                    className="lg:hidden"
                    size="icon-sm"
                    variant="ghost"
                  >
                    <MenuIcon />
                  </Button>
                </SheetTrigger>
                <SheetContent
                  className="w-[312px] overflow-hidden p-0"
                  side="left"
                >
                  <SheetTitle className="sr-only">
                    {t("sidebar.title")}
                  </SheetTitle>
                  <div
                    className="no-scrollbar h-full overflow-y-auto overscroll-contain"
                    data-testid="mobile-sidebar-scroll"
                  >
                    {renderExplorer("flaremo-import-file-mobile", () =>
                      setMobileSheetOpen(false),
                    )}
                  </div>
                </SheetContent>
              </Sheet>
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <span className="hidden text-muted-foreground sm:inline">
                  /
                </span>
                <div className="truncate px-1.5 py-1 text-sm font-semibold">
                  {dayFilter
                    ? formatDayTitle(dayFilter, locale)
                    : query.trim()
                      ? t("search.results")
                      : viewTitle(view, t)}
                </div>
              </div>
              <WorkspaceSearch
                className="hidden w-[280px] min-w-0 shrink md:block"
                inputRef={desktopSearchRef}
                onToggleSemantic={semanticEnabled ? toggleSemantic : undefined}
                query={dayFilter ? "" : query}
                semanticMode={semanticMode}
                onQueryChange={setQuery}
                isPending={isUpdating}
              />
            </div>
          </header>
          <main
            className="mx-auto min-h-0 w-full max-w-[640px] flex-1 overflow-y-auto px-5 pt-1 pb-8 lg:px-3"
            onScroll={(event) => {
              const scrolled = event.currentTarget.scrollTop > 4;
              setIsTimelineScrolled((prev) =>
                prev === scrolled ? prev : scrolled,
              );
            }}
          >
            <WorkspaceSearch
              className="mb-3 md:hidden motion-safe:animate-rise"
              inputRef={mobileSearchRef}
              onToggleSemantic={semanticEnabled ? toggleSemantic : undefined}
              query={dayFilter ? "" : query}
              semanticMode={semanticMode}
              onQueryChange={setQuery}
              isPending={isUpdating}
            />
            <div className="flex flex-col gap-3">
              <WorkspaceComposer
                visible={view === "all"}
                composeRequested={composeRequested}
              />
              {hasFilters && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground motion-safe:animate-rise">
                  {query.trim() && !dayFilter && !isSemanticSearch && (
                    <span className="flex items-center gap-1.5 rounded-md bg-muted px-2 py-1">
                      {t("search.globalScope")}
                      <InfoTip text={t("search.syntaxHint")} />
                    </span>
                  )}
                  {dayFilter && (
                    <span className="flex items-center gap-1 rounded-md bg-muted px-2 py-1">
                      <CalendarIcon
                        aria-hidden="true"
                        className="size-3 shrink-0"
                      />
                      {formatDayTitle(dayFilter, locale)}
                      <button
                        aria-label={t("filter.clearDate")}
                        className="-mr-1 rounded p-0.5 hover:text-foreground"
                        type="button"
                        onClick={() => setQuery("")}
                      >
                        <XIcon className="size-3.5" />
                      </button>
                    </span>
                  )}
                  {activeTag && (
                    <button
                      aria-label={t("filter.clearTag", { tag: activeTag })}
                      className="flex min-h-8 items-center gap-1 rounded-md bg-muted px-2 py-1 motion-safe:transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      type="button"
                      onClick={() => setActiveTag(undefined)}
                    >
                      #{activeTag}
                      <XIcon aria-hidden="true" className="size-3.5" />
                    </button>
                  )}
                  {untagged && (
                    <button
                      className="flex min-h-8 items-center gap-1 rounded-md bg-muted px-2 py-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      aria-label={t("filter.clearUntagged")}
                      type="button"
                      onClick={() => setUntagged(false)}
                    >
                      {t("explorer.untagged")}
                      <XIcon aria-hidden="true" className="size-3.5" />
                    </button>
                  )}
                  {hasFilters && (
                    <button
                      className="rounded-md px-2 py-1 motion-safe:transition-colors hover:bg-muted hover:text-foreground"
                      type="button"
                      onClick={clearFilters}
                    >
                      {t("common.clearFilters")}
                    </button>
                  )}
                </div>
              )}
              <MemoList
                attachmentsByMemo={attachmentsByMemo}
                emptyDescription={
                  isSemanticSearch
                    ? t("search.semanticEmpty")
                    : hasFilters
                      ? t("list.filteredEmptyDescription")
                      : view === "archived"
                        ? t("list.archiveEmptyDescription")
                        : view === "trashed"
                          ? t("list.trashEmptyDescription")
                          : undefined
                }
                hasError={
                  isSemanticSearch
                    ? semanticResultsQuery.isError
                    : memosQuery.isError
                }
                hasNextPage={
                  isSemanticSearch ? false : Boolean(memosQuery.hasNextPage)
                }
                isFetchingNextPage={
                  isSemanticSearch ? false : memosQuery.isFetchingNextPage
                }
                isLoading={
                  isSemanticSearch
                    ? semanticResultsQuery.isLoading
                    : memosQuery.isLoading
                }
                memos={displayedMemos}
                searchQuery={searchQuery || undefined}
                sharesByMemo={sharesByMemo}
                onArchive={handleArchive}
                onHardDelete={handleHardDelete}
                onLoadMore={handleLoadMore}
                onPin={handlePin}
                onRestore={restoreMemo}
                onRetry={handleRetry}
                onShare={shareMemo}
                onTagClick={setActiveTag}
                onTrash={trashMemo}
                onUpdate={handleUpdate}
                onClearFilters={hasFilters ? clearFilters : undefined}
                isUpdating={isUpdating}
                isPaginationError={!isSemanticSearch && isFetchNextPageError}
                isRetrying={
                  isSemanticSearch
                    ? semanticResultsQuery.isFetching
                    : memosQuery.isFetching
                }
                emptyTitle={
                  hasFilters
                    ? t("list.filteredEmptyTitle")
                    : view === "all"
                      ? t("list.emptyTitle")
                      : view === "archived"
                        ? t("list.archiveEmptyTitle")
                        : t("list.trashEmptyTitle")
                }
              />
            </div>
          </main>
        </div>
      </div>
      <Dialog open={shortcutsOpen} onOpenChange={setShowShortcutsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("shortcuts.title")}</DialogTitle>
            <DialogDescription>{t("shortcuts.subtitle")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col divide-y divide-border/60">
            {(
              [
                ["shortcuts.search", "⌘K / /"],
                ["shortcuts.composer", "C"],
                ["shortcuts.send", "Enter"],
                ["shortcuts.linebreak", "Shift + Enter"],
                ["shortcuts.saveEdit", "⌘Enter"],
              ] as const
            ).map(([key, combo]) => (
              <div
                className="flex items-center justify-between gap-3 py-2 text-sm"
                key={key}
              >
                <span className="text-muted-foreground">
                  {t(key as TranslationKey)}
                </span>
                <kbd className="rounded-md border bg-muted px-2 py-0.5 font-mono text-xs">
                  {combo}
                </kbd>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function viewTitle(view: ViewMode, t: (key: TranslationKey) => string) {
  switch (view) {
    case "archived":
      return t("view.archive");
    case "trashed":
      return t("view.trash");
    default:
      return t("view.timeline");
  }
}

export default function App() {
  return (
    <>
      <PwaUpdatePrompt />
      <AppRoutes />
    </>
  );
}
