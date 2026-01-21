import { NextRequest, NextResponse } from "next/server"
import { stat } from "fs/promises"
import { readFile } from "fs/promises"
import path from "path"

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
    try {
        const projectRoot = process.cwd()
        const cacheDir = path.join(projectRoot, ".cache")
        const videoPath = path.join(cacheDir, "input.mp4")
        const scenesPath = path.join(cacheDir, "scenes.json")
        const ballDetectionsPath = path.join(cacheDir, "ball_detections.json")

        try {
            const videoStats = await stat(videoPath)
            const scenesData = await readFile(scenesPath, "utf-8")
            const scenes = JSON.parse(scenesData)

            // Try to load ball detections (optional)
            let ballDetections = []
            try {
                const ballData = await readFile(ballDetectionsPath, "utf-8")
                ballDetections = JSON.parse(ballData)
            } catch {
                // Ball detections may not exist
            }

            return NextResponse.json({
                exists: true,
                videoSize: videoStats.size,
                scenes,
                ballDetections,
            })
        } catch (error) {
            return NextResponse.json({
                exists: false,
            })
        }
    } catch (error) {
        console.error("[API] Error checking cache:", error)
        return NextResponse.json({ exists: false }, { status: 500 })
    }
}

export async function DELETE() {
    try {
        const { unlink } = await import("fs/promises")
        const projectRoot = process.cwd()
        const cacheDir = path.join(projectRoot, ".cache")
        const videoPath = path.join(cacheDir, "input.mp4")
        const originalVideoPath = path.join(cacheDir, "input_original.mp4")
        const scenesPath = path.join(cacheDir, "scenes.json")
        const ballDetectionsPath = path.join(cacheDir, "ball_detections.json")

        const filesToDelete = [videoPath, originalVideoPath, scenesPath, ballDetectionsPath]
        const deleted: string[] = []
        const errors: string[] = []

        for (const filePath of filesToDelete) {
            try {
                await unlink(filePath)
                deleted.push(filePath)
            } catch (error) {
                errors.push(filePath)
            }
        }

        if (deleted.length > 0) {
            return NextResponse.json({ success: true, deleted, errors })
        } else {
            return NextResponse.json({ success: false, error: "Cache not found" }, { status: 404 })
        }
    } catch (error) {
        console.error("[API] Error clearing cache:", error)
        return NextResponse.json({ success: false }, { status: 500 })
    }
}
