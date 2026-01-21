import { NextRequest, NextResponse } from "next/server"
import { writeFile, readFile, unlink, stat } from "fs/promises"
import { exec } from "child_process"
import { promisify } from "util"
import path from "path"
import { performance } from "perf_hooks"
import Busboy from "busboy"

const execAsync = promisify(exec)

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function parseFormData(request: NextRequest): Promise<{ file: Buffer; filename: string }> {
    return new Promise(async (resolve, reject) => {
        const contentType = request.headers.get("content-type")
        if (!contentType || !contentType.includes("multipart/form-data")) {
            reject(new Error("Invalid content type"))
            return
        }

        const busboy = Busboy({ headers: { "content-type": contentType } })
        let fileBuffer: Buffer | null = null
        let filename: string | null = null

        busboy.on("file", (name, file, info) => {
            const { filename: fileFilename } = info
            if (name === "video") {
                filename = fileFilename
                const chunks: Buffer[] = []

                file.on("data", (chunk: Buffer) => {
                    chunks.push(chunk)
                })

                file.on("end", () => {
                    fileBuffer = Buffer.concat(chunks)
                })
            } else {
                file.resume()
            }
        })

        busboy.on("finish", () => {
            if (!fileBuffer || !filename) {
                reject(new Error("No video file provided"))
            } else {
                resolve({ file: fileBuffer, filename })
            }
        })

        busboy.on("error", (error) => {
            reject(error)
        })

        try {
            if (!request.body) {
                reject(new Error("Request body is null"))
                return
            }

            const reader = request.body.getReader()
            while (true) {
                const { done, value } = await reader.read()
                if (done) {
                    busboy.end()
                    break
                }
                if (value) {
                    busboy.write(Buffer.from(value))
                }
            }
        } catch (error) {
            reject(error)
        }
    })
}

export async function POST(request: NextRequest) {
    const requestStart = performance.now()
    console.log("[API] POST /api/process-video - Request received")

    try {
        const formDataStart = performance.now()
        console.log("[API] Parsing form data...")
        console.log("[API] Content-Type:", request.headers.get("content-type"))

        const { file: fileBuffer, filename } = await parseFormData(request)
        console.log(`[API] Form data parsed in ${(performance.now() - formDataStart).toFixed(2)}ms`)
        console.log(`[API] File received: ${filename}, size: ${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB`)

        const buffer = fileBuffer

        const projectRoot = process.cwd()
        const cacheDir = path.join(projectRoot, ".cache")
        const originalVideoPath = path.join(cacheDir, "input_original.mp4")
        const videoPath = path.join(cacheDir, "input.mp4")
        const scenesJsonPath = path.join(cacheDir, "scenes.json")

        const { mkdir } = await import("fs/promises")
        await mkdir(cacheDir, { recursive: true })

        const writeStart = performance.now()
        console.log(`[API] Writing original video to: ${originalVideoPath}`)
        await writeFile(originalVideoPath, buffer)
        console.log(`[API] Original video file written in ${(performance.now() - writeStart).toFixed(2)}ms`)

        const compressStart = performance.now()
        const originalStats = await stat(originalVideoPath)
        const originalSizeMB = (originalStats.size / 1024 / 1024).toFixed(2)
        console.log(`[API] Compressing video (original: ${originalSizeMB} MB)...`)
        const compressCommand = `ffmpeg -i ${originalVideoPath} -c:v libx264 -preset medium -crf 23 -c:a aac -b:a 128k -movflags +faststart ${videoPath} -y`
        try {
            const { stdout, stderr } = await execAsync(compressCommand, {
                cwd: projectRoot,
            })
            const compressTime = (performance.now() - compressStart) / 1000
            const compressedStats = await stat(videoPath)
            const compressedSizeMB = (compressedStats.size / 1024 / 1024).toFixed(2)
            const compressionRatio = ((1 - compressedStats.size / originalStats.size) * 100).toFixed(1)
            console.log(`[API] Video compressed in ${compressTime.toFixed(2)}s`)
            console.log(`[API] Size: ${originalSizeMB} MB → ${compressedSizeMB} MB (${compressionRatio}% reduction)`)
            if (stderr) console.log("[API] Compression output:", stderr.substring(0, 500))
        } catch (error) {
            console.warn("[API] Compression failed, using original video:", error)
            await writeFile(videoPath, buffer)
        }

        // Call Flask API for scene and ball detection
        const flaskStart = performance.now()
        console.log("[API] Calling Flask video processor API...")

        const flaskPort = process.env.FLASK_PORT || "5001"
        const flaskUrl = `http://localhost:${flaskPort}/process`

        let scenes = []
        let ballDetections = []

        try {
            // Long timeout for video processing (up to 1 hour)
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 60 * 60 * 1000)

            const flaskResponse = await fetch(flaskUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    video_path: videoPath,
                    frame_skip: 5
                }),
                signal: controller.signal
            })

            clearTimeout(timeoutId)

            if (!flaskResponse.ok) {
                throw new Error(`Flask API returned ${flaskResponse.status}`)
            }

            const flaskData = await flaskResponse.json()
            scenes = flaskData.scenes || []
            ballDetections = flaskData.ballDetections || []

            const flaskTime = (performance.now() - flaskStart) / 1000
            console.log(`[API] Flask processing completed in ${flaskTime.toFixed(2)}s`)
            console.log(`[API] Received ${scenes.length} scenes, ${ballDetections.length} ball detection frames`)

            if (flaskData.timing) {
                console.log(`[API] Flask timing: scene=${flaskData.timing.sceneDetection}s, ball=${flaskData.timing.ballDetection}s`)
            }
        } catch (error) {
            console.warn("[API] Flask API call failed, falling back to direct Python execution:", error)

            // Fallback to direct Python execution
            const pythonBin = path.join(projectRoot, ".venv", "bin", "python")

            // Scene detection
            const pythonScriptPath = path.join(projectRoot, "highlights-clipper.py")
            const scenesJsonPath = path.join(cacheDir, "scenes.json")

            try {
                await execAsync(`${pythonBin} ${pythonScriptPath}`, {
                    cwd: projectRoot,
                    env: { ...process.env, VIDEO_PATH: videoPath, SCENES_JSON_PATH: scenesJsonPath },
                })
                const scenesData = await readFile(scenesJsonPath, "utf-8")
                scenes = JSON.parse(scenesData)
            } catch (e) {
                console.error("[API] Scene detection fallback failed:", e)
            }

            // Ball detection
            const ballDetectorPath = path.join(projectRoot, "ball-detector.py")
            const ballDetectionsPath = path.join(cacheDir, "ball_detections.json")

            try {
                await execAsync(`${pythonBin} ${ballDetectorPath}`, {
                    cwd: projectRoot,
                    env: { ...process.env, VIDEO_PATH: videoPath, BALL_DETECTIONS_PATH: ballDetectionsPath, FRAME_SKIP: "5" },
                })
                const ballData = await readFile(ballDetectionsPath, "utf-8")
                ballDetections = JSON.parse(ballData)
            } catch (e) {
                console.error("[API] Ball detection fallback failed:", e)
            }
        }

        console.log("[API] Keeping input.mp4 for debugging")

        const totalTime = (performance.now() - requestStart) / 1000
        console.log(`[API] Total API time: ${totalTime.toFixed(2)}s`)

        console.log("[API] Returning response with scenes and ball detections")
        return NextResponse.json({ scenes, ballDetections })
    } catch (error) {
        console.error("[API] ERROR:", error)

        const errorMessage = error instanceof Error ? error.message : "Unknown error"
        return NextResponse.json(
            { error: `Failed to process video: ${errorMessage}` },
            { status: 500 }
        )
    }
}
