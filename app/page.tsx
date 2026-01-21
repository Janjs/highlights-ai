"use client"

import { useState, useEffect } from "react"
import { VideoUpload } from "@/components/video-upload"
import { VideoEditor } from "@/components/video-editor"

interface BallDetection {
  time: number
  frame: number
  boxes: Array<{ x: number; y: number; w: number; h: number; confidence: number }>
}

export default function Home() {
  const useCache = process.env.NEXT_PUBLIC_CACHE === "1" || process.env.NEXT_PUBLIC_CACHE === "true"

  const [videoData, setVideoData] = useState<{
    url: string
    segments: Array<{ start: number; end: number; url: string }>
    ballDetections?: BallDetection[]
  } | null>(null)
  const [isLoadingCache, setIsLoadingCache] = useState(useCache)

  useEffect(() => {
    if (!useCache) {
      setIsLoadingCache(false)
      return
    }

    const loadCachedVideo = async () => {
      try {
        const response = await fetch("/api/cache")
        const data = await response.json()

        if (data.exists && data.scenes) {
          const videoUrl = "/api/video"
          const segments = data.scenes.map((scene: { start: number; end: number }) => ({
            start: scene.start,
            end: scene.end,
            url: videoUrl,
          }))

          setVideoData({
            url: videoUrl,
            segments,
            ballDetections: data.ballDetections || [],
          })
        }
      } catch (error) {
        console.error("[CLIENT] Error loading cached video:", error)
      } finally {
        setIsLoadingCache(false)
      }
    }

    loadCachedVideo()
  }, [useCache])

  if (isLoadingCache) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground">Loading cached video...</p>
        </div>
      </main>
    )
  }

  const handleReset = async () => {
    try {
      await fetch("/api/cache", { method: "DELETE" })
    } catch (error) {
      console.error("[CLIENT] Error clearing cache:", error)
    }
    setVideoData(null)
  }

  return (
    <main className="min-h-screen bg-background">
      {!videoData ? (
        <VideoUpload onVideoProcessed={setVideoData} />
      ) : (
        <VideoEditor videoData={videoData} onReset={handleReset} />
      )}
    </main>
  )
}
