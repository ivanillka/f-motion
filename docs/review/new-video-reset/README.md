# A new video starts a new video

Create remembered the last intake in `localStorage` and reopened it whenever the
chat had a user message, because `startCreate` restored any stored conversation
and cleared the status line. A finished intake was never cleared, so a reload
after a made storyboard, or **Create new video** after a chat that failed to
build, landed on a chat that looked ready and offered nothing to press: the
ready line was on screen, the status that carried **Try again** was gone, and
the composer was empty.

Now one helper, `createEntryState`, decides what Create opens with:

- **Create new video** opens `{ fresh: true }`, so the chat is the opening line,
  the composer is empty, and the stored intake is forgotten. Nothing from the
  last chat is resumed.
- The sidebar **Create** entry, and the reload that lands on Drafts, resume a
  chat that was started but not finished.
- A line that was typed but never sent is offered again in the composer instead
  of being thrown away.
- A storyboard that exists clears the intake for good, so reloading after a
  successful build starts a new video rather than reopening the finished chat.

Two controls close the dead end: **Start over** above the chat (a confirm, so a
misclick cannot throw away a conversation) and **Make my storyboard** in the
composer whenever the chat has reached its ready line. A failed build keeps both
buttons, so the chat can be retried or replaced instead of stranded.

| Shot | What it shows |
| --- | --- |
| `before-reload-ready-line-1440.png` | Base commit. A reload of a chat whose storyboard could not be made reopens the conversation with no **Start over**, no **Make my storyboard**, and no status, so the ready line is a dead end. |
| `after-reload-ready-line-1440.png` | The same reload with this change. The chat is back with **Start over** above it and **Make my storyboard** under the composer, so the ready line can be acted on. |
| `before-create-new-video-1440.png` | Base commit. **Create new video** on the drafts list reopens the ready chat instead of starting a new video. |
| `after-create-new-video-1440.png` | **Create new video** now opens a clean intake: the opening line, no **Start over**, an empty composer. |
| `before-create-new-video-390.png` | Base commit at 390px, the same resumed chat. |
| `after-create-new-video-390.png` | The clean intake at 390px. |

The after shots come from the same steps as the before shots, taken against
`623d743` with the source changes stashed and then restored, so the two sets
differ only by this change. The narrative is covered by
`tests/e2e/web-flow.spec.ts`: a clean intake at 1440 and 390, a ready line that
stays usable after a reload when the build fails with 503, and **Start over**
asking before it clears.
