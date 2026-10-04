/**
 * WAV helpers for spoken narration, plus the retired formant mixer.
 * Playback does not call synthesizeSpeech. That robot voice stays here so a
 * test can prove the file you hear is not this mix.
 * ponytail: fitTakeToScene linearly resamples a take that is longer than the
 * scene, which shifts pitch. Ceiling: the whole take, including the tail, lands
 * in the scene. Upgrade: pitch-preserving time-stretch.
 */

export const SPEECH_SAMPLE_RATE = 16_000;

type Manner = "vowel" | "liquid" | "nasal" | "fricative" | "stop" | "silence";

interface Phone {
  f1: number;
  f2: number;
  f3: number;
  dur: number;
  manner: Manner;
  voiced: boolean;
}

const PHONE: Record<string, Omit<Phone, "dur"> & { dur: number }> = {
  IY: { f1: 310, f2: 2200, f3: 3000, dur: 130, manner: "vowel", voiced: true },
  IH: { f1: 400, f2: 1800, f3: 2570, dur: 90, manner: "vowel", voiced: true },
  EH: { f1: 530, f2: 1840, f3: 2480, dur: 100, manner: "vowel", voiced: true },
  AE: { f1: 660, f2: 1720, f3: 2410, dur: 120, manner: "vowel", voiced: true },
  AA: { f1: 730, f2: 1090, f3: 2440, dur: 120, manner: "vowel", voiced: true },
  AH: { f1: 640, f2: 1190, f3: 2390, dur: 80, manner: "vowel", voiced: true },
  AO: { f1: 570, f2: 840, f3: 2410, dur: 130, manner: "vowel", voiced: true },
  UH: { f1: 440, f2: 1020, f3: 2240, dur: 90, manner: "vowel", voiced: true },
  UW: { f1: 300, f2: 870, f3: 2240, dur: 130, manner: "vowel", voiced: true },
  ER: { f1: 490, f2: 1350, f3: 1690, dur: 120, manner: "vowel", voiced: true },
  EY: { f1: 480, f2: 2080, f3: 2700, dur: 140, manner: "vowel", voiced: true },
  AY: { f1: 680, f2: 1200, f3: 2550, dur: 150, manner: "vowel", voiced: true },
  OW: { f1: 500, f2: 900, f3: 2400, dur: 150, manner: "vowel", voiced: true },
  AW: { f1: 700, f2: 1100, f3: 2400, dur: 150, manner: "vowel", voiced: true },
  OY: { f1: 450, f2: 900, f3: 2400, dur: 150, manner: "vowel", voiced: true },
  M: { f1: 280, f2: 900, f3: 2200, dur: 70, manner: "nasal", voiced: true },
  N: { f1: 280, f2: 1400, f3: 2500, dur: 70, manner: "nasal", voiced: true },
  NG: { f1: 280, f2: 1600, f3: 2500, dur: 80, manner: "nasal", voiced: true },
  L: { f1: 400, f2: 1200, f3: 2600, dur: 70, manner: "liquid", voiced: true },
  R: { f1: 420, f2: 1100, f3: 1600, dur: 70, manner: "liquid", voiced: true },
  W: { f1: 300, f2: 700, f3: 2200, dur: 60, manner: "liquid", voiced: true },
  Y: { f1: 300, f2: 2100, f3: 3000, dur: 50, manner: "liquid", voiced: true },
  F: { f1: 0, f2: 1400, f3: 4500, dur: 80, manner: "fricative", voiced: false },
  TH: { f1: 0, f2: 1600, f3: 5000, dur: 70, manner: "fricative", voiced: false },
  S: { f1: 0, f2: 1800, f3: 5500, dur: 90, manner: "fricative", voiced: false },
  SH: { f1: 0, f2: 1800, f3: 3500, dur: 90, manner: "fricative", voiced: false },
  HH: { f1: 500, f2: 1500, f3: 2500, dur: 60, manner: "fricative", voiced: false },
  V: { f1: 300, f2: 1400, f3: 4500, dur: 70, manner: "fricative", voiced: true },
  DH: { f1: 300, f2: 1400, f3: 4800, dur: 50, manner: "fricative", voiced: true },
  Z: { f1: 300, f2: 1800, f3: 5200, dur: 80, manner: "fricative", voiced: true },
  ZH: { f1: 300, f2: 1700, f3: 3400, dur: 80, manner: "fricative", voiced: true },
  CH: { f1: 0, f2: 1800, f3: 3600, dur: 90, manner: "stop", voiced: false },
  JH: { f1: 300, f2: 1700, f3: 3400, dur: 80, manner: "stop", voiced: true },
  P: { f1: 400, f2: 1200, f3: 2500, dur: 70, manner: "stop", voiced: false },
  T: { f1: 400, f2: 1800, f3: 4000, dur: 60, manner: "stop", voiced: false },
  K: { f1: 400, f2: 1600, f3: 2800, dur: 70, manner: "stop", voiced: false },
  B: { f1: 400, f2: 1100, f3: 2300, dur: 60, manner: "stop", voiced: true },
  D: { f1: 400, f2: 1700, f3: 3500, dur: 55, manner: "stop", voiced: true },
  G: { f1: 400, f2: 1400, f3: 2400, dur: 60, manner: "stop", voiced: true }
};

const DICT: Record<string, string> = {
  a: "AH",
  an: "AE N",
  the: "DH AH",
  to: "T UW",
  of: "AH V",
  and: "AE N D",
  for: "F AO R",
  in: "IH N",
  on: "AA N",
  at: "AE T",
  is: "IH Z",
  it: "IH T",
  be: "B IY",
  was: "W AH Z",
  were: "W ER",
  are: "AA R",
  you: "Y UW",
  your: "Y AO R",
  we: "W IY",
  they: "DH EY",
  this: "DH IH S",
  that: "DH AE T",
  with: "W IH TH",
  from: "F R AH M",
  have: "HH AE V",
  had: "HH AE D",
  has: "HH AE Z",
  not: "N AA T",
  but: "B AH T",
  what: "W AH T",
  when: "W EH N",
  where: "W EH R",
  who: "HH UW",
  how: "HH AW",
  would: "W UH D",
  could: "K UH D",
  should: "SH UH D",
  one: "W AH N",
  two: "T UW",
  three: "TH R IY",
  four: "F AO R",
  five: "F AY V",
  read: "R IY D",
  full: "F UH L",
  post: "P OW S T",
  before: "B IH F AO R",
  camera: "K AE M ER AH",
  existed: "IH G Z IH S T IH D",
  room: "R UW M",
  agreed: "AH G R IY D",
  forget: "F AO R G EH T",
  street: "S T R IY T",
  night: "N AY T",
  already: "AO L R EH D IY",
  script: "S K R IH P T",
  selected: "S AH L EH K T IH D",
  gallery: "G AE L ER IY",
  image: "IH M IH JH",
  open: "OW P AH N",
  story: "S T AO R IY",
  voice: "V OY S"
};

const RULES: [string, string][] = [
  ["ought", "AO T"],
  ["tion", "SH AH N"],
  ["sion", "ZH AH N"],
  ["ight", "AY T"],
  ["eigh", "EY"],
  ["augh", "AO"],
  ["ough", "OW"],
  ["tch", "CH"],
  ["dge", "JH"],
  ["ck", "K"],
  ["ng", "NG"],
  ["sh", "SH"],
  ["ch", "CH"],
  ["th", "TH"],
  ["ph", "F"],
  ["wh", "W"],
  ["qu", "K W"],
  ["ee", "IY"],
  ["ea", "IY"],
  ["oo", "UW"],
  ["oa", "OW"],
  ["ai", "EY"],
  ["ay", "EY"],
  ["ey", "IY"],
  ["oi", "OY"],
  ["oy", "OY"],
  ["ou", "AW"],
  ["ow", "OW"],
  ["au", "AO"],
  ["aw", "AO"],
  ["ew", "UW"],
  ["ir", "ER"],
  ["er", "ER"],
  ["ur", "ER"],
  ["ar", "AA R"],
  ["or", "AO R"],
  ["y", "IY"]
];
RULES.sort((left, right) => right[0].length - left[0].length);

const LETTER: Record<string, string> = {
  a: "AE",
  b: "B",
  c: "K",
  d: "D",
  e: "EH",
  f: "F",
  g: "G",
  h: "HH",
  i: "IH",
  j: "JH",
  k: "K",
  l: "L",
  m: "M",
  n: "N",
  o: "AA",
  p: "P",
  q: "K",
  r: "R",
  s: "S",
  t: "T",
  u: "AH",
  v: "V",
  w: "W",
  x: "K S",
  y: "Y",
  z: "Z"
};

const TENSE: Record<string, string> = { a: "EY", e: "IY", i: "AY", o: "OW", u: "UW" };

const DIGITS: Record<string, string> = {
  "0": "zero",
  "1": "one",
  "2": "two",
  "3": "three",
  "4": "four",
  "5": "five",
  "6": "six",
  "7": "seven",
  "8": "eight",
  "9": "nine"
};

function expandText(text: string): string {
  return text
    .replace(/\d/gu, (digit) => ` ${DIGITS[digit] ?? ""} `)
    .replace(/[^a-zA-Z'.?!]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function wordPhones(raw: string): string[] {
  const word = raw.toLowerCase().replace(/'/gu, "");
  if (!word) return [];
  const known = DICT[word];
  if (known) return known.split(" ");
  let text = word;
  let tense = false;
  if (/^[a-z]*[aeiou][^aeiou]+e$/u.test(text) && text.length > 3 && !text.endsWith("ee")) {
    tense = true;
    text = text.slice(0, -1);
  }
  const phones: string[] = [];
  let lastVowel = -1;
  let i = 0;
  while (i < text.length) {
    if (text[i] === "c" && i + 1 < text.length && "eiy".includes(text[i + 1]!)) {
      phones.push("S");
      i += 1;
      continue;
    }
    if (text[i] === "g" && i + 1 < text.length && "eiy".includes(text[i + 1]!)) {
      phones.push("JH");
      i += 1;
      continue;
    }
    let matched = false;
    for (const [spell, spoken] of RULES) {
      if (spell.length === 1 && spell !== "y") continue;
      if (text.startsWith(spell, i) && (spell !== "y" || i === text.length - 1)) {
        const next = spoken.split(" ");
        phones.push(...next);
        if (next.some((phone) => PHONE[phone]?.manner === "vowel")) lastVowel = phones.length - 1;
        i += spell.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    const letter = text[i]!;
    const tensePhone = tense && TENSE[letter] && !text.slice(i + 1).split("").some((item) => "aeiou".includes(item))
      ? TENSE[letter]
      : undefined;
    const spoken = tensePhone ?? LETTER[letter];
    if (spoken) {
      const next = spoken.split(" ");
      phones.push(...next);
      if (next.some((phone) => PHONE[phone]?.manner === "vowel") || tensePhone) lastVowel = phones.length - 1;
    }
    i += 1;
  }
  if (tense && lastVowel >= 0 && TENSE[text.replace(/[^aeiou]/gu, "").slice(-1)]) {
    const vowel = text.replace(/[^aeiou]/gu, "").slice(-1);
    const replacement = TENSE[vowel];
    if (replacement) phones[lastVowel] = replacement;
  }
  return phones.filter((phone) => PHONE[phone]);
}

function phonesFor(text: string): Phone[] {
  const expanded = expandText(text);
  if (!expanded) return [];
  const words = expanded.split(" ");
  const phones: Phone[] = [];
  words.forEach((word, index) => {
    const pause = /[.?!]$/u.test(word);
    for (const name of wordPhones(word.replace(/[.?!]/gu, ""))) {
      const spec = PHONE[name];
      if (spec) phones.push({ ...spec });
    }
    phones.push({
      f1: 0,
      f2: 0,
      f3: 0,
      dur: pause || index === words.length - 1 ? 90 : 55,
      manner: "silence",
      voiced: false
    });
  });
  return phones;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function resonator(freq: number, sampleRate: number, bandwidth: number): (sample: number) => number {
  if (freq <= 0) return (sample) => sample;
  const radius = Math.exp((-Math.PI * bandwidth) / sampleRate);
  const theta = (2 * Math.PI * Math.min(freq, sampleRate * 0.45)) / sampleRate;
  const b1 = -2 * radius * Math.cos(theta);
  const b2 = radius * radius;
  const gain = (1 - radius) * 0.45;
  let y1 = 0;
  let y2 = 0;
  return (sample) => {
    const y = gain * sample - b1 * y1 - b2 * y2;
    if (!Number.isFinite(y) || Math.abs(y) > 8) {
      y1 = 0;
      y2 = 0;
      return 0;
    }
    y2 = y1;
    y1 = y;
    return y;
  };
}

function envelope(index: number, total: number, manner: Manner): number {
  const attack = manner === "stop" ? 0.08 : 0.18;
  const release = 0.22;
  const start = Math.min(1, index / Math.max(1, total * attack));
  const end = Math.min(1, (total - 1 - index) / Math.max(1, total * release));
  return Math.max(0, Math.min(start, end));
}

function renderPhones(phones: Phone[], seedText: string): Int16Array {
  const random = mulberry32(seedText.split("").reduce((sum, char) => (sum * 33 + char.charCodeAt(0)) >>> 0, 2166136261));
  const chunks: number[] = [];
  let phase = 0;
  const pitch = 168;
  for (const phone of phones) {
    const count = Math.max(1, Math.round((SPEECH_SAMPLE_RATE * phone.dur) / 1000));
    if (phone.manner === "silence") {
      for (let i = 0; i < count; i += 1) chunks.push(0);
      continue;
    }
    const low = resonator(phone.f1 || 400, SPEECH_SAMPLE_RATE, phone.manner === "fricative" ? 300 : 90);
    const mid = resonator(phone.f2 || 1500, SPEECH_SAMPLE_RATE, phone.manner === "fricative" ? 400 : 110);
    const high = resonator(phone.f3 || 2800, SPEECH_SAMPLE_RATE, phone.manner === "fricative" ? 700 : 160);
    for (let i = 0; i < count; i += 1) {
      const noise = random() * 2 - 1;
      let source = 0;
      const burst = phone.manner === "stop" && i < SPEECH_SAMPLE_RATE * 0.012;
      if (phone.voiced && !burst) {
        phase += pitch / SPEECH_SAMPLE_RATE;
        if (phase >= 1) {
          phase -= 1;
          source = 1;
        }
        if (phone.manner === "fricative") source += noise * 0.35;
      } else {
        source = noise;
      }
      const shaped = phone.manner === "fricative" || burst
        ? high(source)
        : low(source) * 1.1 + mid(source) * 0.72 + high(source) * 0.28;
      const gain = phone.manner === "vowel" ? 1 : phone.manner === "fricative" ? 0.45 : 0.7;
      chunks.push(shaped * envelope(i, count, phone.manner) * gain);
    }
  }
  let peak = 0;
  for (const sample of chunks) peak = Math.max(peak, Math.abs(sample));
  const scale = peak > 0 ? 26000 / peak : 0;
  const pcm = new Int16Array(chunks.length);
  const fade = Math.min(120, Math.floor(pcm.length / 8));
  for (let i = 0; i < pcm.length; i += 1) {
    let amp = 1;
    if (i < fade) amp = i / fade;
    else if (i > pcm.length - fade) amp = (pcm.length - i) / fade;
    const value = Math.max(-32767, Math.min(32767, Math.round(chunks[i]! * scale * amp)));
    pcm[i] = value;
  }
  return pcm;
}

export function encodeWav(samples: Int16Array, sampleRate = SPEECH_SAMPLE_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) bytes[offset + i] = text.charCodeAt(i);
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) view.setInt16(44 + i * 2, samples[i]!, true);
  return bytes;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let text = "";
  for (let i = 0; i < length; i += 1) text += String.fromCharCode(bytes[offset + i] ?? 0);
  return text;
}

export function wavPcm(bytes: Uint8Array): { sampleRate: number; samples: Int16Array } {
  if (bytes.length < 12) throw new Error("wav too small");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") throw new Error("not wav");
  let sampleRate = 0;
  let channels = 0;
  let bits = 0;
  let dataOffset = -1;
  let dataBytes = 0;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = ascii(bytes, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (id === "fmt " && size >= 16 && start + 16 <= bytes.length) {
      const format = view.getUint16(start, true);
      channels = view.getUint16(start + 2, true);
      sampleRate = view.getUint32(start + 4, true);
      bits = view.getUint16(start + 14, true);
      if (format !== 1) throw new Error("wav not pcm");
    } else if (id === "data") {
      dataOffset = start;
      dataBytes = Math.min(size, Math.max(0, bytes.length - start));
    }
    offset = start + size + (size % 2);
  }
  if (!sampleRate || channels < 1 || bits !== 16 || dataOffset < 0) throw new Error("wav missing pcm");
  const frame = channels * 2;
  const frames = Math.floor(dataBytes / frame);
  const samples = new Int16Array(frames);
  for (let i = 0; i < frames; i += 1) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      sum += view.getInt16(dataOffset + i * frame + channel * 2, true);
    }
    samples[i] = Math.max(-32767, Math.min(32767, Math.round(sum / channels)));
  }
  return { sampleRate, samples };
}

function resampleMono(samples: Int16Array, count: number): Int16Array {
  if (count <= 0) return new Int16Array(0);
  if (count === samples.length) return samples;
  const out = new Int16Array(count);
  if (samples.length === 0) return out;
  if (samples.length === 1 || count === 1) {
    out.fill(samples[0] ?? 0);
    return out;
  }
  const last = samples.length - 1;
  for (let i = 0; i < count; i += 1) {
    const pos = (i * last) / (count - 1);
    const left = Math.floor(pos);
    const right = Math.min(last, left + 1);
    const frac = pos - left;
    const value = samples[left]! * (1 - frac) + samples[right]! * frac;
    out[i] = Math.max(-32767, Math.min(32767, Math.round(value)));
  }
  return out;
}

/**
 * A take that already fits the scene keeps its length.
 * A longer take is scaled into the scene so the tail is still the end of that take.
 */
export function fitTakeToScene(
  samples: Int16Array,
  fromRate: number,
  toRate: number,
  slotSamples: number
): Int16Array {
  if (slotSamples <= 0 || samples.length === 0 || fromRate <= 0 || toRate <= 0) return new Int16Array(0);
  const native = Math.max(1, Math.round((samples.length * toRate) / fromRate));
  if (native <= slotSamples) return resampleMono(samples, native);
  return resampleMono(samples, slotSamples);
}

/** Speech for one caption. Same text always yields the same WAV. */
export function synthesizeSpeech(text: string): Uint8Array {
  const spoken = text.replace(/\s+/gu, " ").trim();
  if (!spoken) return encodeWav(new Int16Array(0));
  return encodeWav(renderPhones(phonesFor(spoken), spoken.toLowerCase()));
}

/** Place each Spoken line at its scene start. A long take is fitted, not chopped. */
export function mixSpokenTimeline(
  timelineMs: number,
  slots: readonly { key: string; startMs: number; durationMs: number }[],
  lines: ReadonlyMap<string, Uint8Array>
): Uint8Array {
  const decoded = new Map<string, { sampleRate: number; samples: Int16Array }>();
  let rate = SPEECH_SAMPLE_RATE;
  for (const slot of slots) {
    const wav = lines.get(slot.key);
    if (!wav || decoded.has(slot.key)) continue;
    const pcm = wavPcm(wav);
    decoded.set(slot.key, pcm);
    if (decoded.size === 1 && pcm.sampleRate > 0) rate = pcm.sampleRate;
  }
  const total = Math.max(1, Math.round((rate * timelineMs) / 1000));
  const mixed = new Int16Array(total);
  for (const slot of slots) {
    const pcm = decoded.get(slot.key);
    if (!pcm) continue;
    const start = Math.min(mixed.length, Math.max(0, Math.round((rate * slot.startMs) / 1000)));
    const room = Math.min(mixed.length - start, Math.max(0, Math.round((rate * slot.durationMs) / 1000)));
    const fitted = fitTakeToScene(pcm.samples, pcm.sampleRate, rate, room);
    const count = Math.min(fitted.length, mixed.length - start);
    for (let i = 0; i < count; i += 1) mixed[start + i] = fitted[i]!;
  }
  return encodeWav(mixed, rate);
}
