import type * as otel from "@opentelemetry/api"
import { SpanStatusCode, trace } from "@opentelemetry/api"
import * as errors from "@superbuilders/errors"
import type { Logger } from "pino"

import type { Attrs, Options } from "#context.ts"

const tracer = trace.getTracer("@superbuilders/tracing")

type Span = {
	set(attrs: Attrs): void
	event(name: string, attrs?: Attrs): void
	fail(error: Error, message: string, attrs?: Attrs): void
}

type FailureSpan = {
	recordException(error: Error): void
	setStatus(status: { code: SpanStatusCode; message?: string }): void
}

type TraceLogEvent = "span_start" | "span_attrs" | "span_event" | "span_fail" | "span_end"

function cleanAttrs(attrs: Attrs | undefined): otel.Attributes {
	const clean: otel.Attributes = {}
	if (attrs === undefined) {
		return clean
	}
	for (const [key, value] of Object.entries(attrs)) {
		if (value !== undefined) {
			clean[key] = value
		}
	}
	return clean
}

/**
 * Records the exception and ERROR status on the OTel span. A throwing span
 * implementation or exporter is deliberately swallowed — telemetry recording
 * must never break the traced operation.
 */
function recordSpanFailure(otelSpan: FailureSpan, error: Error, message: string): void {
	errors.trySync(function recordExceptionAndStatus() {
		otelSpan.recordException(error)
		otelSpan.setStatus({ code: SpanStatusCode.ERROR, message })
	})
}

function traceLog(
	event: TraceLogEvent,
	otelSpan: otel.Span
): { event: TraceLogEvent; traceId: string; spanId: string } {
	const spanContext = otelSpan.spanContext()
	return { event, traceId: spanContext.traceId, spanId: spanContext.spanId }
}

function recordFailure(
	otelSpan: otel.Span,
	logger: Logger,
	error: Error,
	message: string,
	spanName: string,
	logAttrs?: Attrs
): void {
	recordSpanFailure(otelSpan, error, message)
	logger.error({ ...logAttrs, trace: traceLog("span_fail", otelSpan), spanName, error }, message)
}

async function span<T>(name: string, fn: (span: Span, opts: Options) => Promise<T>, opts: Options): Promise<T> {
	return tracer.startActiveSpan(name, async function active(otelSpan) {
		const startedAt = performance.now()
		let failed = false
		opts.logger.debug({ trace: traceLog("span_start", otelSpan), spanName: name }, "span start")
		const activeSpan: Span = {
			set(nextAttrs: Attrs): void {
				const attrs = cleanAttrs(nextAttrs)
				otelSpan.setAttributes(attrs)
				opts.logger.debug({ trace: traceLog("span_attrs", otelSpan), spanName: name, attrs }, "span attrs")
			},
			event(eventName: string, eventAttrs?: Attrs): void {
				const attrs = cleanAttrs(eventAttrs)
				otelSpan.addEvent(eventName, attrs)
				opts.logger.debug({ trace: traceLog("span_event", otelSpan), spanName: name, eventName, attrs }, "span event")
			},
			fail(error: Error, message: string, logAttrs?: Attrs): void {
				failed = true
				recordFailure(otelSpan, opts.logger, error, message, name, logAttrs)
			}
		}

		function endSpan(endedFailed: boolean): void {
			otelSpan.end()
			opts.logger.debug(
				{
					trace: traceLog("span_end", otelSpan),
					spanName: name,
					durationMs: Math.round(performance.now() - startedAt),
					failed: endedFailed
				},
				"span end"
			)
		}

		const result = await errors.try(fn(activeSpan, opts))
		if (result.error) {
			if (!failed) {
				recordSpanFailure(otelSpan, result.error, `${name} failed`)
				opts.logger.error(
					{ trace: traceLog("span_fail", otelSpan), spanName: name, error: result.error },
					`${name} failed`
				)
			}
			endSpan(true)
			throw result.error
		}

		endSpan(failed)
		return result.data
	})
}

export type { Span }
export { span }
