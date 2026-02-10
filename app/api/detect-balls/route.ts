export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

const FLASK_API_URL = process.env.FLASK_API_URL || "http://localhost:5001"

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
            body: JSON.stringify({ frame_skip: 2 }),
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
