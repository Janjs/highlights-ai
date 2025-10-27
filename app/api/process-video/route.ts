import { NextRequest, NextResponse } from "next/server"
import { writeFile, readFile, unlink } from "fs/promises"
import { exec } from "child_process"
import { promisify } from "util"
import path from "path"

const execAsync = promisify(exec)

export async function POST(request: NextRequest) {
    console.log("[API] POST /api/process-video - Request received")

    try {
        console.log("[API] Parsing form data...")
        const formData = await request.formData()
        const file = formData.get("video") as File

        if (!file) {
            console.log("[API] ERROR: No video file provided")
            return NextResponse.json({ error: "No video file provided" }, { status: 400 })
        }

        console.log(`[API] File received: ${file.name}, size: ${file.size} bytes`)

        const bytes = await file.arrayBuffer()
        const buffer = Buffer.from(bytes)

        const projectRoot = process.cwd()
        const videoPath = path.join(projectRoot, "input.mp4")
        const scenesJsonPath = path.join(projectRoot, "scenes.json")

        console.log(`[API] Writing video to: ${videoPath}`)
        await writeFile(videoPath, buffer)
        console.log("[API] Video file written successfully")

        console.log("[API] Running Python script...")
        const pythonScriptPath = path.join(projectRoot, "highlights-clipper.py")
        console.log(`[API] Python command: python3 ${pythonScriptPath}`)

        const { stdout, stderr } = await execAsync(`python3 ${pythonScriptPath}`, {
            cwd: projectRoot,
        })

        console.log("[API] Python script output:", stdout)
        if (stderr) console.log("[API] Python script stderr:", stderr)

        console.log(`[API] Reading scenes from: ${scenesJsonPath}`)
        const scenesData = await readFile(scenesJsonPath, "utf-8")
        const scenes = JSON.parse(scenesData)
        console.log(`[API] Parsed ${scenes.length} scenes`)

        console.log("[API] Keeping input.mp4 and scenes.json for debugging")

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
