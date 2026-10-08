import { describeModule, type ContentTypeModule } from "./module.js";
import type { ModuleDescriptor, ModulePhase, TypeId } from "./types.js";

export class TypeRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TypeRegistryError";
  }
}

/** In-process module registry. No remote plugins. */
export class TypeRegistry {
  readonly #modules = new Map<TypeId, ContentTypeModule>();

  register(module: ContentTypeModule): void {
    if (!module.typeId?.trim()) throw new TypeRegistryError("typeId required");
    if (this.#modules.has(module.typeId)) {
      throw new TypeRegistryError(`duplicate typeId: ${module.typeId}`);
    }
    if (module.phase !== "polish_ready" && module.phase !== "coming") {
      throw new TypeRegistryError(`invalid phase for ${module.typeId}`);
    }
    this.#modules.set(module.typeId, module);
  }

  get(typeId: TypeId): ContentTypeModule | undefined {
    return this.#modules.get(typeId);
  }

  require(typeId: TypeId): ContentTypeModule {
    const module = this.#modules.get(typeId);
    if (!module) throw new TypeRegistryError(`unknown typeId: ${typeId}`);
    return module;
  }

  list(phase?: ModulePhase): ModuleDescriptor[] {
    const all = [...this.#modules.values()].map(describeModule);
    return phase ? all.filter((item) => item.phase === phase) : all;
  }

  listPolishReady(): ModuleDescriptor[] {
    return this.list("polish_ready");
  }

  /** Resolve selected ids to modules; unknown / non-polish-ready are omitted. */
  selected(typeIds: readonly TypeId[]): ContentTypeModule[] {
    const out: ContentTypeModule[] = [];
    for (const typeId of typeIds) {
      const module = this.#modules.get(typeId);
      if (module?.phase === "polish_ready") out.push(module);
    }
    return out;
  }
}
