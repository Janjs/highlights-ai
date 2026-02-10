import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const FLASK_API_URL = process.env.FLASK_API_URL || "http://localhost:5001"

async function flaskFetch(path: string, options?: { method?: string }) {
    const { Agent, fetch: undiciFetch } = await import("undici")
    const agent = new Agent({
        headersTimeout: 30 * 1000,
        bodyTimeout: 30 * 1000,
        connectTimeout: 10 * 1000,
    })
    return undiciFetch(`${FLASK_API_URL}${path}`, {
        ...options,
        dispatcher: agent,
    })
}

export async function GET() {
    try {
        const response = await flaskFetch("/cache")
        const data = (await response.json()) as Record<string, unknown>
        return NextResponse.json(data)
    } catch (error) {
        console.error("[API] Flask proxy error:", error)
        return NextResponse.json({ exists: false })
    }
}

export async function DELETE() {
    try {
        const response = await flaskFetch("/cache", { method: "DELETE" })
        const data = (await response.json()) as Record<string, unknown>
        return NextResponse.json(data, { status: response.status })
    } catch (error) {
        console.error("[API] Flask proxy error:", error)
        return NextResponse.json({ success: false }, { status: 502 })
    }
}
