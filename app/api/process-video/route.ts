import { NextRequest, NextResponse } from "next/server"
import { writeFile, readFile, unlink } from "fs/promises"
import { exec } from "child_process"
import { promisify } from "util"
import path from "path"
import { performance } from "perf_hooks"

const execAsync = promisify(exec)

export async function POST(request: NextRequest) {
    const requestStart = performance.now()
    console.log("[API] POST /api/process-video - Request received")

    try {
        const formDataStart = performance.now()
        console.log("[API] Parsing form data...")
        const formData = await request.formData()
        const file = formData.get("video") as File
        console.log(`[API] Form data parsed in ${(performance.now() - formDataStart).toFixed(2)}ms`)

        if (!file) {
            console.log("[API] ERROR: No video file provided")
            return NextResponse.json({ error: "No video file provided" }, { status: 400 })
        }

        console.log(`[API] File received: ${file.name}, size: ${(file.size / 1024 / 1024).toFixed(2)} MB`)

        const bytesStart = performance.now()
        const bytes = await file.arrayBuffer()
        const buffer = Buffer.from(bytes)
        console.log(`[API] Buffer created in ${(performance.now() - bytesStart).toFixed(2)}ms`)

        const projectRoot = process.cwd()
        const videoPath = path.join(projectRoot, "input.mp4")
        const scenesJsonPath = path.join(projectRoot, "scenes.json")

        const writeStart = performance.now()
        console.log(`[API] Writing video to: ${videoPath}`)
        await writeFile(videoPath, buffer)
        console.log(`[API] Video file written in ${(performance.now() - writeStart).toFixed(2)}ms`)

        const pythonStart = performance.now()
        console.log("[API] Running Python script...")
        const pythonScriptPath = path.join(projectRoot, "highlights-clipper.py")
        console.log(`[API] Python command: python3 ${pythonScriptPath}`)

        const { stdout, stderr } = await execAsync(`python3 ${pythonScriptPath}`, {
            cwd: projectRoot,
        })

        const pythonEnd = performance.now()
        const pythonTime = (pythonEnd - pythonStart) / 1000
        console.log(`[API] Python script completed in ${pythonTime.toFixed(2)}s`)
        console.log("[API] Python script output:", stdout)
        if (stderr) console.log("[API] Python script stderr:", stderr)

        const readStart = performance.now()
        console.log(`[API] Reading scenes from: ${scenesJsonPath}`)
        const scenesData = await readFile(scenesJsonPath, "utf-8")
        const scenes = JSON.parse(scenesData)
        console.log(`[API] Scenes read and parsed in ${(performance.now() - readStart).toFixed(2)}ms`)
        console.log(`[API] Parsed ${scenes.length} scenes`)

        console.log("[API] Keeping input.mp4 and scenes.json for debugging")

        const totalTime = (performance.now() - requestStart) / 1000
        console.log(`[API] Total API time: ${totalTime.toFixed(2)}s`)
        console.log(`[API] Breakdown: Upload=${(writeStart - formDataStart).toFixed(2)}ms, Python=${pythonTime.toFixed(2)}s, Read=${(performance.now() - readStart).toFixed(2)}ms`)

        console.log("[API] Returning response with scenes")
        return NextResponse.json({ scenes })
    } catch (error) {
        console.error("[API] ERROR:", error)

        const errorMessage = error instanceof Error ? error.message : "Unknown error"
        return NextResponse.json(
            { error: `Failed to process video: ${errorMessage}` },
            { status: 500 }
        )
    }
}
