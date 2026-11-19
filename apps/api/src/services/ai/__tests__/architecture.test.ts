/**
 * Guard: only the AI service layer may talk to AI providers or read their keys.
 * Everything else must go through `services/ai` (index.ts).
 */
import fs from "fs";
import path from "path";

const SRC = path.join(__dirname, "../../..");
const AI_DIR = path.join(SRC, "services", "ai");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      out.push(...sourceFiles(p));
    } else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) {
      out.push(p);
    }
  }
  return out;
}

const PROVIDER_HOSTS = /assemblyai\.com|api\.groq\.com|generativelanguage\.googleapis|vision\.googleapis|speech\.googleapis|api\.openai\.com|api\.deepseek\.com|api\.anthropic\.com/;
const AI_KEY_ENV = /process\.env\.(ASSEMBLYAI|GROQ|GEMINI|OPENAI|DEEPSEEK|ANTHROPIC|GOOGLE_VISION|GOOGLE_SPEECH|GOOGLE_API_KEY|STT_PROVIDER|OCR_PROVIDER|AI_)/;
const PROVIDER_SDKS = /from ["'](openai|groq-sdk|@google\/generative-ai|@google\/genai|@google-cloud\/[a-z-]+|assemblyai|@anthropic-ai\/sdk)["']/;

describe("AI service layer boundary", () => {
  const outside = sourceFiles(SRC).filter((f) => !f.startsWith(AI_DIR));

  it("no code outside services/ai contacts an AI provider", () => {
    const offenders = outside.filter((f) => PROVIDER_HOSTS.test(fs.readFileSync(f, "utf8")));
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  it("no code outside services/ai reads AI keys or AI provider settings", () => {
    const offenders = outside.filter((f) => AI_KEY_ENV.test(fs.readFileSync(f, "utf8")));
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  it("no provider SDK is imported anywhere", () => {
    const offenders = sourceFiles(SRC).filter((f) => PROVIDER_SDKS.test(fs.readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("inside services/ai, only providers/ makes provider HTTP calls", () => {
    const aiFiles = sourceFiles(AI_DIR).filter((f) => !f.includes(`${path.sep}providers${path.sep}`));
    const offenders = aiFiles.filter((f) => PROVIDER_HOSTS.test(fs.readFileSync(f, "utf8")));
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });
});
