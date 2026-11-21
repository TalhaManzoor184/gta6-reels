import { GoogleGenAI } from "@google/genai";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { durationOf, ffmpeg, toEpisodeWav } from "./audio";
import { config, req } from "./config";
import { shouldFallBack, withRetry } from "./retry";

const run = promisify(execFile);

export type WordTiming = { text: string; start: number; end: number };
export type Voiced = { wavPath: string; duration: number; words: WordTiming[] };

/** Spread words across the clip by character length (no provider gives word timings here). */
function estimateWords(text: string, duration: number): WordTiming[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  const weights = tokens.map((t) => t.replace(/[^\w']/g, "").length + 1.5);
  const total = weights.reduce((a, b) => a + b, 0);
  let t = 0;
  return tokens.map((text, i) => {
    const d = (weights[i] / total) * duration;
    const w = { text, start: t, end: t + d };
    t += d;
    return w;
  });
}

// ---------- Gemini (Interactions API) ----------
async function geminiOnce(model: string, text: string, rawPath: string): Promise<void> {
  const ai = new GoogleGenAI({ apiKey: req("GEMINI_API_KEY") });
  const interaction = await ai.interactions.create({
    model,
    input: [
      {
        type: "user_input",
        content: [{ type: "text" as const, text, annotations: [{ type: "speech_metadata" as const, style: config.geminiStyle }] }],
      },
    ],
    response_format: { type: "audio", mime_type: "audio/wav" },
    generation_config: { speech_config: [{ voice: config.geminiVoice, language: "en-US" }] },
  });
  const data = interaction.output_audio?.data;
  if (!data) throw new Error("Gemini returned no audio.");
  await fs.writeFile(rawPath, Buffer.from(data, "base64"));
}

async function gemini(text: string, rawPath: string): Promise<void> {
  try {
    await withRetry(`voice (${config.geminiTtsModel})`, () => geminiOnce(config.geminiTtsModel, text, rawPath));
  } catch (err) {
    if (!shouldFallBack(err) || !config.geminiTtsFallback) throw err;
    console.warn(`  ${config.geminiTtsModel} is busy or out of quota; using ${config.geminiTtsFallback}`);
    await withRetry(`voice (${config.geminiTtsFallback})`, () => geminiOnce(config.geminiTtsFallback, text, rawPath));
  }
}

type Silence = { start: number; end: number };

async function findSilences(file: string, minPause = 0.15): Promise<Silence[]> {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-i", file, "-af", `silencedetect=noise=-38dB:d=${minPause}`, "-f", "null", "-"], {
    maxBuffer: 16 * 1024 * 1024,
  });
  const out: Silence[] = [];
  let start: number | null = null;
  for (const m of stderr.matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
    if (m[1] === "start") start = Math.max(0, Number(m[2]));
    else if (start !== null) {
      out.push({ start, end: Number(m[2]) });
      start = null;
    }
  }
  return out;
}

/** One pause per line boundary: the longest pause near where the line lengths say it should be. */
function chooseCuts(silences: Silence[], lines: string[], total: number): number[] | null {
  const weights = lines.map((l) => l.replace(/[^\w]/g, "").length + 4);
  const sum = weights.reduce((a, b) => a + b, 0);
  const cand = silences.filter((s) => s.start > 0.1 && s.end < total - 0.1).map((s) => ({ mid: (s.start + s.end) / 2, dur: s.end - s.start }));
  const n = lines.length - 1;
  if (cand.length < n) return null;
  const expected: number[] = [];
  let acc = 0;
  for (let k = 0; k < n; k++) {
    acc += weights[k];
    expected.push((acc / sum) * total);
  }
  const score = (k: number, j: number) => cand[j].dur - 0.15 * Math.abs(cand[j].mid - expected[k]);
  const m = cand.length;
  const best: number[][] = Array.from({ length: n }, () => Array(m).fill(-Infinity));
  const from: number[][] = Array.from({ length: n }, () => Array(m).fill(-1));
  for (let j = 0; j < m; j++) best[0][j] = score(0, j);
  for (let k = 1; k < n; k++)
    for (let j = 0; j < m; j++)
      for (let i = 0; i < j; i++) {
        if (best[k - 1][i] === -Infinity || cand[j].mid - cand[i].mid < 0.4) continue;
        const v = best[k - 1][i] + score(k, j);
        if (v > best[k][j]) {
          best[k][j] = v;
          from[k][j] = i;
        }
      }
  let j = best[n - 1].indexOf(Math.max(...best[n - 1]));
  if (j < 0 || best[n - 1][j] === -Infinity) return null;
  const cuts: number[] = [];
  for (let k = n - 1; k >= 0; k--) {
    cuts.unshift(cand[j].mid);
    j = from[k][j];
  }
  return cuts;
}

/** All lines in ONE Gemini request (free tier allows few TTS calls/day), then cut at the pauses. */
async function voiceWithGemini(lines: string[], outWavs: string[]): Promise<Voiced[] | null> {
  const raw = path.join(path.dirname(outWavs[0]), "voice.raw.wav");
  await gemini(lines.join("\n<short pause>\n"), raw);
  const total = await durationOf(raw);
  // Fast voices leave short pauses: try shorter minimum pause lengths before giving up.
  let cuts: number[] | null = lines.length > 1 ? null : [];
  for (const minPause of [0.15, 0.1, 0.07]) {
    if (cuts) break;
    cuts = chooseCuts(await findSilences(raw, minPause), lines, total);
  }
  if (!cuts) {
    await fs.rm(raw, { force: true });
    return null;
  }
  const bounds = [0, ...cuts, total];
  const voiced: Voiced[] = [];
  for (const [i, out] of outWavs.entries()) {
    const seg = out.replace(/\.wav$/, ".seg.wav");
    await ffmpeg(["-i", raw, "-ss", bounds[i].toFixed(3), "-to", bounds[i + 1].toFixed(3), seg]);
    await toEpisodeWav(seg, out);
    await fs.rm(seg, { force: true });
    const duration = await durationOf(out);
    voiced.push({ wavPath: out, duration, words: estimateWords(lines[i], duration) });
  }
  await fs.rm(raw, { force: true });
  return voiced;
}

/** Free offline voices: Kokoro (natural) or espeak (robot, for tests). One file per line. */
async function voiceOffline(provider: "kokoro" | "espeak", lines: string[], outWavs: string[]): Promise<Voiced[]> {
  const raws = outWavs.map((o) => o.replace(/\.wav$/, ".raw.wav"));
  if (provider === "kokoro") {
    const job = path.join(path.dirname(outWavs[0]), "kokoro-job.json");
    await fs.writeFile(job, JSON.stringify({ voice: config.kokoroVoice, lines, outputs: raws }));
    await run(config.python, [path.join(config.paths.render, "kokoro_tts.py"), job], { maxBuffer: 16 * 1024 * 1024 });
  } else {
    for (const [i, line] of lines.entries()) await run("espeak-ng", ["-v", "en-us+m3", "-s", "165", "-w", raws[i], line]);
  }
  const voiced: Voiced[] = [];
  for (const [i, out] of outWavs.entries()) {
    await toEpisodeWav(raws[i], out);
    await fs.rm(raws[i], { force: true });
    const duration = await durationOf(out);
    voiced.push({ wavPath: out, duration, words: estimateWords(lines[i], duration) });
  }
  return voiced;
}

export async function voiceReel(lines: string[], outWavs: string[]): Promise<{ voiced: Voiced[]; provider: string }> {
  if (config.ttsProvider === "gemini") {
    try {
      const v = await voiceWithGemini(lines, outWavs);
      if (v) return { voiced: v, provider: `gemini/${config.geminiVoice}` };
      console.warn("  Could not split the Gemini audio at line pauses.");
    } catch (err) {
      if (!config.ttsFallbackToKokoro) throw err;
      console.warn(`  Gemini voice failed (${String((err as Error)?.message ?? err).slice(0, 200)})`);
    }
    if (!config.ttsFallbackToKokoro) throw new Error("Gemini voice could not be split per line and Kokoro fallback is off.");
    console.warn("  Using the free Kokoro voice instead.");
    if (process.env.GITHUB_ACTIONS) console.log("::warning title=Voice fallback::Gemini TTS failed; this reel uses the Kokoro voice.");
    return { voiced: await voiceOffline("kokoro", lines, outWavs), provider: `kokoro/${config.kokoroVoice}` };
  }
  return { voiced: await voiceOffline(config.ttsProvider, lines, outWavs), provider: config.ttsProvider };
}
