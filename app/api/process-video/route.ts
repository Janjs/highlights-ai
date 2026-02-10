import { NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

const FLASK_API_URL = process.env.FLASK_API_URL || "http://localhost:5001"

export async function POST(request: NextRequest) {
    const contentType = request.headers.get("content-type") || ""

    try {
        const body = Buffer.from(await request.arrayBuffer())

        const { Agent, fetch: undiciFetch } = await import("undici")
        const agent = new Agent({
            headersTimeout: 60 * 60 * 1000,
            bodyTimeout: 60 * 60 * 1000,
            connectTimeout: 30 * 1000,
        })

        const response = await undiciFetch(`${FLASK_API_URL}/upload`, {
            method: "POST",
            headers: { "content-type": contentType },
            body,
            dispatcher: agent,
        })

        const data = (await response.json()) as Record<string, unknown>
        return NextResponse.json(data, { status: response.status })
    } catch (error) {
        console.error("[API] Flask proxy error:", error)
        return NextResponse.json(
            { error: "Failed to process video. Is the Flask backend running?" },
            { status: 502 },
        )
    }
}
