import type { CommandEnvelope, ProjectSnapshot, Scene } from "@f-motion/contracts";

export interface Concept {
  id: string;
  title: string;
  treatment: string;
}

export function conceptsFor(brief: ProjectSnapshot["brief"]): [Concept, Concept, Concept] {
  const subject = brief.purpose.trim().slice(0, 80);
  return [
    { id: "direct", title: "Direct", treatment: `${subject}: lead with the result` },
    { id: "story", title: "Story", treatment: `${subject}: establish, turn, resolve` },
    { id: "rhythm", title: "Rhythm", treatment: `${subject}: concise visual beats` }
  ];
}

function boundedScene(scene: Scene): Scene {
  if (scene.caption.length > 180) throw new Error("caption exceeds 180 characters");
  if (scene.duration_ms < 500 || scene.duration_ms > 15_000) throw new Error("duration out of bounds");
  if (![scene.focal_x, scene.focal_y, scene.audio_level].every((value) => value >= 0 && value <= 1)) {
    throw new Error("normalized value out of bounds");
  }
  return scene;
}

export function applyCommand(snapshot: ProjectSnapshot, command: CommandEnvelope): ProjectSnapshot {
  if (command.project_id !== snapshot.id) throw new Error("project mismatch");
  if (command.base_revision !== snapshot.revision) throw new Error("stale revision");
  if (command.kind === "select_concept") {
    const conceptId = String(command.payload.concept_id ?? "");
    if (!conceptsFor(snapshot.brief).some(({ id }) => id === conceptId)) throw new Error("unknown concept");
    return { ...snapshot, selected_concept_id: conceptId, revision: snapshot.revision + 1 };
  }
  if (command.kind === "update_scene") {
    const scene = boundedScene(command.payload.scene as Scene);
    if (!snapshot.scenes.some(({ id }) => id === scene.id)) throw new Error("unknown scene");
    return { ...snapshot, scenes: snapshot.scenes.map((item) => item.id === scene.id ? scene : item), revision: snapshot.revision + 1 };
  }
  const sceneId = String(command.payload.scene_id ?? "");
  const to = Number(command.payload.to);
  if (!Number.isInteger(to) || to < 0 || to >= snapshot.scenes.length) throw new Error("invalid order");
  const scenes = snapshot.scenes.filter(({ id }) => id !== sceneId);
  const moved = snapshot.scenes.find(({ id }) => id === sceneId);
  if (!moved) throw new Error("unknown scene");
  scenes.splice(to, 0, moved);
  return { ...snapshot, scenes: scenes.map((scene, order) => ({ ...scene, order })), revision: snapshot.revision + 1 };
}

export function renderPlan(snapshot: ProjectSnapshot) {
  return {
    revision: snapshot.revision,
    width: 720,
    height: 1280,
    watermark: "F-Motion preview",
    scenes: snapshot.scenes.map(boundedScene)
  } as const;
}
