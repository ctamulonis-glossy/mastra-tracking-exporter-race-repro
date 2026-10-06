// A tool call whose input fails validation starts and ends its TOOL_CALL span in
// the same tick. TrackingExporter (the base of BraintrustExporter) handles the
// SPAN_ENDED event before the SPAN_STARTED event has registered the span, so the
// exported span is never ended; observability.shutdown() later closes it with
// "Observability is shutting down.". Exits 1 while the bug exists. No API keys.
import { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core/mastra';
import { createTool } from '@mastra/core/tools';
import { Observability } from '@mastra/observability';
import { BraintrustExporter } from '@mastra/braintrust';
import { z } from 'zod';

// A Braintrust logger stand-in that records which spans the exporter ended.
const spans = [];
const startSpan = ({ name }) => {
  const span = { name, ended: false, error: undefined };
  spans.push(span);
  return { id: name, startSpan, log: payload => { span.error ??= payload?.error; }, end: () => { span.ended = true; } };
};

// A model that calls `echo` with input its schema rejects, then answers.
const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
let calls = 0;
const stream = chunks => new ReadableStream({ start(controller) { chunks.forEach(chunk => controller.enqueue(chunk)); controller.close(); } });
const model = {
  specificationVersion: 'v3', provider: 'mock', modelId: 'mock', supportedUrls: {},
  doGenerate: async () => { throw new Error('not used'); },
  doStream: async () => ({
    stream: stream(calls++ === 0
      ? [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'echo', input: '{}' }, { type: 'finish', usage, finishReason: { unified: 'tool-calls', raw: 'tool_calls' } }]
      : [{ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: 'done' }, { type: 'text-end', id: 't' }, { type: 'finish', usage, finishReason: { unified: 'stop', raw: 'stop' } }]),
  }),
};

const echo = createTool({ id: 'echo', description: 'Echo text.', inputSchema: z.object({ text: z.string() }), execute: async ({ text }) => ({ text }) });
const agent = new Agent({ id: 'agent', name: 'Agent', instructions: 'Test.', model, tools: { echo } });
const observability = new Observability({
  configs: { default: { serviceName: 'repro', exporters: [new BraintrustExporter({ braintrustLogger: { startSpan } })] } },
});
new Mastra({ logger: false, agents: { agent }, observability });

await (await agent.stream('hello')).consumeStream();
await observability.getDefaultInstance()?.flush();
const openAfterRun = spans.filter(span => !span.ended).map(span => span.name);
await observability.shutdown();

console.log('exported spans:', spans.map(span => span.name).join(', '));
console.log('still open after the run:', openAfterRun);
console.log('closed by shutdown:', spans.filter(span => span.error).map(span => `${span.name} (${span.error})`));
if (openAfterRun.length) {
  console.error('BUG: a span that ended during the run was never ended by the exporter.');
  process.exit(1);
}
console.log('OK: every span ended.');
