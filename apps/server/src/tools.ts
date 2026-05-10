import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";

export function createWebSearchTool(): AgentTool<any> {
  return {
    name: "web_search",
    label: "Web Search",
    description: "Search the web for current information. This is currently a stub in Memoryhold v1.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
    }),
    async execute(_toolCallId, params) {
      const query = (params as { query: string }).query;
      return {
        content: [
          {
            type: "text",
            text: `web_search stub: no search provider is configured yet. Query was: ${query}`,
          },
        ],
        details: { query, results: [] },
      };
    },
  };
}
