import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, it, mock, test } from "node:test"

import * as errors from "@superbuilders/errors"
import { pino } from "pino"

import { ErrCanceled, ErrTimeout, timeout } from "#context.ts"
import { span } from "#span.ts"
import { active } from "#tracer.ts"

type CapturedLine = {
	msg: string
	spanName?: string
	trace?: { event: string }
	attrs?: Record<string, unknown>
	eventName?: string
	durationMs?: number
	failed?: boolean
}

/**
 * A real pino logger writing synchronously into an array, so tests can
 * assert the exact structured events the span machinery emits.
 */
function captureLogger(): { logger: ReturnType<typeof pino>; lines: CapturedLine[] } {
	const lines: CapturedLine[] = []
	const logger = pino(
		{ level: "debug", base: undefined },
		{
			write(line: string) {
				lines.push(JSON.parse(line))
			}
		}
	)
	return { logger, lines }
}

function traceEvents(lines: CapturedLine[]): string[] {
	return lines
		.filter((line) => line.trace !== undefined)
		.map((line) => {
			if (line.trace === undefined) {
				throw errors.new("unreachable: filtered above")
			}
			return line.trace.event
		})
}

describe("span", () => {
	it("returns the fn result and logs start then end", async () => {
		const { logger, lines } = captureLogger()
		const opts = { logger, signal: new AbortController().signal }
		const result = await span(
			"unit.test",
			async function work() {
				return "value"
			},
			opts
		)
		assert.strictEqual(result, "value")
		assert.deepStrictEqual(traceEvents(lines), ["span_start", "span_end"])
		const end = lines[lines.length - 1]
		assert.ok(end)
		assert.strictEqual(end.failed, false)
		assert.strictEqual(typeof end.durationMs, "number")
	})

	it("propagates a rejection, records one failure, and ends failed", async () => {
		const { logger, lines } = captureLogger()
		const opts = { logger, signal: new AbortController().signal }
		const boom = errors.new("work exploded")
		const outcome = await span(
			"unit.fail",
			async function work(): Promise<string> {
				throw boom
			},
			opts
		).then(
			() => undefined,
			(err: Error) => err
		)
		assert.strictEqual(outcome, boom)
		assert.deepStrictEqual(traceEvents(lines), ["span_start", "span_fail", "span_end"])
		const end = lines[lines.length - 1]
		assert.ok(end)
		assert.strictEqual(end.failed, true)
	})

	it("a fn that called fail() before throwing records exactly one span_fail", async () => {
		const { logger, lines } = captureLogger()
		const opts = { logger, signal: new AbortController().signal }
		const boom = errors.new("handled then rethrown")
		await span(
			"unit.fail-once",
			async function work(activeSpan): Promise<string> {
				activeSpan.fail(boom, "explicit failure")
				throw boom
			},
			opts
		).then(
			() => undefined,
			() => undefined
		)
		const failEvents = traceEvents(lines).filter((event) => event === "span_fail")
		assert.strictEqual(failEvents.length, 1)
	})

	it("set() drops undefined attrs and logs the cleaned set", async () => {
		const { logger, lines } = captureLogger()
		const opts = { logger, signal: new AbortController().signal }
		await span(
			"unit.attrs",
			async function work(activeSpan) {
				activeSpan.set({ kept: "yes", dropped: undefined, count: 3 })
				return "ok"
			},
			opts
		)
		const attrsLine = lines.find((line) => line.trace?.event === "span_attrs")
		assert.ok(attrsLine)
		assert.deepStrictEqual(attrsLine.attrs, { kept: "yes", count: 3 })
	})

	it("event() logs the event name with cleaned attrs", async () => {
		const { logger, lines } = captureLogger()
		const opts = { logger, signal: new AbortController().signal }
		await span(
			"unit.events",
			async function work(activeSpan) {
				activeSpan.event("cache_miss", { key: "user:1", ignored: undefined })
				return "ok"
			},
			opts
		)
		const eventLine = lines.find((line) => line.trace?.event === "span_event")
		assert.ok(eventLine)
		assert.strictEqual(eventLine.eventName, "cache_miss")
		assert.deepStrictEqual(eventLine.attrs, { key: "user:1" })
	})

	it("threads opts through to the fn unchanged", async () => {
		const { logger } = captureLogger()
		const opts = { logger, signal: new AbortController().signal }
		await span(
			"unit.opts",
			async function work(_activeSpan, innerOpts) {
				assert.strictEqual(innerOpts.logger, opts.logger)
				assert.strictEqual(innerOpts.signal, opts.signal)
				return "ok"
			},
			opts
		)
	})
})

describe("timeout", () => {
	beforeEach(() => {
		mock.timers.enable({ apis: ["setTimeout"] })
	})

	afterEach(() => {
		mock.timers.reset()
	})

	test("aborts with a matchable ErrTimeout after the deadline", () => {
		const parent = new AbortController()
		const scoped = timeout(parent.signal, 5000)
		assert.strictEqual(scoped.signal.aborted, false)

		mock.timers.tick(5000)
		assert.strictEqual(scoped.signal.aborted, true)
		assert.ok(scoped.signal.reason instanceof Error)
		assert.strictEqual(errors.is(scoped.signal.reason, ErrTimeout), true)
		scoped[Symbol.dispose]()
	})

	test("parent abort with an Error reason propagates that exact reason", () => {
		const parent = new AbortController()
		const scoped = timeout(parent.signal, 5000)
		const reason = errors.new("caller canceled")
		parent.abort(reason)
		assert.strictEqual(scoped.signal.aborted, true)
		assert.strictEqual(scoped.signal.reason, reason)
		scoped[Symbol.dispose]()
	})

	test("parent abort with a non-Error reason becomes a matchable ErrCanceled", () => {
		const parent = new AbortController()
		const scoped = timeout(parent.signal, 5000)
		parent.abort("just a string")
		assert.strictEqual(scoped.signal.aborted, true)
		assert.ok(scoped.signal.reason instanceof Error)
		assert.strictEqual(errors.is(scoped.signal.reason, ErrCanceled), true)
		scoped[Symbol.dispose]()
	})

	test("a pre-aborted parent aborts the scoped signal immediately", () => {
		const parent = new AbortController()
		const reason = errors.new("already gone")
		parent.abort(reason)
		const scoped = timeout(parent.signal, 5000)
		assert.strictEqual(scoped.signal.aborted, true)
		assert.strictEqual(scoped.signal.reason, reason)
		scoped[Symbol.dispose]()
	})

	test("dispose clears the timer — no abort after the deadline", () => {
		const parent = new AbortController()
		const scoped = timeout(parent.signal, 5000)
		scoped[Symbol.dispose]()
		mock.timers.tick(10_000)
		assert.strictEqual(scoped.signal.aborted, false)
	})

	test("dispose detaches from the parent — later parent aborts do not propagate", () => {
		const parent = new AbortController()
		const scoped = timeout(parent.signal, 5000)
		scoped[Symbol.dispose]()
		parent.abort(errors.new("too late"))
		assert.strictEqual(scoped.signal.aborted, false)
	})

	test("dispose is idempotent", () => {
		const parent = new AbortController()
		const scoped = timeout(parent.signal, 5000)
		scoped[Symbol.dispose]()
		scoped[Symbol.dispose]()
		assert.strictEqual(scoped.signal.aborted, false)
	})

	test("works with using declarations", () => {
		const parent = new AbortController()
		let captured: AbortSignal | undefined
		{
			using scoped = timeout(parent.signal, 5000)
			captured = scoped.signal
		}
		mock.timers.tick(10_000)
		assert.ok(captured)
		assert.strictEqual(captured.aborted, false)
	})
})

describe("active", () => {
	it("returns empty trace ids outside any span", () => {
		assert.deepStrictEqual(active(), {})
	})
})
