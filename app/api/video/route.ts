import { NextRequest, NextResponse } from "next/server"
import { readFile, stat } from "fs/promises"
import path from "path"

export async function GET(request: NextRequest) {
    try {
        const videoPath = path.join(process.cwd(), "input.mp4")

        const fileStats = await stat(videoPath)
        const fileBuffer = await readFile(videoPath)

        return new NextResponse(fileBuffer, {
            status: 200,
            headers: {
                "Content-Type": "video/mp4",
                "Content-Length": fileStats.size.toString(),
                "Accept-Ranges": "bytes",
            },
        })
    } catch (error) {
        console.error("[API] Error serving video:", error)
        return NextResponse.json({ error: "Video not found" }, { status: 404 })
    }
}

