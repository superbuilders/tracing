import * as errors from "@superbuilders/errors"

type AttrValue = string | number | boolean | string[] | number[] | boolean[]

type ReservedTraceAttrKey =
	| "traceId"
	| "spanId"
	| "trace.id"
	| "span.id"
	| "trace_id"
	| "span_id"
	| "otel.trace_id"
	| "otel.span_id"
	| "tracing.id"

type Attrs = Readonly<
	Record<string, AttrValue | undefined> & Partial<Record<ReservedTraceAttrKey, never>>
>

type Options = {
	logger: import("pino").Logger
	signal: AbortSignal
}

type ScopedSignal = Disposable & {
	readonly signal: AbortSignal
}

const ErrTimeout = errors.new("operation timeout")
const ErrCanceled = errors.new("operation canceled")

function isErrorReason(value: unknown): value is Error {
	return (
		typeof value === "object" &&
		value !== null &&
		"message" in value &&
		typeof value.message === "string"
	)
}

function abortReasonFromParent(parent: AbortSignal): Error {
	if (isErrorReason(parent.reason)) {
		return parent.reason
	}
	return errors.wrap(ErrCanceled, "parent signal")
}

function timeoutReason(timeoutMs: number): Error {
	return errors.wrap(ErrTimeout, `timeout ${timeoutMs}ms`)
}

function timeout(parent: AbortSignal, timeoutMs: number): ScopedSignal {
	const controller = new AbortController()
	let disposed = false

	function abortFromParent(): void {
		if (controller.signal.aborted) {
			return
		}
		controller.abort(abortReasonFromParent(parent))
	}

	if (parent.aborted) {
		abortFromParent()
	} else {
		parent.addEventListener("abort", abortFromParent, { once: true })
	}

	const timeoutId = setTimeout(function abortTimedOut() {
		if (!controller.signal.aborted) {
			controller.abort(timeoutReason(timeoutMs))
		}
	}, timeoutMs)

	return {
		signal: controller.signal,
		[Symbol.dispose](): void {
			if (disposed) {
				return
			}
			disposed = true
			clearTimeout(timeoutId)
			parent.removeEventListener("abort", abortFromParent)
		}
	}
}

export { ErrCanceled, ErrTimeout, timeout }
export type { AttrValue, Attrs, Options, ReservedTraceAttrKey, ScopedSignal }
