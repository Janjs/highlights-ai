import { NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"
export const maxDuration = 300
export const dynamic = "force-dynamic"

const FLASK_API_URL = process.env.FLASK_API_URL || "http://localhost:5001"

export async function POST(request: NextRequest) {
    try {
        const body = await request.json()

        const { Agent, fetch: undiciFetch } = await import("undici")
        const agent = new Agent({
            headersTimeout: 60 * 60 * 1000,
            bodyTimeout: 60 * 60 * 1000,
            connectTimeout: 30 * 1000,
        })

        const response = await undiciFetch(`${FLASK_API_URL}/export`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            dispatcher: agent,
        })

        if (!response.ok) {
            const errorData = (await response.json()) as Record<string, unknown>
            return NextResponse.json(errorData, { status: response.status })
        }

        return new Response(response.body as unknown as ReadableStream, {
            headers: {
                "Content-Type": "video/mp4",
                "Content-Disposition": 'attachment; filename="highlight-export.mp4"',
            },
        })
    } catch (error) {
        console.error("[API] Flask proxy error:", error)
        return NextResponse.json(
            { error: "Export failed. Is the Flask backend running?" },
            { status: 502 },
        )
    }
}
