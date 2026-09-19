import { describe, expect, it } from "vitest";
import {
  extractImageFiles,
  inlineImageMarkdown,
  insertSnippetAt,
} from "./image-insert";

describe("extractImageFiles", () => {
  it("keeps images and drops everything else", () => {
    const png = new File(["x"], "a.png", { type: "image/png" });
    const jpeg = new File(["x"], "b.jpeg", { type: "image/JPEG" });
    const text = new File(["x"], "c.txt", { type: "text/plain" });
    expect(extractImageFiles([png, text, jpeg])).toEqual([png, jpeg]);
  });
});

describe("inlineImageMarkdown", () => {
  it("encodes the filename into the URL and keeps alt readable", () => {
    expect(inlineImageMarkdown("id-1", "my shot (1).png")).toBe(
      "![my shot (1).png](/file/attachments/id-1/my%20shot%20(1).png)",
    );
  });

  it("strips square brackets from the alt text", () => {
    expect(inlineImageMarkdown("id-1", "[notes] photo.png")).toBe(
      "![notes photo.png](/file/attachments/id-1/%5Bnotes%5D%20photo.png)",
    );
  });
});

describe("insertSnippetAt", () => {
  it("appends to the end with a leading space", () => {
    expect(insertSnippetAt("hello", 5, "![a](u)")).toEqual({
      content: "hello ![a](u)",
      caret: "hello ![a](u)".length,
    });
  });

  it("splits lines around the snippet", () => {
    expect(insertSnippetAt("first\nsecond", 5, "![a](u)")).toEqual({
      content: "first ![a](u)\nsecond",
      caret: "first ![a](u)".length,
    });
  });

  it("clamps an out-of-range offset", () => {
    expect(insertSnippetAt("abc", 99, "![a](u)")).toEqual({
      content: "abc ![a](u)",
      caret: "abc ![a](u)".length,
    });
  });
});
