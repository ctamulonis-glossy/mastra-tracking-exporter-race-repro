# TrackingExporter never ends a span that ends in the tick it starts

Minimal reproduction for a Mastra observability bug.

A tool call whose input fails validation starts its `tool_call` span and ends it in
the same synchronous tick. `TrackingExporter` (the base class of `BraintrustExporter`)
handles each tracing event concurrently: registering a started span awaits
`_buildSpan` before `traceData.addSpan`, while handling the end calls
`traceData.endSpan` with one await fewer. So the end is processed first (it finds no
span to finish), the start then registers the span as active, and nothing ever ends
it. `observability.shutdown()` later aborts it with "Observability is shutting
down.", so in Braintrust the tool span, and the trace, lasts until the process stops.

```sh
npm install
npm run repro   # exits 1 while the bug is present; no API keys needed
```

Output on `@mastra/core` 1.74.0, `@mastra/observability` 1.18.3, `@mastra/braintrust` 1.3.18
(also 1.75.0-alpha.6 / 1.18.4-alpha.0 / 1.3.19-alpha.0):

```
still open after the run: [ "tool: 'echo'" ]
closed by shutdown: [ "tool: 'echo' (Observability is shutting down.)" ]
BUG: a span that ended during the run was never ended by the exporter.
```

The model is a hand-written `LanguageModelV3` that calls `echo` with `{}` (its schema
requires `text`); the Braintrust logger is a stand-in that records which spans were ended.
