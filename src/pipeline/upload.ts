import fs from "node:fs";
import { google } from "googleapis";
import { config, req } from "./config";
import type { ReelScript } from "./reel";

export function youtubeClient() {
  const auth = new google.auth.OAuth2(req("YOUTUBE_CLIENT_ID"), req("YOUTUBE_CLIENT_SECRET"));
  auth.setCredentials({ refresh_token: req("YOUTUBE_REFRESH_TOKEN") });
  return google.youtube({ version: "v3", auth });
}

/** Upcoming publish slots (every PUBLISH_TIMES entry, next 2 days), soonest first, as ISO UTC. */
export function upcomingSlots(now = new Date()): string[] {
  const offsetMs = config.publishUtcOffset * 3600_000;
  const local = new Date(now.getTime() + offsetMs);
  const out: number[] = [];
  for (let day = 0; day < 3; day++)
    for (const t of config.publishTimes) {
      const [hh, mm] = t.split(":").map(Number);
      const at = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + day, hh, mm || 0) - offsetMs;
      if (at >= now.getTime() + 20 * 60_000) out.push(at); // YouTube rejects past times; leave render time
    }
  return [...new Set(out)].sort((a, b) => a - b).map((ms) => new Date(ms).toISOString());
}

/**
 * The slot this reel goes into: the soonest upcoming slot that has no reel yet.
 * withinHours limits how far ahead a scheduled run may fill (keeps news fresh); null = no free slot in range.
 */
export function nextFreeSlot(taken: Set<string>, withinHours = Infinity, now = new Date()): string | null {
  const limit = now.getTime() + withinHours * 3600_000;
  return upcomingSlots(now).find((s) => !taken.has(s) && Date.parse(s) <= limit) ?? null;
}

export const DISCLAIMER = "Fan-made news & facts channel. Not affiliated with or endorsed by Rockstar Games or Take-Two Interactive. No game footage is used.";

export function fullDescription(script: ReelScript): string {
  const src = script.sources.length ? `\n\nSources: ${script.sources.slice(0, 5).join(" · ")}` : "";
  return `${script.description}${src}\n\n${DISCLAIMER}\n\n#GTA6 #GTAVI #Shorts #Gaming #GTA6News`.slice(0, 4900);
}

export async function uploadShort(file: string, script: ReelScript, slot?: string): Promise<{ videoId: string; publishAt?: string }> {
  const yt = youtubeClient();
  const publishAt = config.uploadMode === "schedule" ? slot : undefined;
  if (config.uploadMode === "schedule" && !publishAt) throw new Error("No publish slot given for a scheduled upload.");
  const res = await yt.videos.insert({
    part: ["snippet", "status"],
    notifySubscribers: true,
    requestBody: {
      snippet: {
        title: script.title.slice(0, 100),
        description: fullDescription(script),
        tags: script.tags,
        categoryId: "20", // Gaming
        defaultLanguage: "en",
        defaultAudioLanguage: "en",
      },
      status: {
        privacyStatus: config.uploadMode === "public" ? "public" : "private",
        publishAt,
        selfDeclaredMadeForKids: false,
        embeddable: true,
        // AI voice + AI images: YouTube asks creators to disclose realistic synthetic media.
        containsSyntheticMedia: true,
      } as Record<string, unknown>,
    },
    media: { mimeType: "video/mp4", body: fs.createReadStream(file) },
  });
  const videoId = res.data.id;
  if (!videoId) throw new Error("YouTube did not return a video id.");
  return { videoId, publishAt };
}
