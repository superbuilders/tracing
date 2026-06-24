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

export { ErrCanceled, ErrTimeout, timeout } from "@superbuilders/tracing/context"
export type {
	AttrValue,
	Attrs,
	Options,
	ReservedTraceAttrKey,
	ScopedSignal
} from "@superbuilders/tracing/context"
export { span } from "@superbuilders/tracing/span"
export type { Span } from "@superbuilders/tracing/span"
export { active }
export type { ActiveTrace }
