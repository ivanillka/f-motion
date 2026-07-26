export const scenes = [
  { id: "purple", label: "Purple · focal Y", src: "/scene_one.mp4" },
  { id: "green", label: "Green · focal X", src: "/scene_two.mp4" },
];

export const clamp = value => Math.max(-1, Math.min(1, Number(value)));
export const bounded = (samples, value, limit = 20) => [...samples, value].slice(-limit);
export const median = values => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
export const p95 = values => values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1] : 0;
export const slowThreshold = intervals => Math.max(20, 1.5 * median(intervals));
export const reorder = (order, id) => order.includes(id) ? [id, ...order.filter(value => value !== id)] : order;
export const shouldLoop = reducedMotion => !reducedMotion;
export const nextUpload = state => {
  if (state.progress < 40) return { progress: Math.min(40, state.progress + 10), failed: false, retried: state.retried };
  if (!state.retried) return { progress: 40, failed: true, retried: false };
  return { progress: Math.min(100, state.progress + 10), failed: false, retried: true };
};
export const defaultDraft = { selected: "purple", order: ["purple", "green"], caption: "Make motion memorable.", focalX: 0, focalY: 0, volume: .7, ducking: true };
export const parseDraft = raw => {
  try {
    const value = JSON.parse(raw);
    if (!value || !scenes.some(scene => scene.id === value.selected) ||
        !Array.isArray(value.order) || value.order.length !== 2 ||
        new Set(value.order).size !== 2 || value.order.some(id => !scenes.some(scene => scene.id === id)) ||
        typeof value.caption !== "string" || value.caption.length > 80 ||
        !Number.isFinite(value.focalX) || !Number.isFinite(value.focalY) ||
        !Number.isFinite(value.volume) || typeof value.ducking !== "boolean") return defaultDraft;
    return { ...value, focalX: clamp(value.focalX), focalY: clamp(value.focalY), volume: Math.max(0, Math.min(1, value.volume)) };
  } catch { return defaultDraft; }
};
