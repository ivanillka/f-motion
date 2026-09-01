import type { VideoArchitecture } from "@f-engine/contracts";

export const defaultVideoArchitecture: VideoArchitecture = {
  goal: "story",
  audience: "general",
  structure: "story_arc",
  tone: "cinematic",
  pace: "balanced",
  durationSeconds: 15,
  media: "stock",
  delivery: "reel"
};

/** ponytail: deterministic semantic signals are the ceiling; replace with a structured model adapter. */
export function recommendVideoArchitecture(conversation: string): VideoArchitecture {
  const text = conversation.normalize("NFKC").toLowerCase();
  const matches = (pattern: RegExp) => pattern.test(text);
  const goal: VideoArchitecture["goal"] = matches(/\b(how to|tutorial|teach|lesson|guide|learn)\b/u)
    ? "educate"
    : matches(/\b(explain|overview|demonstrate|process|why does|how does)\b/u)
      ? "explain"
      : matches(/\b(promote|launch|campaign|advertise|advertising|advertisement|product|service|sale|event)\b/u)
        ? "promote"
        : "story";
  const audience: VideoArchitecture["audience"] = matches(/\b(reel|tiktok|instagram|social media|shorts?)\b/u)
    ? "social"
    : goal === "promote"
      ? "customers"
      : matches(/\b(internal|employees?|colleagues?|our team|staff training)\b/u)
        ? "internal"
        : "general";
  const structure: VideoArchitecture["structure"] = matches(/\b(mystery|mysterious|secret|clues?|unknown|unsolved|abandoned|disappear|lonely island|murder)\b/u)
    ? "mystery"
    : goal === "promote" || matches(/\b(problem|solution|challenge|before and after|result)\b/u)
      ? "problem_solution"
      : matches(/\b(history|timeline|chronological|journey|evolution|life story)\b/u)
        ? "chronological"
        : "story_arc";
  const tone: VideoArchitecture["tone"] = matches(/\b(documentary|facts?|historical|investigation|interview|real story)\b/u)
    ? "documentary"
    : matches(/\b(calm|gentle|soft|peaceful|meditative|serene)\b/u)
      ? "calm"
      : matches(/\b(energetic|dynamic|fast|exciting|bold|action|sport|launch)\b/u)
        ? "energetic"
        : "cinematic";
  const pace: VideoArchitecture["pace"] = matches(/\b(fast|quick|punchy|rapid|high energy)\b/u) || tone === "energetic"
    ? "fast"
    : matches(/\b(slow|atmospheric|quiet|suspense|lonely|fog|dark|night|noir)\b/u) || tone === "calm" || structure === "mystery"
      ? "slow"
      : "balanced";
  const explicitDuration = text.match(/\b(15|30|45)[\s-]*(?:seconds?|secs?|s)\b/u)?.[1];
  const durationSeconds: VideoArchitecture["durationSeconds"] = explicitDuration
    ? Number(explicitDuration) as VideoArchitecture["durationSeconds"]
    : goal === "promote" || audience === "social"
      ? 15
      : goal === "educate" || goal === "explain" || tone === "documentary"
        ? 45
        : 30;
  const ownMedia = matches(/\b(my|our)\s+(photos?|videos?|footage|media|gallery|assets?|images?)\b/u);
  const externalMedia = matches(/\b(stock|pexels|open source|generated|ai visuals?)\b/u);
  const media: VideoArchitecture["media"] = matches(/\b(mix|mixed|both|combine)\b/u) || (ownMedia && externalMedia)
    ? "mixed"
    : ownMedia
      ? "own"
      : "stock";
  const delivery: VideoArchitecture["delivery"] = matches(/\b(youtube|widescreen|16:?9|landscape horizontal)\b/u)
    ? "youtube"
    : matches(/\b(instagram story|stories|story format)\b/u)
      ? "story"
      : audience === "social" || goal === "promote"
        ? "reel"
        : "reel";
  return { goal, audience, structure, tone, pace, durationSeconds, media, delivery };
}
