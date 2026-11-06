# Create attachments: photos under the chat

Screenshots taken with six photos attached in Create, after typing a topic and
sending it. `still.jpg` from `apps/worker/test/fixtures/` stands in for the photos,
so every thumbnail is the same red test still.

| Before | After |
| --- | --- |
| `create-attachments-before-1440.png` | `create-attachments-after-1440.png` |
| `create-attachments-before-1024.png` | `create-attachments-after-1024.png` |
| `create-attachments-before-390.png` | `create-attachments-after-390.png` |

Widths are 1440x900, 1024x700, and 390x844. Each pair is the same flow at the same
viewport.

## What changed

Before, every attached file took a full row of its own (name, size, remove), so
six photos added roughly 300px of list under the chat. The chat has a floor, so
the card overflowed and the rows were clipped into a sliver between the chat and
the pinned composer.

After, the files are one strip: a count line ("6 photos added"), then a wrapping
row of 68px thumbnails, each with its own remove button. The strip caps at about
two rows and scrolls inside itself, so seven or eight photos cost no more height
than six.

On screens too short for the whole card (1024x700 and 390x844 with six photos),
the strip used to land behind the pinned composer. The card now follows the strip
down to the bottom of its own scroll, so the chat, the thumbnails, and the
composer are all in view together.

## Checking it by hand

1. Open `/studio`, sign in, and start **Create new video**.
2. Type a topic and send it.
3. Attach five to eight photos.
4. The chat stays readable, the count reads "N photos added", the thumbnails sit
   above the composer, and **Send** stays reachable.

`tests/e2e/web-flow.spec.ts` covers the same steps at all three widths:
`Create keeps the chat readable with a batch of photos`.
