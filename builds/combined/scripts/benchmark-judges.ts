import { generateText, Output } from "ai";
import { GatewayJudgmentSchema, RUBRIC_SYSTEM_PROMPT, TIER1_DEFAULT_MODEL } from "../lib/assess";
import { ROOT_TOPIC_IDS } from "../lib/schemas";

const cases = [
  { id: "oversight", relevant: true, title: "Evaluating scalable oversight for autonomous AI agents", summary: "A held-out study compares an AI monitor against human reviewers on deception detection, reporting sample sizes and baseline error rates." },
  { id: "forecast", relevant: true, title: "Forecasting frontier AI training compute", summary: "A research study estimates training compute trends and uncertainty using historical frontier model data." },
  { id: "retail", relevant: false, title: "AI helps retailers recommend shoes", summary: "A shopping application personalizes footwear recommendations using image recognition." },
  { id: "geometric-alignment", relevant: false, title: "Image alignment for medical scans", summary: "An image registration system aligns MRI scans for radiology workflows." },
] as const;

const candidates = [TIER1_DEFAULT_MODEL, "openai/gpt-oss-20b", "openai/gpt-oss-120b"];
const response = await fetch("https://ai-gateway.vercel.sh/v1/models");
if (!response.ok) throw new Error(`Model catalog returned ${response.status}`);
const catalog = await response.json() as { data: { id: string; pricing?: { input?: string; output?: string } }[] };
const results = [];
let unavailable = false;
for (const model of candidates) {
  if (unavailable) break;
  const pricing = catalog.data.find((entry) => entry.id === model)?.pricing;
  if (!pricing) throw new Error(`Model ${model} is unavailable in the gateway catalog`);
  for (const item of cases) {
    const started = performance.now();
    try {
      const result = await generateText({
        model,
        system: RUBRIC_SYSTEM_PROMPT,
        output: Output.object({ schema: GatewayJudgmentSchema }),
        prompt: `Allowed topic IDs: ${ROOT_TOPIC_IDS.join(", ")}\nTitle: ${item.title}\nSummary: ${item.summary}`,
        maxOutputTokens: 1000,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(45_000),
      });
      const inputTokens = result.usage.inputTokens ?? 0;
      const outputTokens = result.usage.outputTokens ?? 0;
      results.push({ model, case: item.id, expectedRelevant: item.relevant, actualRelevant: result.output.relevant, correct: item.relevant === result.output.relevant, score: result.output.score, latencyMs: Math.round(performance.now() - started), inputTokens, outputTokens, estimatedUsd: inputTokens * Number(pricing.input ?? 0) + outputTokens * Number(pricing.output ?? 0) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Model call failed";
      process.exitCode = 1;
      results.push({ model, case: item.id, error: message.slice(0, 200), latencyMs: Math.round(performance.now() - started) });
      if (/unauthenticated|authentication|credentials/i.test(message)) {
        unavailable = true;
        process.exitCode = 1;
        break;
      }
    }
  }
}
console.log(JSON.stringify({ note: "Small synthetic smoke benchmark, not a representative held-out evaluation; costs use catalog prices and exclude provider-specific variation.", results }, null, 2));
