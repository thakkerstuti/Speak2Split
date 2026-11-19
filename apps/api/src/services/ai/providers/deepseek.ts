import { AiNotConfiguredError, AiProvider } from "../types";
import { getApiKey, models } from "../config";
import { chatJson } from "./openai-compatible";

export const deepSeekProvider: AiProvider = {
  name: "deepseek",
  completeJson(req) {
    const apiKey = getApiKey("deepseek");
    if (!apiKey) throw new AiNotConfiguredError("DEEPSEEK_API_KEY is not configured");
    return chatJson({ label: "DeepSeek", url: "https://api.deepseek.com/v1/chat/completions", apiKey, model: models.deepseekChat(), req });
  },
};
