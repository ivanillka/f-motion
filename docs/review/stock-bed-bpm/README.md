# Stock bed tempo measurement

The catalogue tempo for every stock bed drives the beat grid, the "Snap scenes
to beat" action, and the tempo a bed pick writes into the project. The six
Kevin MacLeod beds shipped with placeholder tempi, so the beat grid drifted
away from the audio after a few seconds.

## Method

`librosa` 1.0.0 on the shipped 32 second excerpt in `apps/web/public/music`:

1. `librosa.beat_track` at 22.05 kHz gives a first beat interval per excerpt.
2. A fine comb scan of the onset envelope (hop 128, 0.05 BPM steps, 40 to 200
   BPM) picks the pulse train that best explains the onsets. This resolves the
   half and double time cases that plain beat tracking gets wrong on loops.
3. The catalogue value is the comb peak rounded to a whole BPM. Whenever the
   two methods disagreed, the fine comb scan decided, because it scores every
   0.05 BPM step against the real onsets instead of following a beat tracker
   path that can lock onto a subdivision of the loop.

The numbers only correct metadata. No scene is re-snapped and no stored
project is migrated: a soundtrack keeps the BPM it was saved with, and the new
values apply to the next bed pick or "Snap scenes to beat".

## Results

| Bed id | Title | Artist | Incompetech | Before | beat_track | Comb scan | Now |
| --- | --- | --- | --- | --- | --- | --- | --- |
| pulse | Funkorama | Kevin MacLeod | 101 | 115 | 99.4 | 101.05 | 101 |
| drive | Space Fighter Loop | Kevin MacLeod | 95 | 128 | 95.7 | 95.00 | 95 |
| air | Dreamy Flashback | Kevin MacLeod | 110 | 80 | 112.4 | 110.05 | 110 |
| glow | Easy Lemon | Kevin MacLeod | 82 | 110 | 161.5 (half time 80.8) | 82.00 | 82 |
| night | Wallpaper | Kevin MacLeod | 92 | 90 | 92.3 | 93.00 | 93 |
| rise | Hot Swing | Kevin MacLeod | 144 | 140 | 143.6 | 144.05 | 144 |
| banger | Banger | e s c p | n/a | 170 | 112.4, ambiguous | 170.00 | 170 |
| rush | Hyper Ultra-Racing | cynicmusic | n/a | 168 | 112.4, ambiguous | 168.00 | 168 |

Both drum and bass beds report 112.4 from beat tracking, which is neither the
half nor the double of the real tempo. The comb scan and the shipped catalogue
values agree on 170 and 168, so those two are unchanged.

Wallpaper is the one track where the published page and the excerpt disagree.
incompetech lists 92, while a 0.01 BPM comb scan of the excerpt peaks hard at
93.00 (score 3.51 against 0.28 at 92.00 and 0.31 at 92.30, with no peak anywhere
near 92). The grid follows the audio, so the catalogue takes 93.

## Picker behaviour

Picking a bed now writes that bed's catalogue tempo into the project instead of
keeping whatever tempo the project had. A hand typed tempo survives the save
that follows it and stays until the next bed pick. The tempo box stays inside
the 60 to 200 BPM range that `clampBpm` enforces.

## Screenshots

Phone at 390px and desktop at 1440px, with Funkorama picked and the tempo box
showing the catalogue value of 101 BPM:

- `music-picker-390.png`
- `music-picker-1440.png`
