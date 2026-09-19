import type { MemoDto } from "@flaremo/contracts";
import { expect, test } from "@playwright/test";

function note(id: string, overrides: Partial<MemoDto> = {}): MemoDto {
  return {
    id,
    name: `memos/${id}`,
    creator: "users/local-owner",
    content: `Workspace note ${id}`,
    visibility: "private",
    state: "normal",
    pinned: false,
    payload: {},
    create_time: "2026-09-01T00:00:00Z",
    update_time: "2026-09-01T00:00:00Z",
    display_time: "2026-09-01T00:00:00Z",
    attachments: [],
    can_manage: true,
    ...overrides,
  };
}

test("keeps loaded cards mounted when pagination fails and retries the missing page", async ({
  page,
}) => {
  const firstPage = Array.from({ length: 30 }, (_, index) =>
    note(`page-${index}`),
  );
  let failNextPage = true;
  await page.route("**/api/app/memos?*", async (route) => {
    const next = new URL(route.request().url()).searchParams.has("page_token");
    if (next && failNextPage) {
      await route.fulfill({
        status: 503,
        json: { error: { message: "Temporary failure" } },
      });
    } else {
      await route.fulfill({
        json: {
          memos: next ? [note("last-page")] : firstPage,
          next_page_token: next ? undefined : "next",
        },
      });
    }
  });
  await page.goto("/");
  await expect(page.locator("article")).toHaveCount(30);
  const firstCard = await page.locator("article").first().elementHandle();
  await page.getByRole("button", { name: /load more|加载更多/i }).click();
  await expect(page.getByRole("alert")).toContainText(
    /previously loaded|已加载/i,
  );
  await expect(page.locator("article")).toHaveCount(30);
  expect(await firstCard?.evaluate((element) => element.isConnected)).toBe(
    true,
  );
  failNextPage = false;
  await page.getByRole("button", { name: /retry|重试/i }).click();
  await expect(page.locator("article")).toHaveCount(31);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByText("Workspace note last-page", { exact: true }),
  ).toBeVisible();
});

test("keeps an edited card visible when background refresh fails", async ({
  page,
}) => {
  let failRefresh = false;
  await page.route("**/api/app/memos?*", async (route) => {
    await route.fulfill(
      failRefresh
        ? { status: 503, json: { error: { message: "Temporary failure" } } }
        : {
            json: {
              memos: [note("background-refresh", { state: "archived" })],
            },
          },
    );
  });
  await page.route("**/api/app/memos/background-refresh", async (route) => {
    failRefresh = true;
    await route.fulfill({
      json: note("background-refresh", { pinned: true, state: "archived" }),
    });
  });
  await page.goto("/?q=in%3Aarchive");
  await page
    .getByRole("button", { name: /actions|操作/i })
    .first()
    .click();
  await page.getByRole("menuitem", { name: /^(pin|置顶)$/i }).click();
  await expect(page.getByRole("alert")).toContainText(
    /previously loaded|已加载/i,
  );
  await expect(
    page.getByText("Workspace note background-refresh", { exact: true }),
  ).toBeVisible();
  failRefresh = false;
  await page.getByRole("button", { name: /retry|重试/i }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("waits for composition to finish and cancels obsolete search requests", async ({
  page,
}) => {
  const queries: string[] = [];
  const cancelled: string[] = [];
  let releaseSlow: (() => void) | undefined;
  page.on("requestfailed", (request) => cancelled.push(request.url()));
  await page.route("**/api/app/memos?*", async (route) => {
    const q = new URL(route.request().url()).searchParams.get("q");
    if (q) queries.push(q);
    if (q === "slow-query")
      await new Promise<void>((resolve) => {
        releaseSlow = resolve;
      });
    await route.fulfill({ json: { memos: [note(q ?? "initial")] } });
  });
  await page.goto("/");
  const search = page.getByRole("textbox", { name: /search|搜索/i });
  await search.dispatchEvent("compositionstart");
  await search.fill("输入中的文字");
  await page.waitForTimeout(400);
  expect(queries).toEqual([]);
  await search.dispatchEvent("compositionend");
  await expect.poll(() => queries).toEqual(["输入中的文字"]);
  await search.fill("slow-query");
  await expect.poll(() => Boolean(releaseSlow)).toBe(true);
  await search.fill("latest-query");
  await expect(
    page.locator("article").filter({ hasText: "Workspace note latest-query" }),
  ).toBeVisible();
  await expect
    .poll(() => cancelled.some((url) => url.includes("slow-query")))
    .toBe(true);
  releaseSlow?.();
  await expect(
    page.getByText("Workspace note slow-query", { exact: true }),
  ).toHaveCount(0);
  await search.press("Escape");
  await expect(search).toHaveValue("");
  await expect
    .poll(() => new URL(page.url()).searchParams.has("q"))
    .toBe(false);
});

test("uses only semantic requests after choosing semantic search and preserves its attachments", async ({
  page,
}) => {
  const ordinaryQueries: string[] = [];
  const semanticQueries: string[] = [];
  await page.route("**/api/app/usage/vector", (route) =>
    route.fulfill({
      json: {
        plan: { limits: { semanticSearchQueriesPerMonth: 100 } },
      },
    }),
  );
  await page.route("**/api/app/memos?*", (route) => {
    ordinaryQueries.push(route.request().url());
    return route.fulfill({ json: { memos: [note("timeline")] } });
  });
  await page.route("**/api/app/search/semantic?*", (route) => {
    semanticQueries.push(route.request().url());
    return route.fulfill({
      json: {
        degraded: false,
        memos: [
          note("semantic", {
            attachments: [
              {
                id: "document",
                name: "attachments/document",
                filename: "reading-notes.txt",
                content_type: "text/plain",
                size: 42,
                state: "ready",
                memo: "memos/semantic",
                create_time: "2026-09-01T00:00:00Z",
                update_time: "2026-09-01T00:00:00Z",
                preview_url: "/file/attachments/document/reading-notes.txt",
                download_url: "/file/attachments/document/reading-notes.txt",
              },
            ],
          }),
        ],
      },
    });
  });
  await page.goto("/");
  await expect(
    page.getByText("Workspace note timeline", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /semantic search|语义搜索/i }).click();
  await expect(
    page.getByText("Workspace note timeline", { exact: true }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: /search|搜索/i }).fill("阅读的想法");
  await expect(
    page.getByRole("link", { name: /reading-notes.txt/i }),
  ).toBeVisible();
  expect(semanticQueries).toHaveLength(1);
  expect(
    ordinaryQueries.every((url) => !new URL(url).searchParams.has("q")),
  ).toBe(true);
  await page.getByRole("button", { name: /clear search|清除搜索/i }).click();
  await expect(
    page.getByText("Workspace note timeline", { exact: true }),
  ).toBeVisible();
});

test("clears every filter in one mobile action and explains empty states", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/app/memos?*", (route) => {
    const params = new URL(route.request().url()).searchParams;
    return route.fulfill({
      json: {
        memos:
          params.has("q") || params.has("tag") || params.has("untagged")
            ? []
            : [note("unfiltered")],
      },
    });
  });
  await page.goto("/?q=no-match&tag=reading&untagged=true");
  await expect(
    page.getByText(/no matching notes|没有找到相关记录/i),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /clear filters|清除筛选/i })
    .first()
    .click();
  await expect(
    page.getByText("Workspace note unfiltered", { exact: true }),
  ).toBeVisible();
  const params = new URL(page.url()).searchParams;
  for (const key of ["q", "tag", "untagged"])
    expect(params.has(key)).toBe(false);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});

test("keeps the draft when moving between the timeline and archive", async ({
  page,
}) => {
  await page.goto("/");
  const composer = page.locator("#flaremo-composer-input");
  await composer.fill("Draft that survives workspace navigation");
  const navigation = page.getByRole("navigation", { name: /navigation|导航/i });
  await navigation.getByRole("button", { name: /archive|归档/i }).click();
  await expect(composer).toHaveCount(0);
  await navigation.getByRole("button", { name: /timeline|时间线/i }).click();
  await expect(composer).toHaveValue(
    "Draft that survives workspace navigation",
  );
});

async function pasteImages(
  page: import("@playwright/test").Page,
  count: number,
) {
  await page
    .locator("#flaremo-composer-input")
    .evaluate((element, imageCount) => {
      const clipboard = new DataTransfer();
      for (let index = 0; index < imageCount; index++) {
        clipboard.items.add(
          new File(["local image fixture"], `image-${index}.png`, {
            type: "image/png",
          }),
        );
      }
      element.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: clipboard,
        }),
      );
    }, count);
}

test("preserves text typed while an inline image upload is pending", async ({
  page,
}) => {
  let releaseUpload: (() => void) | undefined;
  await page.route("**/api/v1/attachments", async (route) => {
    await new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });
    await route.fulfill({
      json: {
        id: "inline-image",
        name: "attachments/inline-image",
        filename: "image-0.png",
      },
    });
  });
  await page.goto("/");
  const composer = page.locator("#flaremo-composer-input");
  await composer.fill("Before upload");
  await pasteImages(page, 1);
  await expect.poll(() => Boolean(releaseUpload)).toBe(true);
  await composer.fill("Before upload — text typed while waiting");
  releaseUpload?.();
  await expect(composer).toHaveValue(/text typed while waiting/);
  await expect(composer).toHaveValue(/\/file\/attachments\/inline-image\//);
  await expect(
    page.getByRole("button", { name: /^(send|发送)$/i }),
  ).toBeEnabled();
});

test("releases the composer after the first image of a batch fails", async ({
  page,
}) => {
  let uploads = 0;
  await page.route("**/api/v1/attachments", async (route) => {
    uploads++;
    await route.fulfill({
      status: 503,
      json: { error: { message: "Upload unavailable" } },
    });
  });
  await page.goto("/");
  const composer = page.locator("#flaremo-composer-input");
  await composer.fill("Keep this draft after an upload failure");
  await pasteImages(page, 2);
  await expect(
    page.getByText(/image upload failed|图片上传失败/i),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^(send|发送)$/i }),
  ).toBeEnabled();
  await expect(composer).toHaveValue("Keep this draft after an upload failure");
  expect(uploads).toBe(1);
});
