import { GoogleGenAI } from "@google/genai";
import fs from "node:fs/promises";
import { config, req } from "./config";
import { shouldFallBack, withRetry } from "./retry";

/** Added to every prompt so the shots stay generic and copyright-safe. */
const SAFE =
  "Cinematic vertical 9:16 photograph, moody neon sunset or night lighting, shallow depth of field, rich teal and magenta tones. " +
  "Generic original scene: no text, no letters, no logos, no brand badges, no video game characters, no video game UI or HUD, not a screenshot.";

async function once(model: string, prompt: string, out: string): Promise<void> {
  const ai = new GoogleGenAI({ apiKey: req("GEMINI_API_KEY") });
  const res = await ai.models.generateContent({
    model,
    contents: `${prompt}\n\n${SAFE}`,
    config: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "9:16" } },
  });
  const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part?.inlineData?.data) throw new Error(`No image returned (${res.candidates?.[0]?.finishReason ?? "no candidates"})`);
  await fs.writeFile(out, Buffer.from(part.inlineData.data, "base64"));
}

/**
 * One background per scene. Never fatal: a scene whose image fails gets the code-drawn neon
 * background instead, so the reel always renders.
 */
export async function makeImages(prompts: string[], outPaths: string[]): Promise<(string | null)[]> {
  if (config.imageProvider === "off") return prompts.map(() => null);
  const results: (string | null)[] = [];
  let model = config.geminiImageModel;
  for (const [i, prompt] of prompts.entries()) {
    try {
      try {
        await withRetry(`image ${i + 1} (${model})`, () => once(model, prompt, outPaths[i]), 3);
      } catch (err) {
        if (!shouldFallBack(err) || !config.geminiImageFallback || model === config.geminiImageFallback) throw err;
        console.warn(`  ${model} busy or out of quota; switching to ${config.geminiImageFallback}`);
        model = config.geminiImageFallback;
        await withRetry(`image ${i + 1} (${model})`, () => once(model, prompt, outPaths[i]), 3);
      }
      results.push(outPaths[i]);
      console.log(`  image ${i + 1}: ok`);
    } catch (err) {
      console.warn(`  image ${i + 1}: failed (${String((err as Error)?.message ?? err).slice(0, 160)}); using neon background`);
      results.push(null);
    }
  }
  return results;
}
