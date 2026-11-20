import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function opt(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

export function req(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing ${name}. Add it to .env (local) or the GitHub repository secrets.`);
  return v;
}

export const config = {
  // Research + script (Gemini, with Google Search grounding for real, current GTA 6 news)
  geminiTextModel: opt("GEMINI_TEXT_MODEL", "gemini-3.8-flash"),
  /** Used when the main text model stays overloaded or out of quota. Empty to disable. */
  geminiTextFallback: opt("GEMINI_TEXT_FALLBACK", "gemini-3.5-flash-lite"),

  // Visuals
  /** "gemini" = AI background shot per scene, "off" = code-drawn neon backgrounds only (free). */
  imageProvider: opt("IMAGE_PROVIDER", "gemini") as "gemini" | "off",
  geminiImageModel: opt("GEMINI_IMAGE_MODEL", "gemini-3.1-flash-image-preview"),
  geminiImageFallback: opt("GEMINI_IMAGE_FALLBACK", "gemini-2.5-flash-image"),

  // Voice
  /** gemini (default), kokoro (free offline voice, also the automatic fallback) or espeak (robot, tests). */
  ttsProvider: opt("TTS_PROVIDER", "gemini") as "gemini" | "kokoro" | "espeak",
  geminiTtsModel: opt("GEMINI_TTS_MODEL", "gemini-3.8-flash-tts"),
  geminiTtsFallback: opt("GEMINI_TTS_FALLBACK", "gemini-3.8-flash-lite-tts"),
  /** Prebuilt Gemini voice. Punchy narrator voices: Fenrir, Orus, Charon, Puck. */
  geminiVoice: opt("GEMINI_VOICE", "Fenrir"),
  geminiStyle: opt("GEMINI_STYLE", "energetic gaming-news narrator, fast and punchy, hyped but clear, like a viral Shorts voiceover"),
  /** Kokoro voice used for the free fallback. */
  kokoroVoice: opt("KOKORO_VOICE", "am_michael"),
  /** Use Kokoro automatically when Gemini TTS fails or is out of quota. */
  ttsFallbackToKokoro: opt("TTS_FALLBACK_KOKORO", "true") === "true",

  // Upload
  /** "schedule" = private now, public at PUBLISH_TIME · "private" = you publish · "public" = public now. */
  uploadMode: opt("UPLOAD_MODE", "schedule") as "schedule" | "private" | "public",
  publishTime: opt("PUBLISH_TIME", "19:00"),
  publishUtcOffset: Number(opt("PUBLISH_UTC_OFFSET", "5")),
  publishDelayDays: Number(opt("PUBLISH_DELAY_DAYS", "0")),
  facebookGraphVersion: opt("FACEBOOK_GRAPH_VERSION", "v26.0"),

  python: opt("PYTHON", "python3"),

  paths: {
    brief: path.join(ROOT, "channel/brief.md"),
    history: path.join(ROOT, "data/history.json"),
    sample: path.join(ROOT, "data/sample-reel.json"),
    music: path.join(ROOT, "assets/music"),
    render: path.join(ROOT, "render"),
    out: path.join(ROOT, "out"),
  },
};
