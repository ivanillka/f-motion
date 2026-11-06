# Create intake: questions named after what you already said

Screenshots taken in Create after typing `mystery murder in san francisco` and
sending it, at 1440x900 and 390x844. The 390 pair adds three copies of
`apps/worker/test/fixtures/still.jpg` first, so the photo path is on screen.

| Before | After |
| --- | --- |
| `create-intake-before-1440.png` | `create-intake-after-1440.png` |
| `create-intake-before-390.png` | `create-intake-after-390.png` |

Before is `origin/advisor/133-design-contract` (it already has the attachment
strip from #80 and the gentle motion from #81). After is this branch. Each pair
is the same flow at the same viewport.

## What changed

Before, the chat asked **Who is this San Francisco mystery for?** with
`General viewers / Social media audience / Customers / Internal team`. The
answer changes nothing the storyboard can draw, and the four turns the old
intake had were spent before the feel, the words, the ending or the length were
known.

After, the chat asks at most three things, each named after the owner's own
words: **Should the San Francisco mystery feel tense and slow, or warm and
calm?**, then **Should mystery murder in san francisco carry words on screen?**,
then **How should mystery murder in san francisco end?**. Past those three it
writes the ready line and opens the storyboard.

With photos, the first question names them, **What is happening in your 3
photos, in your own words? Even a few words keep it in the captions.**,
`Make my storyboard now` is the first primary action, the files sit in the
attachment strip from #80, and the opt-in **Describe my photos with my FAL key**
toggle waits under it, off, with the price note beside it. Every added photo
keeps its own scene.

## Checking it by hand

1. Open `/studio`, sign in, and start **Create new video**.
2. Type a topic and send it. The next question repeats your subject, not a menu.
3. Answer it, then read the next question: it still names your subject.
4. Type one line with the rest (`tonight, warm and calm, about 30 seconds`) and
   the chat accepts it as answers, keeps your subject, and never asks a fourth
   question.
5. Attach three photos instead and the first question names them, with
   **Make my storyboard now** above the other two answers.
6. The description toggle is off, and turning it on asks for the price first.

`tests/e2e/web-flow.spec.ts` covers the same steps:
`Create asks at most three questions, each named after the owner's own words`,
`Create reads the photos first and every photo keeps a scene`, and
`photo descriptions stay off until the owner confirms the price`.
