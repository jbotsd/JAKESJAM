// TikTok Content Posting API — creator lookup + PULL_FROM_URL direct post.
// Mirrors clipStore.ts's job description: get a file that's already on a
// URL we host onto TikTok. Requires an access_token from auth.ts.
//
// TWO hard requirements from TikTok's review (see research brief §3):
//   1. The posting UI MUST show the creator's username + avatar before
//      posting — getCreatorInfo() returns exactly what's needed for that.
//   2. Until the app passes TikTok's audit, every post lands as SELF_ONLY
//      (private) regardless of the privacy_level requested here — that's
//      enforced server-side by TikTok, not something this code controls.

const CREATOR_INFO_URL = "https://open.tiktokapis.com/v2/post/publish/creator_info/query/";
const POST_INIT_URL = "https://open.tiktokapis.com/v2/post/publish/video/init/";

export type TikTokCreatorInfo = {
  creator_avatar_url: string;
  creator_username: string;
  creator_nickname: string;
  privacy_level_options: string[];
  comment_disabled: boolean;
  duet_disabled: boolean;
  stitch_disabled: boolean;
  max_video_post_duration_sec: number;
};

async function tiktokFetch<T>(url: string, accessToken: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "content-type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(body ?? {}),
  });
  const json = (await res.json()) as { data?: T; error?: { code: string; message: string } };
  if (!res.ok || json.error?.code === "error") {
    throw new Error(`TikTok API error: ${res.status} ${json.error?.message ?? "unknown"}`);
  }
  return json.data as T;
}

/**
 * Fetch the destination creator's display info + posting limits. Call this
 * BEFORE showing the post-confirmation screen — the returned username/avatar
 * are what TikTok's review requires the UI to display, and
 * max_video_post_duration_sec is the real per-creator length cap to check
 * the clip against before attempting to post.
 */
export function getCreatorInfo(accessToken: string): Promise<TikTokCreatorInfo> {
  return tiktokFetch<TikTokCreatorInfo>(CREATOR_INFO_URL, accessToken, {});
}

export type DirectPostResult = { publish_id: string };

/**
 * Post a clip already hosted on a TikTok-verified domain. `videoUrl` MUST be
 * on a domain verified in the TikTok Developer Portal (meta tag or DNS TXT
 * record) — TikTok's own server fetches it, this call just hands over the URL.
 */
export async function postClipFromUrl(
  accessToken: string,
  opts: { videoUrl: string; title: string; privacyLevel?: string },
): Promise<DirectPostResult> {
  return tiktokFetch<DirectPostResult>(POST_INIT_URL, accessToken, {
    post_info: {
      title: opts.title,
      privacy_level: opts.privacyLevel ?? "SELF_ONLY",
    },
    source_info: {
      source: "PULL_FROM_URL",
      video_url: opts.videoUrl,
    },
  });
}
