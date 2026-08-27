/**
 * Product version and release notes shown in Settings.
 * Keep CHANGELOG.md in sync when you cut a release.
 */
export const APP_VERSION = "0.2.0";

export interface ReleaseNote {
  version: string;
  date: string;
  title: string;
  items: string[];
}

/** Newest first. Settings shows the current version plus one prior note. */
export const RELEASE_NOTES: readonly ReleaseNote[] = [
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
