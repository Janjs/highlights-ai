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
        const originalVideoPath = path.join(projectRoot, "input_original.mp4")
        const videoPath = path.join(projectRoot, "input.mp4")
        const scenesJsonPath = path.join(projectRoot, "scenes.json")

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

        const pythonStart = performance.now()
        console.log("[API] Running Python script...")
        const pythonScriptPath = path.join(projectRoot, "highlights-clipper.py")
        console.log(`[API] Python command: python3 ${pythonScriptPath}`)

        const { stdout, stderr } = await execAsync(`python3 ${pythonScriptPath}`, {
            cwd: projectRoot,
            env: { ...process.env, VIDEO_PATH: originalVideoPath },
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
