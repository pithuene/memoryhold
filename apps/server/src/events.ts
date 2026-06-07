import type { ServerEvent } from "@memoryhold/shared";

type Listener = (event: ServerEvent) => void;

export class EventHub {
  private listeners = new Map<string, Set<Listener>>();

  subscribe(sessionSlug: string, listener: Listener): () => void {
    let set = this.listeners.get(sessionSlug);
    if (!set) {
      set = new Set();
      this.listeners.set(sessionSlug, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
      if (set?.size === 0) this.listeners.delete(sessionSlug);
    };
  }

  publish(sessionSlug: string, event: ServerEvent): void {
    for (const listener of this.listeners.get(sessionSlug) ?? [])
      listener(event);
  }
}
