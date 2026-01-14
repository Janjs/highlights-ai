"use client"

import type React from "react"

import { useState, useCallback } from "react"
import { Upload, Film } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { ThemeSwitcher } from "@/components/theme-switcher"

interface VideoUploadProps {
  onVideoProcessed: (data: {
    url: string
    segments: Array<{ start: number; end: number; url: string }>
  }) => void
}

export function VideoUpload({ onVideoProcessed }: VideoUploadProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [processingStage, setProcessingStage] = useState("")

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const processVideo = async (file: File) => {
    const startTime = performance.now()
    console.log("[CLIENT] Starting video processing...")
    console.log(`[CLIENT] File: ${file.name}, Size: ${file.size}, Type: ${file.type}`)

    setIsProcessing(true)
    setProcessingStage("Uploading video...")

    try {
      const uploadStart = performance.now()
      setProcessingStage("Detecting scenes with AI...")

      console.log("[CLIENT] Creating FormData...")
      const formData = new FormData()
      formData.append("video", file, file.name)

      console.log("[CLIENT] Sending POST request to /api/process-video...")
      const response = await fetch("/api/process-video", {
        method: "POST",
        body: formData,
      })

      const uploadEnd = performance.now()
      console.log(`[CLIENT] Upload complete in ${(uploadEnd - uploadStart).toFixed(2)}ms`)
      console.log(`[CLIENT] Response status: ${response.status}`)

      if (!response.ok) {
        const errorData = await response.json()
        console.error("[CLIENT] Error response:", errorData)
        throw new Error(errorData.error || "Failed to process video")
      }

      const parseStart = performance.now()
      console.log("[CLIENT] Parsing response data...")
      const data = await response.json()
      const { scenes } = data
      const parseEnd = performance.now()
      console.log(`[CLIENT] Parsing complete in ${(parseEnd - parseStart).toFixed(2)}ms`)
      console.log(`[CLIENT] Received ${scenes.length} scenes:`, scenes)

      setProcessingStage("Creating segments...")

      const videoUrl = "/api/video"
      console.log("[CLIENT] Using server video URL:", videoUrl)

      const segments = scenes.map((scene: { start: number; end: number }) => ({
        start: scene.start,
        end: scene.end,
        url: videoUrl,
      }))

      console.log("[CLIENT] Segments created:", segments)

      const totalTime = performance.now() - startTime
      console.log(`[CLIENT] Total processing time: ${totalTime.toFixed(2)}ms (${(totalTime / 1000).toFixed(2)}s)`)

      await new Promise((resolve) => setTimeout(resolve, 300))

      console.log("[CLIENT] Calling onVideoProcessed...")
      onVideoProcessed({
        url: videoUrl,
        segments,
      })
      console.log("[CLIENT] Video processing complete!")
    } catch (error) {
      console.error("[CLIENT] Error processing video:", error)
      const errorMessage = error instanceof Error ? error.message : "Unknown error"
      alert(`Error processing video: ${errorMessage}`)
      setIsProcessing(false)
      setProcessingStage("")
    }
  }

  const getVideoDuration = (url: string): Promise<number> => {
    return new Promise((resolve, reject) => {
      const video = document.createElement("video")
      video.preload = "metadata"

      video.onloadedmetadata = () => {
        if (video.duration && video.duration > 0) {
          resolve(video.duration)
        } else {
          reject(new Error("Invalid video duration"))
        }
      }

      video.onerror = () => {
        reject(new Error("Failed to load video. Please try a different file."))
      }

      video.src = url
    })
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)

    const files = Array.from(e.dataTransfer.files)
    const videoFile = files.find((file) => file.type.startsWith("video/"))

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

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="fixed right-6 top-6 z-50">
        <ThemeSwitcher />
      </div>

      <Card className="w-full max-w-2xl p-8">
        <div className="mb-8 text-center">
          <div className="mb-4 flex justify-center">
            <div className="rounded-full bg-primary/10 p-4">
              <Film className="h-12 w-12 text-primary" />
            </div>
          </div>
          <h1 className="mb-2 text-3xl font-bold text-foreground">Video Editor</h1>
          <p className="text-muted-foreground">Upload your video to automatically detect and split scenes</p>
        </div>

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
            <Upload className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
            <p className="mb-2 text-lg font-medium text-foreground">Drop your video here</p>
            <p className="mb-4 text-sm text-muted-foreground">or click to browse</p>
            <Button asChild>
              <label htmlFor="video-upload" className="cursor-pointer">
                Select Video
              </label>
            </Button>
          </div>
        ) : (
          <div className="space-y-4 rounded-lg bg-muted/30 p-8 text-center">
            <Spinner className="mx-auto h-12 w-12 text-primary" />
            <div>
              <p className="mb-2 text-lg font-medium text-foreground">{processingStage}</p>
              <p className="text-sm text-muted-foreground">Analyzing video and creating timeline</p>
            </div>
          </div>
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
