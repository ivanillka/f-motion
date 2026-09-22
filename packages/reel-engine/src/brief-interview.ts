import { defaultVideoArchitecture, recommendVideoArchitecture } from "./brief-architecture.js";
import type { VideoArchitecture } from "@f-engine/contracts";

export const briefQuestionIds = ["intent", "audience", "length", "visuals"] as const;
export type BriefQuestionId = (typeof briefQuestionIds)[number];

export interface BriefQuestion {
  id: BriefQuestionId | "topic";
  prompt: string;
  choices: readonly string[];
}

export const BRIEF_OPENING_TEXT =
  "What do you want to make? Drop photos or describe the video. I will ask only what I still need.";

export const BRIEF_STARTERS = [
  "A 30-second story",
  "A product launch reel",
  "A how-to lesson",
  "A quiet mystery"
] as const;

export const BRIEF_READY = "That is enough for a video plan.";

export const briefChoiceSets: Record<BriefQuestionId, readonly string[]> = {
  intent: ["Tell a story", "Explain something", "Promote an idea or product", "Teach the viewer"],
  audience: ["General viewers", "Social media audience", "Customers", "Internal team"],
  length: ["About 15 seconds", "About 30 seconds", "About 45 seconds"],
  visuals: ["Pexels real stock video", "My own media", "Mix Pexels stock and my media"]
};

export interface BriefTurn {
  ready: boolean;
  question?: BriefQuestion;
  message?: string;
  plan: VideoArchitecture;
  asked: BriefQuestionId[];
}

function titledPlace(place: string): string {
  return place.replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase());
}

function topicPhrase(value: string): string {
  return value
    .replace(/^(?:i\s+)?(?:need|want)\s+(?:a\s+)?(?:story|video)\s+(?:about|on)\s+/iu, "")
    .replace(/^(?:make|create)\s+(?:a\s+)?(?:story|video)\s+(?:about|on)\s+/iu, "")
    .trim();
}

function clipSubject(value: string): string {
  const text = topicPhrase(value.replace(/[.!?]+$/u, "").trim());
  if (!text) return "this video";
  return text.length > 52 ? `${text.slice(0, 49).trim()}…` : text;
}

const briefMetaLine = /^(I looked at|I added |File names:|Looking at your media|That is enough for)/iu;

function chipLines(): Set<string> {
  return new Set(Object.values(briefChoiceSets).flat().map((choice) => choice.toLowerCase()));
}

/** First user topic, not the later chip answers or glance notes. */
export function briefPurposeFromChat(conversation: string, fileCount = 0): string {
  const chips = chipLines();
  const first = conversation.split(/\n+/u).map((line) => line.trim()).find((line) =>
    line && !briefMetaLine.test(line) && !chips.has(line.toLowerCase())
  ) ?? "";
  const purpose = first.slice(0, 500).trim();
  if (purpose) return purpose;
  if (fileCount > 0) return `Video from ${fileCount} photo${fileCount === 1 ? "" : "s"}`;
  return "";
}

function briefTopicLine(conversation: string): string {
  const chips = chipLines();
  const topics: string[] = [];
  for (const line of conversation.split(/\n+/u).map((row) => row.trim())) {
    if (!line || briefMetaLine.test(line)) continue;
    if (chips.has(line.toLowerCase())) break;
    topics.push(line);
  }
  return topics[topics.length - 1] ?? "";
}

/** First user line plus the plan inferred from every answer so far. */
export function briefTopic(conversation: string): {
  subject: string;
  place: string;
  hook: string;
  plan: VideoArchitecture;
} {
  const first = briefTopicLine(conversation);
  const place = (first.match(/\bin\s+([^,.!?]+)$/iu)?.[1] ?? "").trim();
  const looked = /\bI looked at\b/iu.test(conversation);
  const subject = clipSubject(first) === "this video" && looked ? "your media" : clipSubject(first);
  return {
    subject,
    place,
    hook: place ? titledPlace(place) : subject,
    plan: recommendVideoArchitecture(conversation)
  };
}

export function isBriefReadyMessage(text: string): boolean {
  return text.startsWith("That is enough for");
}

export function briefReadyMessage(conversation: string): string {
  if (!conversation.trim()) return BRIEF_READY;
  const { subject, place, hook, plan } = briefTopic(conversation);
  const shape = plan.structure === "mystery"
    ? "mystery"
    : plan.goal === "promote"
      ? "promo"
      : plan.goal === "educate"
        ? "lesson"
        : "story";
  const where = plan.media === "own"
    ? "your media"
    : plan.media === "mixed"
      ? "your media mixed with Pexels"
      : place
        ? `moody ${hook} Pexels stock`
        : "Pexels stock";
  return `That is enough for a ${plan.tone} ${shape} about ${subject} — about ${plan.durationSeconds} seconds, ${where}.`;
}

export function briefQuestionFor(
  id: BriefQuestionId,
  conversation: string,
  hasOwnMedia: boolean
): BriefQuestion {
  const { subject, place, hook, plan } = briefTopic(conversation);
  const looked = /\bI looked at\b/iu.test(conversation);
  const dark = /\bdark\b/iu.test(conversation);
  const portrait = /\bportrait\b/iu.test(conversation);
  const lookHint = [dark ? "dark" : "", portrait ? "portrait" : ""].filter(Boolean).join(", ");
  const about = looked && (subject === "this video" || subject === "your media") ? "your media" : subject;
  if (id === "intent") {
    return {
      id,
      prompt: lookHint
        ? `Your media looks ${lookHint}. Is this a story, an explanation, a promotion, or a lesson?`
        : `Should ${about} be a story, an explanation, a promotion, or a lesson?`,
      choices: briefChoiceSets.intent
    };
  }
  if (id === "audience") {
    const prompt = plan.structure === "mystery"
      ? (place ? `Who is this ${hook} mystery for?` : `Who is this mystery for?`)
      : looked
        ? `Who should see this cut of ${about}?`
        : plan.goal === "promote"
          ? `Who should see ${about}?`
          : plan.goal === "educate"
            ? `Who are you teaching with ${about}?`
            : `Who is ${about} for?`;
    return { id, prompt, choices: briefChoiceSets.audience };
  }
  if (id === "length") {
    const preferred = `About ${plan.durationSeconds} seconds`;
    const choices = [preferred, ...briefChoiceSets.length.filter((choice) => choice !== preferred)];
    const prompt = plan.audience === "social"
      ? `For a reel of ${about}, about 15, 30, or 45 seconds?`
      : looked && portrait
        ? `These are mostly portrait frames. About 15, 30, or 45 seconds?`
        : plan.structure === "mystery"
          ? (place
            ? `Should the ${hook} mystery be a 15-second hook, a 30-second slow reveal, or 45 seconds?`
            : `Should this mystery be a 15-second hook, a 30-second slow reveal, or 45 seconds?`)
          : plan.goal === "promote"
            ? `How long should ${about} run — about 15, 30, or 45 seconds?`
            : `About how long should ${about} run?`;
    return { id, prompt, choices };
  }
  const stock = place ? `moody ${hook} stock from Pexels` : "Pexels stock";
  const prompt = hasOwnMedia
    ? `Use the photos you added for ${about}, mix in Pexels, or switch to stock only?`
    : plan.structure === "mystery"
      ? `Do you have footage, or should we use ${stock}?`
      : `Where should pictures for ${about} come from?`;
  return { id, prompt, choices: briefChoiceSets.visuals };
}

export function answeredBriefQuestions(conversation: string, hasOwnMedia: boolean): Set<BriefQuestionId> {
  const text = conversation.normalize("NFKC").toLowerCase();
  const matches = (pattern: RegExp) => pattern.test(text);
  const answered = new Set<BriefQuestionId>();
  if (matches(/\b(how to|tutorial|teach|lesson|guide|learn|explain|overview|demonstrate|process|why does|how does|promote|launch|campaign|advertise|advertising|advertisement|product|service|sale|event|story|mystery|murder|tale|narrative)\b/u)) {
    answered.add("intent");
  }
  if (matches(/\b(reel|tiktok|instagram|social media|shorts?|customers?|internal|employees?|colleagues?|our team|staff training|general viewers?)\b/u)) {
    answered.add("audience");
  }
  for (const choice of briefChoiceSets.audience) {
    if (text.includes(choice.toLowerCase())) answered.add("audience");
  }
  if (matches(/\b(15|30|45)[\s-]*(?:seconds?|secs?|s)\b/u)) {
    answered.add("length");
  }
  if (
    hasOwnMedia
    || matches(/\b(stock|pexels|open source|generated|ai visuals?)\b/u)
    || matches(/\b(my|our)\s+(photos?|videos?|footage|media|gallery|assets?|images?)\b/u)
    || matches(/\bmy own media\b/u)
  ) {
    answered.add("visuals");
  }
  return answered;
}

export function nextBriefQuestion(
  conversation: string,
  hasOwnMedia: boolean,
  asked: readonly BriefQuestionId[]
): BriefQuestion | undefined {
  if (asked.length >= 4) return undefined;
  const answered = answeredBriefQuestions(conversation, hasOwnMedia);
  for (const id of briefQuestionIds) {
    if (answered.has(id) || asked.includes(id)) continue;
    return briefQuestionFor(id, conversation, hasOwnMedia);
  }
  return undefined;
}

function planFromConversation(conversation: string, hasOwnMedia: boolean): VideoArchitecture {
  const plan = recommendVideoArchitecture(conversation);
  if (hasOwnMedia && plan.media === "stock") plan.media = "own";
  return plan;
}

/** Next studio slide from the replies so far. Empty chat gets the opening pick-or-provide. */
export function advanceBrief(
  conversation: string,
  hasOwnMedia: boolean,
  asked: readonly BriefQuestionId[]
): BriefTurn {
  const text = conversation.normalize("NFKC").slice(0, 2000);
  const known = asked.filter((id): id is BriefQuestionId => briefQuestionIds.includes(id));
  const plan = text.trim() ? planFromConversation(text, hasOwnMedia) : { ...defaultVideoArchitecture };
  if (!text.trim()) {
    return {
      ready: false,
      question: { id: "topic", prompt: BRIEF_OPENING_TEXT, choices: BRIEF_STARTERS },
      plan,
      asked: []
    };
  }
  const question = nextBriefQuestion(text, hasOwnMedia, known);
  if (!question) {
    return { ready: true, message: briefReadyMessage(text), plan, asked: [...known] };
  }
  return {
    ready: false,
    question,
    plan,
    asked: known.includes(question.id as BriefQuestionId) ? [...known] : [...known, question.id as BriefQuestionId]
  };
}

export function parseBriefAsked(value: unknown): BriefQuestionId[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is BriefQuestionId =>
    typeof item === "string" && briefQuestionIds.includes(item as BriefQuestionId)
  ).slice(0, 4);
}
