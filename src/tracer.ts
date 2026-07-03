import { trace } from "@opentelemetry/api"

type ActiveTrace = {
	traceId?: string
	spanId?: string
}

function active(): ActiveTrace {
	const spanContext = trace.getActiveSpan()?.spanContext()
	if (spanContext === undefined) {
		return {}
	}
	return {
		traceId: spanContext.traceId,
		spanId: spanContext.spanId
	}
}

export type {
	Attrs,
	AttrValue,
	Options,
	ReservedTraceAttrKey,
	ScopedSignal
} from "#context.ts"
export { ErrCanceled, ErrTimeout, timeout } from "#context.ts"
export type { Span } from "#span.ts"
export { span } from "#span.ts"
export type { ActiveTrace }
export { active }
