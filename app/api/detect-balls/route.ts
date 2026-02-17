export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

const FLASK_API_URL = process.env.FLASK_API_URL || "http://localhost:5001"
const RAW_FRAME_SKIP = process.env.ROBOFLOW_FRAME_SKIP
const FRAME_SKIP = RAW_FRAME_SKIP == null ? undefined : Number(RAW_FRAME_SKIP)
const CONFIDENCE_THRESHOLD = Number(process.env.ROBOFLOW_CONFIDENCE_THRESHOLD || "0.25")
const MAX_WORKERS = Number(process.env.ROBOFLOW_MAX_WORKERS || "4")
const INFER_MAX_WIDTH = Number(process.env.ROBOFLOW_INFER_MAX_WIDTH || "960")

export async function POST() {
    try {
        const { Agent, fetch: undiciFetch } = await import("undici")
        const agent = new Agent({
            headersTimeout: 60 * 60 * 1000,
            bodyTimeout: 60 * 60 * 1000,
            connectTimeout: 10 * 1000,
        })

        const payload: Record<string, number> = {}
        if (FRAME_SKIP !== undefined && Number.isFinite(FRAME_SKIP) && FRAME_SKIP >= 0) {
            payload.frame_skip = FRAME_SKIP
        }
        if (Number.isFinite(CONFIDENCE_THRESHOLD)) {
            payload.confidence_threshold = CONFIDENCE_THRESHOLD
        }
        if (Number.isFinite(MAX_WORKERS)) {
            payload.max_workers = MAX_WORKERS
        }
        if (Number.isFinite(INFER_MAX_WIDTH)) {
            payload.infer_max_width = INFER_MAX_WIDTH
        }

        const response = await undiciFetch(`${FLASK_API_URL}/balls/stream`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            dispatcher: agent,
        })

        if (!response.ok) {
            throw new Error(`Flask API returned ${response.status}`)
        }

        return new Response(response.body as unknown as ReadableStream, {
            headers: { "Content-Type": "application/x-ndjson" },
        })
    } catch (error) {
        console.error("[API] Flask proxy error:", error)
        const encoder = new TextEncoder()
        return new Response(
            encoder.encode(JSON.stringify({ type: "error", message: "Ball detection service unavailable. Is the Flask backend running?" }) + "\n"),
            { status: 502, headers: { "Content-Type": "application/x-ndjson" } },
        )
    }
}
