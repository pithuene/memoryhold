export function renderContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((block: any) => typeof block === "string" ? block : block?.type === "text" ? block.text ?? "" : "").filter(Boolean).join("\n");
  return content == null ? "" : JSON.stringify(content, null, 2);
}

export function displayText(message: any) {
  return renderContent(message.content)
    .replace(/\n\n<MEMORYHOLD_ATTACHMENT_CONTEXT>[\s\S]*?<\/MEMORYHOLD_ATTACHMENT_CONTEXT>/g, "")
    .replace(/\n*Attachments saved locally:\n(?:\s*-\s+.*(?:\n|$))+/g, "")
    .trim();
}

export function shouldShowMessage(entry: any): boolean {
  if (entry?.type !== "message") return false;
  const message = entry.message;
  if (message?.role === "toolResult") return false;
  if (message?.role === "assistant" && !displayText(message) && !message?.errorMessage) return false;
  return true;
}

export function messageAttachments(message: any) {
  if (message.attachments?.length) return message.attachments;
  const context = renderContent(message.content).match(/<MEMORYHOLD_ATTACHMENT_CONTEXT>[\s\S]*?<\/MEMORYHOLD_ATTACHMENT_CONTEXT>/)?.[0] ?? "";
  return Array.from(context.matchAll(/Attachment: (.+?) \((.+?), (attachments\/.+?)\)/g)).map((m) => ({ filename: m[1], mimeType: m[2], relativePath: m[3] }));
}

export function isImage(a: any) {
  return a?.mimeType?.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(a?.filename ?? "");
}

export function attachmentKind(filename = "", mimeType = "") {
  const l = filename.toLowerCase();
  if (mimeType === "application/pdf" || l.endsWith(".pdf")) return "PDF";
  if (mimeType.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/.test(l)) return "Image";
  if (mimeType.startsWith("text/") || /\.(txt|md|csv|log)$/.test(l)) return "Document";
  if (/\.(ts|tsx|js|jsx|py|rs|go|java|c|cpp|h|css|html|json)$/.test(l)) return "Code";
  return "File";
}

export function attachmentIcon(filename = "") {
  const l = filename.toLowerCase();
  if (l.endsWith(".pdf")) return "PDF";
  if (/\.(png|jpe?g|gif|webp|svg)$/.test(l)) return "IMG";
  if (/\.(ts|tsx|js|jsx|py|rs|go|java|c|cpp|h|css|html|json|md)$/.test(l)) return "{}";
  return "DOC";
}
