/**
 * Editor image insertion: pasted or dropped image files become inline
 * `/file/attachments/` references at the caret. The helpers are pure so the
 * caret math stays unit-testable; upload orchestration lives in the callers.
 */

/** Keeps only image files from a clipboard or drag payload. */
export function extractImageFiles(files: ArrayLike<File>): File[] {
  return Array.from(files).filter((file) =>
    file.type.toLowerCase().startsWith("image/"),
  );
}

/**
 * Markdown for one inline reference. The filename is URL-encoded so spaces or
 * parentheses cannot break the link target, and square brackets are stripped
 * from the alt text so the image syntax stays intact.
 */
export function inlineImageMarkdown(id: string, filename: string): string {
  const alt = filename.replace(/[[\]]/g, "");
  return `![${alt}](/file/attachments/${id}/${encodeURIComponent(filename)})`;
}

/**
 * Splices a snippet into the content at the caret. `offset` is a selection
 * snapshot taken when the paste happened; a selection is replaced. Returns the
 * caret position right after the snippet so consecutive insertions can chain.
 */
export function insertSnippetAt(
  content: string,
  offset: number,
  snippet: string,
): { content: string; caret: number } {
  const at = Math.max(0, Math.min(offset, content.length));
  const before = content.slice(0, at);
  const after = content.slice(at);
  const glueBefore = before !== "" && !before.endsWith("\n") ? " " : "";
  const glueAfter = after === "" || after.startsWith("\n") ? "" : "\n";
  const inserted = `${glueBefore}${snippet}${glueAfter}`;
  return {
    content: `${before}${inserted}${after}`,
    caret: before.length + inserted.length,
  };
}
