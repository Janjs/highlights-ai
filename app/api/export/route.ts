import { NextRequest, NextResponse } from "next/server"
import { stat, readFile } from "fs/promises"
import { exec } from "child_process"
import { promisify } from "util"
import path from "path"
import { performance } from "perf_hooks"

const execAsync = promisify(exec)

export const runtime = 'nodejs'
// Increase max duration for video processing
export const maxDuration = 300
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
    const requestStart = performance.now()
    console.log("[API] POST /api/export - Request received")

    try {
        const body = await request.json()
        const { segments } = body

        if (!segments || !Array.isArray(segments) || segments.length === 0) {
            return NextResponse.json(
                { error: "No segments provided" },
                { status: 400 }
            )
        }

        console.log(`[API] Exporting ${segments.length} segments`)

        const projectRoot = process.cwd()
        const cacheDir = path.join(projectRoot, ".cache")
        const inputVideoPath = path.join(cacheDir, "input.mp4")
        const exportDir = path.join(cacheDir, "exports")

        const { mkdir } = await import("fs/promises")
        await mkdir(exportDir, { recursive: true })

        // Check if input video exists
        try {
            await stat(inputVideoPath)
        } catch (error) {
            console.error("[API] Input video not found:", error)
            return NextResponse.json(
                { error: "Input video not found. Please upload a video first." },
                { status: 404 }
            )
        }

        const timestamp = Date.now()
        const outputFilename = `export_${timestamp}.mp4`
        const outputPath = path.join(exportDir, outputFilename)

        // Generate FFmpeg filter complex
        // We need to trim each segment and then concatenate them
        // [0:v]trim=start=0:end=10,setpts=PTS-STARTPTS[v0];
        // [0:a]atrim=start=0:end=10,asetpts=PTS-STARTPTS[a0];
        // ...
        // [v0][a0][v1][a1]...concat=n=N:v=1:a=1[outv][outa]

        let filterComplex = ""
        let inputs = ""

        segments.forEach((seg: { start: number, end: number }, index: number) => {
            // Add safety buffer to avoid seek issues, but keep precise for user
            // Using trim and atrim
            filterComplex += `[0:v]trim=start=${seg.start}:end=${seg.end},setpts=PTS-STARTPTS[v${index}];`
            filterComplex += `[0:a]atrim=start=${seg.start}:end=${seg.end},asetpts=PTS-STARTPTS[a${index}];`
            inputs += `[v${index}][a${index}]`
        })

        filterComplex += `${inputs}concat=n=${segments.length}:v=1:a=1[outv][outa]`

        // Construct the full command
        // Using -preset ultrafast for speed during testing, change to medium/slow for production if needed
        const command = `ffmpeg -i "${inputVideoPath}" -filter_complex "${filterComplex}" -map "[outv]" -map "[outa]" -c:v libx264 -preset medium -crf 23 -c:a aac -b:a 128k -movflags +faststart "${outputPath}" -y`

        console.log("[API] Running FFmpeg command...")
        // verbose log for debugging if needed, but keeping it clean for now

        const ffmpegStart = performance.now()
        await execAsync(command)
        console.log(`[API] FFmpeg finished in ${((performance.now() - ffmpegStart) / 1000).toFixed(2)}s`)

        // Read the file and return it
        const fileBuffer = await readFile(outputPath)

        // Return as a downloadable file
        return new NextResponse(new Uint8Array(fileBuffer), {
            headers: {
                "Content-Type": "video/mp4",
                "Content-Disposition": `attachment; filename="highlight-export.mp4"`,
                "Content-Length": fileBuffer.length.toString(),
            },
        })

    } catch (error) {
        console.error("[API] Export error:", error)
        const errorMessage = error instanceof Error ? error.message : "Unknown error"
        return NextResponse.json(
            { error: `Export failed: ${errorMessage}` },
            { status: 500 }
        )
    }
}
