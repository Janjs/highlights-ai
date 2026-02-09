import { readFile, writeFile, stat } from "fs/promises"
import { exec } from "child_process"
import { promisify } from "util"
import path from "path"

const execAsync = promisify(exec)

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

function ndjsonLine(obj: Record<string, unknown>): string {
  return JSON.stringify(obj) + "\n"
}

function safeEnqueue(controller: ReadableStreamDefaultController, data: Uint8Array) {
  try {
    controller.enqueue(data)
  } catch {
    // controller already closed
  }
}

function safeClose(controller: ReadableStreamDefaultController) {
  try {
    controller.close()
  } catch {
    // controller already closed
  }
}

export async function POST() {
  console.log("[API] POST /api/detect-balls - Stream request received")

  const projectRoot = process.cwd()
  const cacheDir = path.join(projectRoot, ".cache")
  const videoPath = path.join(cacheDir, "input.mp4")
  const ballDetectionsPath = path.join(cacheDir, "ball_detections.json")

  try {
    await stat(videoPath)
  } catch {
    return new Response(
      ndjsonLine({ type: "error", message: "No cached video found. Process a video first." }),
      { status: 400, headers: { "Content-Type": "application/x-ndjson" } },
    )
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => safeEnqueue(controller, encoder.encode(ndjsonLine(obj)))

      try {
        const cached = await readFile(ballDetectionsPath, "utf-8")
        const ballDetections = JSON.parse(cached)
        console.log(`[API] Returning cached ball detections (${ballDetections.length} frames)`)
        send({ type: "meta", totalFrames: ballDetections.length, cached: true })
        for (const detection of ballDetections) {
          send({ type: "detection", data: detection, processed: ballDetections.length, total: ballDetections.length })
        }
        send({ type: "done", processed: ballDetections.length, cached: true })
        safeClose(controller)
        return
      } catch {
        // No cache, proceed with detection
      }

      const flaskPort = process.env.FLASK_PORT || "5001"
      const flaskUrl = `http://localhost:${flaskPort}/balls/stream`

      try {
        const { Agent, fetch: undiciFetch } = await import("undici")
        const agent = new Agent({
          headersTimeout: 60 * 60 * 1000,
          bodyTimeout: 60 * 60 * 1000,
          connectTimeout: 10 * 1000,
        })

        const flaskResponse = await undiciFetch(flaskUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ video_path: videoPath, frame_skip: 5 }),
          dispatcher: agent,
        })

        if (!flaskResponse.ok) {
          throw new Error(`Flask API returned ${flaskResponse.status}`)
        }

        const allDetections: unknown[] = []
        const flaskBody = flaskResponse.body
        if (!flaskBody) throw new Error("No response body from Flask")

        const decoder = new TextDecoder()
        let buffer = ""

        for await (const chunk of flaskBody as AsyncIterable<Uint8Array>) {
          buffer += decoder.decode(chunk, { stream: true })
          const lines = buffer.split("\n")
          buffer = lines.pop() || ""

          for (const line of lines) {
            if (!line.trim()) continue
            try {
              const parsed = JSON.parse(line)
              if (parsed.type === "detection" && parsed.data) {
                allDetections.push(parsed.data)
              }
            } catch {
              // skip malformed lines
            }
            safeEnqueue(controller, encoder.encode(line + "\n"))
          }
        }

        if (buffer.trim()) {
          try {
            const parsed = JSON.parse(buffer)
            if (parsed.type === "detection" && parsed.data) {
              allDetections.push(parsed.data)
            }
          } catch {
            // skip
          }
          safeEnqueue(controller, encoder.encode(buffer + "\n"))
        }

        if (allDetections.length > 0) {
          try {
            await writeFile(ballDetectionsPath, JSON.stringify(allDetections))
            console.log(`[API] Saved ${allDetections.length} ball detections to cache`)
          } catch (e) {
            console.warn("[API] Failed to cache ball detections:", e)
          }
        }

        safeClose(controller)
        return
      } catch (flaskError) {
        console.warn("[API] Flask streaming failed, falling back to Python script:", flaskError)
      }

      send({ type: "meta", totalFrames: 0, fallback: true })

      const pythonBin = path.join(projectRoot, ".venv", "bin", "python")
      const ballDetectorPath = path.join(projectRoot, "backend", "ball-detector.py")

      try {
        await execAsync(`${pythonBin} ${ballDetectorPath}`, {
          cwd: projectRoot,
          timeout: 10 * 60 * 1000,
          maxBuffer: 50 * 1024 * 1024,
          env: {
            ...process.env,
            VIDEO_PATH: videoPath,
            BALL_DETECTIONS_PATH: ballDetectionsPath,
            FRAME_SKIP: "5",
          },
        })
        const ballData = await readFile(ballDetectionsPath, "utf-8")
        const ballDetections = JSON.parse(ballData)

        for (const detection of ballDetections) {
          send({ type: "detection", data: detection, processed: ballDetections.length, total: ballDetections.length })
        }
        send({ type: "done", processed: ballDetections.length })
      } catch (e: unknown) {
        console.error("[API] Ball detection fallback failed:", e)
        const stderr = (e as { stderr?: string })?.stderr || (e as Error)?.message || ""
        let errorMsg = "Ball detection failed. Check the server logs for details."
        if (stderr.includes("Unauthorized") || stderr.includes("API key") || stderr.includes("RoboflowAPINotAuthorizedError")) {
          errorMsg = "Invalid Roboflow API key. Check your ROBOFLOW_API_KEY in .env."
        } else if (stderr.includes("ROBOFLOW_API_KEY")) {
          errorMsg = "ROBOFLOW_API_KEY is not set. Add it to your .env file."
        }
        send({ type: "error", message: errorMsg })
      }

      safeClose(controller)
    },
  })

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } })
}
