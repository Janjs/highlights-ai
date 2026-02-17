"use client"

import type React from "react"

import Link from "next/link"
import { useState, useCallback, useRef } from "react"
import { Icons } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Progress } from "@/components/ui/progress"
import { ThemeSwitcher } from "@/components/theme-switcher"
import { fontTitle } from "@/lib/fonts"

interface VideoUploadProps {
  onVideoProcessed: (data: {
    url: string
    segments: Array<{ start: number; end: number; url: string }>
  }, options?: { aiHighlighting: boolean }) => void
}

type ProcessingStage = "uploading" | "processing" | "done"

const STAGE_LABELS: Record<ProcessingStage, string> = {
  uploading: "Uploading video...",
  processing: "Detecting scenes...",
  done: "Done!",
}

const MAX_VIDEO_DURATION_SEC = 120

export function VideoUpload({ onVideoProcessed }: VideoUploadProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [aiHighlighting, setAiHighlighting] = useState(true)
  const aiHighlightingRef = useRef(true)
  const [isProcessing, setIsProcessing] = useState(false)
  const [stage, setStage] = useState<ProcessingStage>("uploading")
  const [uploadProgress, setUploadProgress] = useState(0)
  const [estimatedProgress, setEstimatedProgress] = useState(0)
  const [videoTooLong, setVideoTooLong] = useState(false)
  const estimateTimerRef = useRef<ReturnType<typeof setInterval>>(null)
  const estimateStartRef = useRef(0)
  const estimatedDurationRef = useRef(0)

  const getVideoDuration = (file: File): Promise<number> => {
    return new Promise((resolve, reject) => {
      const video = document.createElement("video")
      video.preload = "metadata"
      const url = URL.createObjectURL(file)

      video.onloadedmetadata = () => {
        URL.revokeObjectURL(url)
        if (video.duration && video.duration > 0) {
          resolve(video.duration)
        } else {
          resolve(60)
        }
      }

      video.onerror = () => {
        URL.revokeObjectURL(url)
        resolve(60)
      }

      video.src = url
    })
  }

  const startEstimatedProgress = (estimatedSeconds: number) => {
    estimateStartRef.current = Date.now()
    estimatedDurationRef.current = estimatedSeconds * 1000
    setEstimatedProgress(0)

    if (estimateTimerRef.current) clearInterval(estimateTimerRef.current)

    estimateTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - estimateStartRef.current
      const progress = Math.min(95, (elapsed / estimatedDurationRef.current) * 100)
      setEstimatedProgress(progress)
    }, 200)
  }

  const stopEstimatedProgress = () => {
    if (estimateTimerRef.current) {
      clearInterval(estimateTimerRef.current)
      estimateTimerRef.current = null
    }
    setEstimatedProgress(100)
  }

  const formatTimeRemaining = (): string => {
    if (stage === "uploading") return ""
    const elapsed = Date.now() - estimateStartRef.current
    const remaining = Math.max(0, estimatedDurationRef.current - elapsed)
    const seconds = Math.ceil(remaining / 1000)
    if (seconds <= 0) return "Almost done..."
    if (seconds < 60) return `~${seconds}s remaining`
    const minutes = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `~${minutes}m ${secs}s remaining`
  }

  const processVideo = async (file: File) => {
    console.log("[CLIENT] Starting video processing...")
    console.log(`[CLIENT] File: ${file.name}, Size: ${file.size}, Type: ${file.type}`)

    const videoDuration = await getVideoDuration(file)
    console.log(`[CLIENT] Video duration: ${videoDuration.toFixed(1)}s`)
    if (videoDuration > MAX_VIDEO_DURATION_SEC) {
      setVideoTooLong(true)
      return
    }
    setVideoTooLong(false)

    setIsProcessing(true)
    setStage("uploading")
    setUploadProgress(0)
    setEstimatedProgress(0)

    try {

      const formData = new FormData()
      formData.append("video", file, file.name)

      const response = await new Promise<Response>((resolve, reject) => {
        const xhr = new XMLHttpRequest()

        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100)
            setUploadProgress(pct)
          }
        })

        xhr.addEventListener("load", () => {
          const response = new Response(xhr.responseText, {
            status: xhr.status,
            statusText: xhr.statusText,
            headers: { "Content-Type": "application/json" },
          })
          resolve(response)
        })

        xhr.addEventListener("error", () => reject(new Error("Upload failed")))
        xhr.addEventListener("abort", () => reject(new Error("Upload aborted")))

        xhr.open("POST", "/api/process-video")

        xhr.upload.addEventListener("load", () => {
          setStage("processing")
          const estimatedProcessing = Math.max(5, videoDuration * 0.3)
          startEstimatedProgress(estimatedProcessing)
        })

        xhr.send(formData)
      })

      stopEstimatedProgress()

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to process video")
      }

      const data = await response.json()
      const { scenes } = data
      console.log(`[CLIENT] Received ${scenes.length} scenes`)

      setStage("done")

      const videoUrl = "/api/video"
      const segments = scenes.map((scene: { start: number; end: number }) => ({
        start: scene.start,
        end: scene.end,
        url: videoUrl,
      }))

      await new Promise((resolve) => setTimeout(resolve, 400))

      onVideoProcessed({ url: videoUrl, segments }, { aiHighlighting: aiHighlightingRef.current })
    } catch (error) {
      console.error("[CLIENT] Error processing video:", error)
      const errorMessage = error instanceof Error ? error.message : "Unknown error"
      alert(`Error processing video: ${errorMessage}`)
      setIsProcessing(false)
      setStage("uploading")
      setUploadProgress(0)
      stopEstimatedProgress()
    }
  }

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)

    const files = Array.from(e.dataTransfer.files)
    const videoFile = files.find((f) => f.type.startsWith("video/"))

    if (videoFile) {
      processVideo(videoFile)
    } else {
      alert("Please upload a video file")
    }
  }, [])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && file.type.startsWith("video/")) {
      processVideo(file)
    } else {
      alert("Please select a video file")
    }
  }, [])

  const currentProgress = stage === "uploading" ? uploadProgress : estimatedProgress

  const stages: { key: ProcessingStage; label: string }[] = [
    { key: "uploading", label: "Upload" },
    { key: "processing", label: "Detect scenes" },
    { key: "done", label: "Ready" },
  ]

  const stageOrder: ProcessingStage[] = ["uploading", "processing", "done"]
  const currentStageIndex = stageOrder.indexOf(stage)

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="fixed right-6 top-6 z-50">
        <ThemeSwitcher />
      </div>

      <Card className="w-full max-w-2xl p-8">
        <div className="mb-8 text-center">
          <Link href="/" className={`mb-2 inline-flex items-center gap-2 text-3xl font-bold text-foreground hover:opacity-80 transition-opacity ${fontTitle.className}`}>
            <Icons.appIcon className="h-8 w-8 text-primary" />
            Highlight AI
          </Link>
          <p className="text-muted-foreground">Upload your video to automatically detect and split scenes</p>
        </div>

        <div className="mb-6 rounded-lg border border-border bg-muted/30 px-4 py-3 text-center text-sm text-muted-foreground">
          Videos up to 2 minutes. Longer videos coming soon.
        </div>

        {videoTooLong && (
          <div className="mb-6 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-center text-sm text-destructive">
            This video is over 2 minutes. Longer videos coming soon.
          </div>
        )}

        {!isProcessing ? (
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`relative rounded-lg border-2 border-dashed p-12 text-center transition-colors ${isDragging ? "border-primary bg-primary/5" : "border-border bg-muted/30"
              }`}
          >
            <input
              type="file"
              accept="video/*"
              onChange={handleFileSelect}
              className="absolute inset-0 cursor-pointer opacity-0"
              id="video-upload"
            />
            <Icons.upload className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
            <p className="mb-2 text-lg font-medium text-foreground">Drop your video here</p>
            <p className="mb-4 text-sm text-muted-foreground">or click to browse</p>
            <Button asChild>
              <label htmlFor="video-upload" className="cursor-pointer">
                Select Video
              </label>
            </Button>
          </div>
        ) : (
          <div className="space-y-6 rounded-lg bg-muted/30 p-8">
            <div className="relative">
              <div
                className="absolute left-4 right-4 top-4 h-px bg-border"
                aria-hidden
              />
              <div
                className="absolute left-4 top-4 h-px bg-primary transition-[width] duration-300"
                style={{
                  width:
                    stages.length > 1
                      ? `calc((100% - 2rem) * ${currentStageIndex / (stages.length - 1)})`
                      : "0%",
                }}
                aria-hidden
              />
              <div className="relative z-10 flex justify-between">
                {stages.map((s, i) => {
                  const isCompleted = i < currentStageIndex
                  const isCurrent = i === currentStageIndex
                  return (
                    <div key={s.key} className="flex flex-col items-center gap-1.5">
                      <div
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                          isCompleted
                            ? "bg-primary text-primary-foreground"
                            : isCurrent
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {isCompleted ? <Icons.check className="h-4 w-4" /> : i + 1}
                      </div>
                      <span
                        className={`text-xs ${
                          isCurrent ? "font-medium text-foreground" : "text-muted-foreground"
                        }`}
                      >
                        {s.label}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Progress value={currentProgress} className="h-2" />
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-foreground">{STAGE_LABELS[stage]}</p>
                <p className="text-xs text-muted-foreground">
                  {stage === "uploading" && uploadProgress > 0 && `${uploadProgress}%`}
                  {stage === "processing" && formatTimeRemaining()}
                </p>
              </div>
            </div>
          </div>
        )}

        {!isProcessing && (
          <label className="mt-4 flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={aiHighlighting}
              onCheckedChange={(checked) => {
                const value = checked === true
                setAiHighlighting(value)
                aiHighlightingRef.current = value
              }}
            />
            <span className="text-sm text-foreground">AI Highlight Detection</span>
            <span className="text-xs text-muted-foreground">(automatically select clips with made baskets)</span>
          </label>
        )}

        <div className="mt-6 rounded-lg bg-muted/30 p-4">
          <p className="text-sm text-muted-foreground">
            <strong className="text-foreground">Supported formats:</strong> MP4, MOV, AVI, WebM
          </p>
        </div>
      </Card>
    </div>
  )
}
