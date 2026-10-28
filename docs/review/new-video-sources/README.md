# Where the Create pictures come from

The Create chat used to answer "where do the pictures come from" with one
hardcoded Pexels list. Now the question is built from the sources the studio
really has, and the answer decides what the storyboard fills with.

| Shot | What it shows |
| --- | --- |
| `connected-sources-1440.png` | Pexels and FAL connected, so the question asks about **Pexels videos**, **AI stills with FAL (paid, asks first)**, and **Use my photos**. Civitai is not offered because this studio cannot reach it. |
| `own-photos-answer-1440.png` | Answering **Use my photos** with no files yet asks for the photos instead of faking a fill. |
| `civitai-connected-1440.png` | A connected Civitai adds **Civitai images** between Pexels and FAL, and its header chip reads **Your key**. |
| `civitai-references-1440.png` | The Civitai answer leaves every scene empty on purpose: references are picked per scene, nothing is downloaded behind the answer. |
| `fal-stills-390.png` | The FAL answer on a 390px phone: the status asks for stills scene by scene, each one quoted first. |
| `own-photos-only-1440.png` | A studio with no external keys is never asked the question. The ready line says the video uses your photos, and the chips stay honest: Pexels and FAL read **Add your key**. |

Shots come from `tests/e2e/web-flow.spec.ts`, which now covers the same four
studios: connected Pexels and FAL, connected Civitai, FAL stills on a phone,
and own photos only.
