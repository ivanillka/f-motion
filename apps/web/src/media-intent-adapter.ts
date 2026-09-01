import {
  sceneMediaIntent,
  setMediaIntentAdapter,
  stockQueriesFromText,
  type SceneMediaIntentInput
} from "@f-engine/reel-engine";

/**
 * Host-side media intent adapter. ponytail: swap the structure cue merge for a
 * structured LLM response; `setMediaIntentAdapter` accepts the same shape.
 */
export function registerMediaIntentAdapter(): void {
  setMediaIntentAdapter((input: SceneMediaIntentInput) => {
    const base = sceneMediaIntent(input);
    const structureCue = input.architecture?.structure === "mystery"
      ? "mysterious atmospheric fog"
      : input.architecture?.structure === "chronological"
        ? "timeline progression historic"
        : input.architecture?.structure === "problem_solution"
          ? "before after transformation"
          : "";
    if (!structureCue) return base;
    const extraQueries = stockQueriesFromText(`${structureCue} ${input.brief}`);
    return {
      ...base,
      stock_queries: [...new Set([...base.stock_queries, ...extraQueries])].slice(0, 2),
      intent_tokens: [...new Set([
        ...base.intent_tokens,
        ...stockQueriesFromText(structureCue)
      ])]
    };
  });
}
