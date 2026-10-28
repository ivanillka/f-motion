# Where the Create pictures come from

The Create chat used to answer "where do the pictures come from" with one
hardcoded Pexels list. Now the question is built from the sources the studio
really has, and the answer decides what the storyboard fills with.

| Shot | What it shows |
| --- | --- |
| `connected-sources-1440.png` | Pexels and FAL connected, so the question asks about **Pexels videos**, **AI images with FAL (paid, asks first)**, **Use my photos**, and one **Mix my photos and Pexels and FAL** answer. Civitai is not offered because this studio cannot reach it. |
| `own-photos-answer-1440.png` | Answering **Use my photos** with no files yet asks for the photos instead of faking a fill. |
| `pexels-only-question-1440.png` | With only Pexels connected the FAL answer disappears and one hint line says **Connect FAL in Settings to use it here.** |
| `mix-asks-photos-1440.png` | The mix answer is offered before the photos exist, and asking for them is what happens next: **Add the photos you want to mix, one per scene; Pexels can fill the rest.** |
| `mix-asks-photos-390.png` | The same mix answer on a 390px phone, still with no stock search and no image quote. |
| `civitai-connected-1440.png` | A connected Civitai adds **Civitai images** between Pexels and FAL, and its header chip reads **Your key**. |
| `civitai-references-1440.png` | The Civitai answer leaves every scene empty on purpose: references are picked per scene, nothing is downloaded behind the answer. |
| `ai-images-390.png` | The FAL answer on a 390px phone: the status asks for AI images scene by scene, each one quoted first. |
| `own-photos-only-1440.png` | A studio with no external keys is never asked the question. The ready line sends you to Settings, and the header chips stay honest: Pexels and FAL read **Add your key**. |

Shots come from `tests/e2e/web-flow.spec.ts`, which covers the same four
studios: connected Pexels and FAL, connected Civitai, AI images on a phone,
and own photos only. The copy in them matches the rename from AI stills to AI
images and the Settings wording the tests assert.
