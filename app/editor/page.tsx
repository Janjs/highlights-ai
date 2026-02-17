"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { VideoUpload } from "@/components/video-upload"
import { VideoEditor } from "@/components/video-editor"

interface BallDetection {
  time: number
  frame: number
  boxes: Array<{ x: number; y: number; w: number; h: number; confidence: number }>
}

const DEMO_VIDEO_URL = "/demo.mp4"

export default function EditorPage() {
  const useCache = false
  const hasLoadedInitialDemo = useRef(false)

  const [videoData, setVideoData] = useState<{
    url: string
    segments: Array<{ start: number; end: number; url: string }>
  } | null>(null)
  const [ballDetections, setBallDetections] = useState<BallDetection[] | undefined>(undefined)
  const [ballDetectionError, setBallDetectionError] = useState<string | null>(null)
  const [aiHighlighting, setAiHighlighting] = useState(true)
  const [isLoadingCache, setIsLoadingCache] = useState(useCache)
  const [isLoadingDemo, setIsLoadingDemo] = useState(!useCache)

  const loadDemoVideo = useCallback(async () => {
    try {
      const [scenesRes, detectionsRes] = await Promise.all([
        fetch("/demo-scenes.json"),
        fetch("/demo-detections.json"),
      ])
      const scenes: Array<{ start: number; end: number }> = await scenesRes.json()
      const segments = scenes.map((scene) => ({
        start: scene.start,
        end: scene.end,
        url: DEMO_VIDEO_URL,
      }))
      setVideoData({ url: DEMO_VIDEO_URL, segments })
      if (detectionsRes.ok) {
        const detections: BallDetection[] = await detectionsRes.json()
        if (detections?.length) setBallDetections(detections)
      }
    } catch (error) {
      console.error("[CLIENT] Error loading demo video:", error)
    } finally {
      setIsLoadingDemo(false)
    }
  }, [])

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

          setVideoData({ url: videoUrl, segments })
          if (data.ballDetections?.length) {
            setBallDetections(data.ballDetections)
          }
        } else {
          await loadDemoVideo()
        }
      } catch (error) {
        console.error("[CLIENT] Error loading cached video:", error)
        await loadDemoVideo()
      } finally {
        setIsLoadingCache(false)
      }
    }

    loadCachedVideo()
  }, [useCache, loadDemoVideo])

  useEffect(() => {
    if (!useCache && !hasLoadedInitialDemo.current) {
      hasLoadedInitialDemo.current = true
      loadDemoVideo()
    }
  }, [useCache, loadDemoVideo])

  const handleBallDetectionsLoaded = useCallback(
    (detections: BallDetection[], error?: string | null) => {
      setBallDetections(detections)
      if (error) setBallDetectionError(error)
    },
    [],
  )

  if (isLoadingCache || (isLoadingDemo && !videoData)) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground">
            {isLoadingCache ? "Loading cached video..." : "Loading demo video..."}
          </p>
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
    setBallDetections(undefined)
    setBallDetectionError(null)
  }

  return (
    <main className="min-h-screen bg-background">
      {!videoData ? (
        <VideoUpload onVideoProcessed={(data, options) => {
          setVideoData(data)
          setAiHighlighting(options?.aiHighlighting ?? true)
        }} />
      ) : (
        <VideoEditor
          videoData={videoData}
          ballDetections={ballDetections}
          ballDetectionError={ballDetectionError}
          aiHighlighting={aiHighlighting}
          onBallDetectionsLoaded={handleBallDetectionsLoaded}
          onReset={handleReset}
        />
      )}
    </main>
  )
}
