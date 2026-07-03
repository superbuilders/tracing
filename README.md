# @superbuilders/tracing

The observability spine for an application: one function, `tracing.span`, that runs your work inside an OpenTelemetry span **and** emits paired structured Pino events — plus a `Disposable` timeout signal with error-matchable reasons, all threaded through one `Options` bag.

The premise: OTel spans and structured logs answer the same question ("what happened, where, how long?") through two pipes, and keeping them in sync by hand is how they drift. Here a single call feeds both — every span emits `span_start` / `span_attrs` / `span_event` / `span_fail` / `span_end` log lines carrying the live `traceId`/`spanId`, so logs and traces correlate without any collector-side magic.

```typescript
import * as tracing from "@superbuilders/tracing"

async function loadCatalog(frontendId: string, opts: tracing.Options) {
	return tracing.span(
		"catalog.load",
		async function load(span, opts) {
			span.set({ frontendId })

			using scoped = tracing.timeout(opts.signal, 5_000)
			const rows = await fetchCatalog(frontendId, scoped.signal)

			span.event("catalog_fetched", { rowCount: rows.length })
			return rows
		},
		opts
	)
}
```

## Install

```
pnpm add @superbuilders/tracing pino
```

ESM only. `@opentelemetry/api` is a real dependency (it is the ecosystem's singleton API surface); `pino` is a peer — you bring your logger.

## The `Options` idiom

```typescript
type Options = {
	logger: Logger // pino
	signal: AbortSignal
}
```

`Options` is the cross-cutting context: the logger and the cancellation signal travel **together, as the last parameter**, through every function in a codebase. `span()` hands the same bag to your callback, so nesting spans is just passing `opts` down — child spans parent correctly through OTel's active-span context, and every log line stays correlated.

At the top of a process, construct it once:

```typescript
const opts: tracing.Options = { logger, signal: AbortSignal.timeout(30 * 60_000) }
```

## `tracing.span(name, fn, opts)`

Runs `fn` inside an active OTel span. The callback receives a `Span` handle and the threaded `opts`:

- **`span.set(attrs)`** — attach attributes (OTel `setAttributes` + a `span_attrs` log line). `undefined` values are dropped, so optional fields spread in cleanly.
- **`span.event(name, attrs?)`** — a point-in-time event (OTel `addEvent` + `span_event`).
- **`span.fail(error, message, attrs?)`** — record a failure *without throwing* (exception + ERROR status + `span_fail`). If `fn` later throws, the failure is not double-recorded.

A rejection from `fn` is recorded (once), the span ends `failed: true`, and the error propagates unchanged — `span` never swallows your errors. Conversely, telemetry never breaks your work: a throwing OTel span implementation is deliberately swallowed inside the recording path.

Attribute keys are compile-time guarded against the reserved trace-correlation names (`traceId`, `span_id`, `otel.trace_id`, …) — the `Attrs` type maps them to `never`, so a colliding key is a type error instead of a corrupted log correlation.

## `tracing.timeout(parent, ms)`

A scoped child signal that aborts on whichever comes first — the deadline or the parent — and cleans up with `using`:

```typescript
using scoped = tracing.timeout(opts.signal, 5_000)
const result = await errors.try(fetch(url, { signal: scoped.signal }))
if (result.error) {
	if (errors.is(scoped.signal.reason, tracing.ErrTimeout)) {
		throw errors.wrap(result.error, "catalog fetch deadline")
	}
	throw errors.wrap(result.error, "catalog fetch")
}
```

The reasons are **sentinel errors**, matchable through any wrap chain with [`errors.is`](https://github.com/superbuilders/errors):

- deadline → a wrap of **`ErrTimeout`** naming the duration
- parent aborted with an `Error` reason → **that exact reason**, untouched
- parent aborted with a non-Error reason → a wrap of **`ErrCanceled`**

Disposal (end of `using` scope) clears the timer and detaches from the parent; it is idempotent, and a disposed scope can never fire late.

## `tracing.active()`

The current `{ traceId, spanId }` (or `{}` outside any span) — for stamping trace context onto things that leave the process, like queue messages or response headers.

## Design notes

- **No exporter opinions.** This wraps `@opentelemetry/api` only; with no SDK registered, spans are no-ops but the structured log events still flow — the library degrades to a disciplined logging convention.
- **Errors discipline throughout**: failures are recorded from real `Error` values (built with `@superbuilders/errors`), and the timeout reasons are designed for `errors.is` matching rather than string comparison.

## License

[0BSD](./LICENSE) © Bjorn Pagen
