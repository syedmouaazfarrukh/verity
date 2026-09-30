/** Client-side checks shared by every upload entry point (Upload page, dashboard drop zone). */
export const MAX_UPLOAD_BYTES = 200 * 1024;
export const UPLOAD_ACCEPT = ".md,.txt,text/markdown,text/plain";

/** Returns a plain-English problem, or null when the file can be sent. */
export function checkUploadFile(f: File): string | null {
  if (!/\.(md|txt)$/i.test(f.name)) return "Only .md or .txt files can be uploaded.";
  if (f.size > MAX_UPLOAD_BYTES) return "That file is larger than 200 KB.";
  return null;
}
