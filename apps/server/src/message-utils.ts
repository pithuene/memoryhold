import type { SessionTreeEntry } from "@memoryhold/shared";

export function messageText(message: any): string {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        if (block?.type === "text") return block.text ?? "";
        if (block?.type === "thinking") return block.thinking ?? "";
        if (block?.type === "toolCall") return `[tool call: ${block.name}]`;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

export function entriesToMessages(entries: SessionTreeEntry[]): any[] {
  return entries.filter((entry: any) => entry.type === "message").map((entry: any) => entry.message);
}
