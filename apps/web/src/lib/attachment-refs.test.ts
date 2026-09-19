import { describe, expect, it } from "vitest";
import {
  extractReferencedAttachmentIds,
  filterUnreferencedAttachments,
  injectShareTokenIntoFileUrls,
} from "./attachment-refs";

describe("extractReferencedAttachmentIds", () => {
  it("collects unique ids from file URLs", () => {
    const content = [
      "![a](/file/attachments/id-a/photo.png)",
      "text [link](/file/attachments/id-b/doc.pdf) more",
      "![a again](/file/attachments/id-a/photo.png)",
    ].join("\n");
    expect(extractReferencedAttachmentIds(content)).toEqual(
      new Set(["id-a", "id-b"]),
    );
  });

  it("ignores other paths", () => {
    expect(
      extractReferencedAttachmentIds("![x](/api/v1/attachments/id-x/blob)"),
    ).toEqual(new Set());
  });
});

describe("filterUnreferencedAttachments", () => {
  const attachments = [
    { name: "attachments/id-a" },
    { name: "attachments/id-b" },
  ];

  it("drops referenced attachments and keeps the rest", () => {
    const content = "![a](/file/attachments/id-a/photo.png)";
    expect(filterUnreferencedAttachments(attachments, content)).toEqual([
      { name: "attachments/id-b" },
    ]);
  });

  it("keeps everything when the body references nothing", () => {
    expect(filterUnreferencedAttachments(attachments, "plain text")).toEqual(
      attachments,
    );
  });
});

describe("injectShareTokenIntoFileUrls", () => {
  const token = "tok-123";

  it("appends the token to markdown file targets", () => {
    expect(
      injectShareTokenIntoFileUrls(
        "![a](/file/attachments/id-a/photo.png)",
        token,
      ),
    ).toBe("![a](/file/attachments/id-a/photo.png?share_token=tok-123)");
  });

  it("uses & when the target already has a query", () => {
    expect(
      injectShareTokenIntoFileUrls(
        "![a](/file/attachments/id-a/photo.png?disposition=inline)",
        token,
      ),
    ).toBe(
      "![a](/file/attachments/id-a/photo.png?disposition=inline&share_token=tok-123)",
    );
  });

  it("leaves other URLs and fenced code alone", () => {
    const content = [
      "![x](/api/v1/attachments/id-x/blob)",
      "```",
      "![y](/file/attachments/id-y/p.png)",
      "```",
    ].join("\n");
    expect(injectShareTokenIntoFileUrls(content, token)).toBe(content);
  });
});
