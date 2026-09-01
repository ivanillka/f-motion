/**
 * Product version and release notes shown in Settings.
 * Keep CHANGELOG.md in sync when you cut a release.
 */
import pkg from "../../../package.json" with { type: "json" };

export const APP_VERSION = pkg.version;

export interface ReleaseNote {
  version: string;
  date: string;
  title: string;
  items: string[];
}

/** Newest first. Settings shows the current version plus one prior note. */
export const RELEASE_NOTES: readonly ReleaseNote[] = [
  {
    version: "0.3.0",
    date: "2026-09-01",
    title: "Context-aware media",
    items: [
      "Licensed stock search ranks candidates with a fit score from your brief, scene, and optional media glance.",
      "Video architecture and media glance persist when the storyboard is created — not only after concept selection.",
      "YouTube-style delivery searches landscape Pexels; Reels and Stories stay portrait.",
      "FAL image and motion dialogs open prefilled from scene intent; stock picks log feedback for tuning."
    ]
  },
  {
    version: "0.2.0",
    date: "2026-08-28",
    title: "Create is the chat",
    items: [
      "Create asks only what is still missing, then opens the storyboard — no concept picker and no extra Continue step.",
      "Dropped photos get a local glance before follow-up questions; Pexels-only chats do not wait on a drop.",
      "Play keeps running when a scene still needs media; Pause freezes the preview.",
      "Voice-over has start offset, level, and mute; spoken words highlight on the full caption."
    ]
  },
  {
    version: "0.1.0",
    date: "2026-08-25",
    title: "Live alpha",
    items: [
      "Vertical storyboard drafts with licensed stock (BYOK Pexels) and optional FAL stills (BYOK).",
      "Preview and final export through host metering."
    ]
  }
];
