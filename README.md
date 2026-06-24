# @superbuilders/tracing

Scoped OpenTelemetry tracing primitives for Superbuilders applications.

A thin wrapper over `@opentelemetry/api` that pairs every span with structured
Pino logging, propagates a cancellation `AbortSignal` through an `Options` bag,
and exposes a scoped `timeout()` helper built on `AbortController`.

## Install

```sh
bun add @superbuilders/tracing
# peer dependency
bun add pino
```

## Usage

```typescript
import * as tracing from "@superbuilders/tracing"
import { logger } from "@/logger"

async function loadCatalog(frontendId: string, opts: tracing.Options) {
	return tracing.span("load.catalog", async function load(span, opts) {
		span.set({ frontendId })
		using scoped = tracing.timeout(opts.signal, 5000)
		// ... do work with scoped.signal ...
		span.event("loaded")
		return result
	}, opts)
}

await loadCatalog("frontend_1", { logger, signal: AbortSignal.timeout(30_000) })
```

`tracing.Options` (logger + signal) is always the **last** parameter, both on
your own functions and on the `span()` callback.

## Exports

- `.` — `span`, `active`, `timeout`, `ErrTimeout`, `ErrCanceled`, and the
  `Span`, `Options`, `Attrs`, `AttrValue`, `ScopedSignal`, `ActiveTrace` types.
- `./context` — `timeout`, `ErrTimeout`, `ErrCanceled` + context types.
- `./span` — `span` + the `Span` type.

Errors are created with [`@superbuilders/errors`](https://github.com/superbuilders/errors).

## License

0BSD
