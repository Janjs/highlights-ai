export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

const FLASK_API_URL = process.env.FLASK_API_URL || "http://localhost:5001"
const FRAME_SKIP = Number(process.env.ROBOFLOW_FRAME_SKIP || "2")
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

        const response = await undiciFetch(`${FLASK_API_URL}/balls/stream`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                frame_skip: Number.isFinite(FRAME_SKIP) ? FRAME_SKIP : 2,
                confidence_threshold: Number.isFinite(CONFIDENCE_THRESHOLD) ? CONFIDENCE_THRESHOLD : 0.25,
                max_workers: Number.isFinite(MAX_WORKERS) ? MAX_WORKERS : 4,
                infer_max_width: Number.isFinite(INFER_MAX_WIDTH) ? INFER_MAX_WIDTH : 960,
            }),
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
