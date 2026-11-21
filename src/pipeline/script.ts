import { GoogleGenAI } from "@google/genai";
import fs from "node:fs/promises";
import { config, req } from "./config";
import type { HistoryEntry } from "./history";
import { ReelScript } from "./reel";
import { shouldFallBack, withRetry } from "./retry";

const FORMATS = ["news", "facts", "tips", "theory", "comparison"] as const;

const REEL_SCHEMA = {
  type: "object",
  required: ["title", "description", "tags", "topic", "format", "hook", "scenes", "sources"],
  properties: {
    title: { type: "string", description: "YouTube Shorts title, max 70 characters, curiosity-driven but truthful, includes 'GTA 6', ends with one emoji." },
    description: { type: "string", description: "2–3 sentences summarising the reel. Mention that it is a fan channel, not affiliated with Rockstar Games. No links." },
    tags: { type: "array", items: { type: "string" }, description: "6–12 search tags." },
    topic: { type: "string", description: "The single idea of this reel in a few words." },
    format: { type: "string", enum: [...FORMATS] },
    hook: { type: "string", description: "On-screen text from the first frame, max 32 characters, ALL CAPS friendly, e.g. 'GTA 6 JUST BROKE A RECORD'." },
    scenes: {
      type: "array",
      description: "4–6 scenes in order. Total spoken words 45–75 so the reel is 15–28 seconds.",
      items: {
        type: "object",
        required: ["line", "onscreen", "visual"],
        properties: {
          line: { type: "string", description: "Voiceover sentence for this scene, 6–18 words, punchy spoken English." },
          onscreen: { type: "string", description: "Big text on screen, max 26 characters, the key word/number of the line, e.g. '40 BILLION VIEWS'." },
          counter: {
            type: "object",
            description: "Optional. Use only when the scene's key fact is a single number worth animating.",
            required: ["to"],
            properties: {
              to: { type: "number" },
              prefix: { type: "string", description: "e.g. '$'" },
              suffix: { type: "string", description: "e.g. '+', ' MILLION', '%'" },
            },
          },
          visual: {
            type: "string",
            description:
              "Background image prompt: a GENERIC cinematic photo that fits the line (tropical neon city, unbranded sports car, palm-lined beach road, night police lights, cash stacks, gamer at a glowing setup). No game characters, no logos, no text, no real brands, no screenshots.",
          },
        },
      },
    },
    sources: { type: "array", items: { type: "string" }, description: "URLs or outlet names from the research that back the facts used." },
  },
} as const;

function ai() {
  return new GoogleGenAI({ apiKey: req("GEMINI_API_KEY") });
}

async function generate(build: (model: string) => Promise<{ text?: string }>, label: string): Promise<string> {
  const call = (model: string) => withRetry(`${label} (${model})`, () => build(model));
  let res;
  try {
    res = await call(config.geminiTextModel);
  } catch (err) {
    if (!shouldFallBack(err) || !config.geminiTextFallback) throw err;
    console.warn(`  ${config.geminiTextModel} is busy or out of quota; using ${config.geminiTextFallback}`);
    res = await call(config.geminiTextFallback);
  }
  if (!res.text) throw new Error(`Gemini returned no text for ${label}.`);
  return res.text;
}

function pickFormat(history: HistoryEntry[]): (typeof FORMATS)[number] {
  const recent = history.slice(-4).map((h) => h.format);
  const options = FORMATS.filter((f) => f !== recent[recent.length - 1]);
  // News comes up most often because it is what people search for after launch.
  const weighted = options.flatMap((f) => (f === "news" ? [f, f, f] : f === "facts" ? [f, f] : [f]));
  return weighted[Math.floor(Math.random() * weighted.length)];
}

/** Step 1: real, current facts via Google Search grounding. */
async function research(format: string, history: HistoryEntry[]): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const done = history.slice(-40).map((h) => `- ${h.topic}`).join("\n") || "- none yet";
  const prompt = `Today is ${today}. You research topics for a daily GTA 6 (Grand Theft Auto VI) Shorts channel.
Format for today's reel: ${format}.
Topics already covered (pick something different):
${done}

Search the web and find ONE strong topic for this format, with the newest information available.
Return research notes: the topic, 4–8 concrete verified facts with numbers/dates, and the source (outlet + URL) for each.
For "theory": describe a real fan theory being discussed and say clearly it is unconfirmed.
Do not invent anything. If something is a rumour, say so.`;
  try {
    return await generate(
      (model) => ai().models.generateContent({ model, contents: prompt, config: { tools: [{ googleSearch: {} }], temperature: 0.7 } }),
      "research",
    );
  } catch (err) {
    if (!shouldFallBack(err)) throw err;
    // Search grounding has its own (small) free quota. Fall back to well-established facts only.
    console.warn("  Google Search grounding unavailable (quota); researching from stable, well-known facts instead.");
    if (process.env.GITHUB_ACTIONS) console.log("::warning title=No web search::Search grounding quota exhausted; reel uses well-known facts, no fresh news.");
    const offline = `You prepare notes for a GTA 6 (Grand Theft Auto VI) Shorts channel. Web search is unavailable today.
Pick ONE evergreen topic for the format "${format === "news" ? "facts" : format}" that is NOT in this list:
${done}
Use only facts that were officially announced by Rockstar Games / Take-Two or widely and consistently reported
(setting, the state of Leonida and its places, trailer view records, the GTA series' history, sales records of earlier games).
NEVER mention release dates, release windows, delays, platforms, prices, editions or "coming soon": those change and your
knowledge may be out of date. Do NOT include anything that may have changed recently, rumours as facts, or numbers you are not sure about.
Return the topic, 4–8 facts, and for each the outlet or official source it is known from.`;
    return generate((model) => ai().models.generateContent({ model, contents: offline, config: { temperature: 0.6 } }), "research (offline)");
  }
}

/** Step 2: turn the notes into a reel script (strict JSON). */
async function writeFromNotes(notes: string, format: string): Promise<unknown> {
  const brief = await fs.readFile(config.paths.brief, "utf8");
  const prompt = `You write daily vertical Shorts/Reels for a faceless GTA 6 news & facts channel.

<channel_brief>
${brief}
</channel_brief>

<research_notes>
${notes}
</research_notes>

Write today's reel (format: ${format}) using ONLY facts in the research notes.
- Scene 1's line is the hook: the most surprising fact, no greeting, under 2 seconds to the point.
- 4–6 scenes, 45–75 spoken words total. One fact per scene. Numbers in the voiceover are written as words a narrator says naturally.
- onscreen text is short and big (key number or phrase), not a copy of the line.
- Use counter only for a single big number in that scene.
- Visual prompts follow the copyright rules in the brief exactly.
- The last scene ends on a strong line (no call to subscribe; the video adds its own follow card).
Return JSON matching the schema.`;
  const text = await generate(
    (model) =>
      ai().models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: "application/json", responseJsonSchema: REEL_SCHEMA, temperature: 0.9 },
      }),
    "script",
  );
  return JSON.parse(text);
}

export async function writeReel(history: HistoryEntry[]): Promise<{ script: ReelScript; notes: string }> {
  const format = pickFormat(history);
  console.log(`  format: ${format}`);
  const notes = await research(format, history);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const parsed = ReelScript.safeParse(await writeFromNotes(notes, format));
      if (parsed.success) return { script: parsed.data, notes };
      console.warn(`Script attempt ${attempt} failed validation:`, parsed.error.issues.slice(0, 3));
    } catch (e) {
      if (attempt === 3) throw e;
      console.warn(`Script attempt ${attempt} failed:`, String(e).slice(0, 300));
    }
  }
  throw new Error("Could not get a valid reel script after 3 attempts.");
}
