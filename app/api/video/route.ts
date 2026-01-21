import { NextRequest, NextResponse } from "next/server"
import { stat } from "fs/promises"
import { createReadStream } from "fs"
import path from "path"
import { Readable } from "stream"

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
    try {
        const cacheDir = path.join(process.cwd(), ".cache")
        const videoPath = path.join(cacheDir, "input.mp4")
        const fileStats = await stat(videoPath)
        const fileSize = fileStats.size

        const rangeHeader = request.headers.get("range")

        if (rangeHeader) {
            const parts = rangeHeader.replace(/bytes=/, "").split("-")
            let start = parseInt(parts[0], 10)
            let end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1

            // Clamp values to valid range
            start = Math.max(0, Math.min(start, fileSize - 1))
            end = Math.max(start, Math.min(end, fileSize - 1))

            const chunkSize = end - start + 1

            const stream = createReadStream(videoPath, { start, end })
            const readable = Readable.toWeb(stream) as ReadableStream<Uint8Array>

            return new NextResponse(readable, {
                status: 206,
                headers: {
                    "Content-Range": `bytes ${start}-${end}/${fileSize}`,
                    "Accept-Ranges": "bytes",
                    "Content-Length": chunkSize.toString(),
                    "Content-Type": "video/mp4",
                },
            })
        } else {
            const stream = createReadStream(videoPath)
            const readable = Readable.toWeb(stream) as ReadableStream<Uint8Array>

            return new NextResponse(readable, {
                status: 200,
                headers: {
                    "Content-Length": fileSize.toString(),
                    "Content-Type": "video/mp4",
                    "Accept-Ranges": "bytes",
                },
            })
        }
    } catch (error) {
        console.error("[API] Error serving video:", error)
        return NextResponse.json({ error: "Video not found" }, { status: 404 })
    }
}

