import { NextRequest, NextResponse } from "next"
import { writeFile, readFile, unlink } from "fs/promises"
import { exec } from "child_process"
import { promisify } from "util"
import path from "path"

const execAsync = promisify(exec)

export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData()
        const file = formData.get("video") as File

        if (!file) {
            return NextResponse.json({ error: "No video file provided" }, { status: 400 })
        }

        const bytes = await file.arrayBuffer()
        const buffer = Buffer.from(bytes)

        const projectRoot = process.cwd()
        const videoPath = path.join(projectRoot, "input.mp4")
        const scenesJsonPath = path.join(projectRoot, "scenes.json")

        await writeFile(videoPath, buffer)

        try {
            const { stdout, stderr } = await execAsync(`python3 ${path.join(projectRoot, "highlights-clipper.py")}`, {
                cwd: projectRoot,
            })

            console.log("Python script output:", stdout)
            if (stderr) console.error("Python script errors:", stderr)

            const scenesData = await readFile(scenesJsonPath, "utf-8")
            const scenes = JSON.parse(scenesData)

            await unlink(videoPath)
            await unlink(scenesJsonPath)

            return NextResponse.json({ scenes })
        } catch (error) {
            console.error("Error running Python script:", error)
            try {
                await unlink(videoPath)
            } catch { }
            return NextResponse.json(
                { error: "Failed to process video. Make sure Python and required dependencies are installed." },
                { status: 500 },
            )
        }
    } catch (error) {
        console.error("Error processing request:", error)
        return NextResponse.json({ error: "Failed to process video upload" }, { status: 500 })
    }
}

