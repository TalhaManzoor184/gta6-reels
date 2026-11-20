import fs from "node:fs";
import { google } from "googleapis";
import { config, req } from "./config";
import type { ReelScript } from "./reel";

export function youtubeClient() {
  const auth = new google.auth.OAuth2(req("YOUTUBE_CLIENT_ID"), req("YOUTUBE_CLIENT_SECRET"));
  auth.setCredentials({ refresh_token: req("YOUTUBE_REFRESH_TOKEN") });
  return google.youtube({ version: "v3", auth });
}

/** Next PUBLISH_TIME (in PUBLISH_UTC_OFFSET local time), PUBLISH_DELAY_DAYS from now, as ISO UTC. */
export function publishAtIso(now = new Date()): string {
  const [hh, mm] = config.publishTime.split(":").map(Number);
  const offsetMs = config.publishUtcOffset * 3600_000;
  const local = new Date(now.getTime() + offsetMs);
  let target = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + config.publishDelayDays, hh, mm) - offsetMs;
  while (target < now.getTime() + 15 * 60_000) target += 24 * 3600_000; // YouTube rejects past times
  return new Date(target).toISOString();
}

export const DISCLAIMER = "Fan-made news & facts channel. Not affiliated with or endorsed by Rockstar Games or Take-Two Interactive. No game footage is used.";

export function fullDescription(script: ReelScript): string {
  const src = script.sources.length ? `\n\nSources: ${script.sources.slice(0, 5).join(" · ")}` : "";
  return `${script.description}${src}\n\n${DISCLAIMER}\n\n#GTA6 #GTAVI #Shorts #Gaming #GTA6News`.slice(0, 4900);
}

export async function uploadShort(file: string, script: ReelScript): Promise<{ videoId: string; publishAt?: string }> {
  const yt = youtubeClient();
  const publishAt = config.uploadMode === "schedule" ? publishAtIso() : undefined;
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
