import { NextRequest } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const FLASK_API_URL = process.env.FLASK_API_URL || "http://localhost:5001"

export async function GET(request: NextRequest) {
    try {
        const headers: Record<string, string> = {}
        const range = request.headers.get("range")
        if (range) headers["range"] = range

        const { Agent, fetch: undiciFetch } = await import("undici")
        const agent = new Agent({
            headersTimeout: 60 * 1000,
            bodyTimeout: 60 * 60 * 1000,
            connectTimeout: 10 * 1000,
        })

        const response = await undiciFetch(`${FLASK_API_URL}/video`, {
            headers,
            dispatcher: agent,
        })

        const responseHeaders: Record<string, string> = {
            "Content-Type": "video/mp4",
            "Accept-Ranges": "bytes",
        }

        const contentLength = response.headers.get("content-length")
        if (contentLength) responseHeaders["Content-Length"] = contentLength

        const contentRange = response.headers.get("content-range")
        if (contentRange) responseHeaders["Content-Range"] = contentRange

        return new Response(response.body as unknown as ReadableStream, {
            status: response.status,
            headers: responseHeaders,
        })
    } catch (error) {
        console.error("[API] Flask proxy error:", error)
        return new Response(JSON.stringify({ error: "Video not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
        })
    }
}
