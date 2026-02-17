import { NextResponse } from "next/server"

export const runtime = "nodejs"

const FLASK_API_URL = process.env.FLASK_API_URL || "http://localhost:5001"

export async function DELETE() {
    try {
        const response = await fetch(`${FLASK_API_URL}/balls/cache`, {
            method: "DELETE",
        })

        if (!response.ok) {
            throw new Error(`Flask API returned ${response.status}`)
        }

        const data = await response.json()
        return NextResponse.json(data)
    } catch {
        return NextResponse.json({ success: true })
    }
}
