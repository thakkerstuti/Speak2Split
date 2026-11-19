import { AiProvider, ProviderName } from "../types";
import { assemblyAiProvider } from "./assemblyai";
import { groqProvider } from "./groq";
import { geminiProvider } from "./gemini";
import { openAiProvider } from "./openai";
import { deepSeekProvider } from "./deepseek";
import { googleSpeechProvider, googleVisionProvider } from "./google";

export const PROVIDER_REGISTRY: Record<ProviderName, AiProvider> = {
  assemblyai: assemblyAiProvider,
  groq: groqProvider,
  gemini: geminiProvider,
  openai: openAiProvider,
  deepseek: deepSeekProvider,
  google_vision: googleVisionProvider,
  google_speech: googleSpeechProvider,
};

export { resetAssemblyAiCircuitBreaker } from "./assemblyai";
