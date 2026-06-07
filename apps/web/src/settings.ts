const MODEL_SETTINGS_KEY = "memoryhold.settings";

export function savedModelSettings(): {
  provider?: string;
  modelId?: string;
  thinkingLevel?: string;
} {
  try {
    return JSON.parse(localStorage.getItem(MODEL_SETTINGS_KEY) || "{}");
  } catch {
    return {};
  }
}

export function saveModelSettings(
  provider: string,
  modelId: string,
  thinkingLevel: string,
) {
  localStorage.setItem(
    MODEL_SETTINGS_KEY,
    JSON.stringify({ provider, modelId, thinkingLevel }),
  );
}
