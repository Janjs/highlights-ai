"use client"

import type React from "react"

import { useState, useRef, useEffect, useCallback } from "react"
import { Play, Pause, SkipForward, SkipBack, RotateCcw, Download, Volume2, VolumeX, ChevronLeft, ChevronRight, Eye, EyeOff, AlertTriangle, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Kbd } from "@/components/ui/kbd"
import { Progress } from "@/components/ui/progress"
import { Slider } from "@/components/ui/slider"
import { Spinner } from "@/components/ui/spinner"
import { ThemeSwitcher } from "@/components/theme-switcher"
import { AppIcon } from "@/components/app-icon"

interface BallDetection {
  time: number
  frame: number
  boxes: Array<{ x: number; y: number; w: number; h: number; confidence: number; class?: string }>
}

interface VideoEditorProps {
  videoData: {
    url: string
    segments: Array<{ start: number; end: number; url: string }>
  }
  ballDetections?: BallDetection[]
  ballDetectionError?: string | null
  onBallDetectionsLoaded: (detections: BallDetection[], error?: string | null) => void
  onReset: () => void
}

export function VideoEditor({ videoData, ballDetections, ballDetectionError, onBallDetectionsLoaded, onReset }: VideoEditorProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoContainerRef = useRef<HTMLDivElement>(null)
  const timelineScrollRef = useRef<HTMLDivElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [currentSegment, setCurrentSegment] = useState(0)
  const [volume, setVolume] = useState(1)
  const [isMuted, setIsMuted] = useState(false)
  const [zoom, setZoom] = useState(3)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const [timelineScroll, setTimelineScroll] = useState({ scrollLeft: 0, scrollWidth: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [isScrubbing, setIsScrubbing] = useState(false)
  const [selectedSegments, setSelectedSegments] = useState<Set<number>>(
    () => new Set(videoData.segments.map((_, i) => i)),
  )
  const [isExporting, setIsExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const [showBallTracking, setShowBallTracking] = useState(true)
  const [showBallError, setShowBallError] = useState(!!ballDetectionError)
  const dragStartRef = useRef({ x: 0, scrollLeft: 0 })

  const [isBallDetectionLoading, setIsBallDetectionLoading] = useState(false)
  const [ballDetectionProgress, setBallDetectionProgress] = useState(0)
  const ballDetectionStartRef = useRef(0)
  const ballDetectionAttemptedRef = useRef(false)
  const ballDetectionTimerRef = useRef<ReturnType<typeof setInterval>>(null)
  const accumulatedDetectionsRef = useRef<BallDetection[]>([])
  const lastFlushRef = useRef(0)
  const isStreamingRef = useRef(false)

  const hasBallDetections = ballDetections && ballDetections.length > 0

  const startEstimatedProgress = useCallback(() => {
    if (ballDetectionTimerRef.current) clearInterval(ballDetectionTimerRef.current)
    const estimatedMs = Math.max(10000, (duration || 60) * 800)
    ballDetectionTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - ballDetectionStartRef.current
      const base = (elapsed / estimatedMs) * 100
      const progress = base <= 95
        ? base
        : 95 + (1 - Math.exp(-(base - 95) / 20)) * 4.9
      setBallDetectionProgress(Math.min(99.9, progress))
    }, 300)
  }, [duration])

  const startBallDetection = useCallback(async () => {
    if (hasBallDetections || ballDetectionAttemptedRef.current) return
    ballDetectionAttemptedRef.current = true

    setIsBallDetectionLoading(true)
    setBallDetectionProgress(0)
    ballDetectionStartRef.current = Date.now()
    accumulatedDetectionsRef.current = []
    lastFlushRef.current = Date.now()
    isStreamingRef.current = false

    const abortController = new AbortController()
    const timeout = setTimeout(() => abortController.abort(), 10 * 60 * 1000)

    try {
      const response = await fetch("/api/detect-balls", {
        method: "POST",
        signal: abortController.signal,
      })

      if (!response.body) {
        throw new Error("No response body")
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      let lastDataAt = Date.now()

      while (true) {
        const readResult = await Promise.race([
          reader.read(),
          new Promise<{ done: true; value: undefined }>((resolve) =>
            setTimeout(() => {
              if (Date.now() - lastDataAt > 5 * 60 * 1000) {
                reader.cancel()
                resolve({ done: true, value: undefined })
              }
            }, 5 * 60 * 1000)
          ),
        ])
        const { done, value } = readResult
        if (done) break
        lastDataAt = Date.now()

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const parsed = JSON.parse(line)

            if (parsed.type === "meta") {
              if (parsed.fallback) {
                startEstimatedProgress()
              } else {
                isStreamingRef.current = true
                if (ballDetectionTimerRef.current) {
                  clearInterval(ballDetectionTimerRef.current)
                  ballDetectionTimerRef.current = null
                }
              }
            }

            if (parsed.type === "error") {
              onBallDetectionsLoaded(accumulatedDetectionsRef.current, parsed.message)
              setShowBallError(true)
              return
            }

            if (parsed.type === "detection" && parsed.data) {
              accumulatedDetectionsRef.current.push(parsed.data)
              if (isStreamingRef.current && parsed.total > 0) {
                setBallDetectionProgress((parsed.processed / parsed.total) * 100)
              }

              const now = Date.now()
              if (now - lastFlushRef.current > 500) {
                lastFlushRef.current = now
                onBallDetectionsLoaded([...accumulatedDetectionsRef.current])
              }
            }

            if (parsed.type === "done") {
              setBallDetectionProgress(100)
              onBallDetectionsLoaded([...accumulatedDetectionsRef.current])
            }
          } catch {
            // skip malformed lines
          }
        }
      }

      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer)
          if (parsed.type === "detection" && parsed.data) {
            accumulatedDetectionsRef.current.push(parsed.data)
          }
          if (parsed.type === "error") {
            onBallDetectionsLoaded(accumulatedDetectionsRef.current, parsed.message)
            setShowBallError(true)
            return
          }
        } catch {
          // skip
        }
      }

      onBallDetectionsLoaded([...accumulatedDetectionsRef.current])
    } catch (error) {
      console.error("[CLIENT] Ball detection failed:", error)
      const message = abortController.signal.aborted
        ? "Ball detection timed out. Try again with a shorter video."
        : "Ball detection failed. Check the server logs."
      onBallDetectionsLoaded(accumulatedDetectionsRef.current, message)
      setShowBallError(true)
    } finally {
      clearTimeout(timeout)
      if (ballDetectionTimerRef.current) {
        clearInterval(ballDetectionTimerRef.current)
        ballDetectionTimerRef.current = null
      }
      setIsBallDetectionLoading(false)
      setBallDetectionProgress(0)
    }
  }, [hasBallDetections, onBallDetectionsLoaded, startEstimatedProgress])

  useEffect(() => {
    if (!hasBallDetections && !isBallDetectionLoading && !ballDetectionAttemptedRef.current && duration > 0) {
      startBallDetection()
    }
    return () => {
      if (ballDetectionTimerRef.current) clearInterval(ballDetectionTimerRef.current)
    }
  }, [duration])

  useEffect(() => {
    if (ballDetectionError) setShowBallError(true)
  }, [ballDetectionError])

  useEffect(() => {
    setSelectedSegments(new Set(videoData.segments.map((_, i) => i)))
  }, [videoData.url])

  useEffect(() => {
    if (duration > 0) {
      setZoom(duration < 180 ? 1 : 3)
    }
  }, [duration])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime)

      const segmentIndex = videoData.segments.findIndex(
        (seg) => video.currentTime >= seg.start && video.currentTime < seg.end,
      )
      if (segmentIndex !== -1 && segmentIndex !== currentSegment) {
        setCurrentSegment(segmentIndex)
      }

      if (videoData.segments.length === 0) return

      if (isPlaying && currentSegment >= 0 && currentSegment < videoData.segments.length) {
        const seg = videoData.segments[currentSegment]
        if (video.currentTime >= seg.end - 0.02) {
          const next = [...selectedSegments].filter((i) => i > currentSegment).sort((a, b) => a - b)[0] ?? null
          if (next != null) {
            video.currentTime = videoData.segments[next].start + 0.01
            setCurrentSegment(next)
          } else {
            video.pause()
            setIsPlaying(false)
          }
        }
      }

      if (isPlaying && selectedSegments.size > 0 && !selectedSegments.has(currentSegment)) {
        const next = [...selectedSegments].filter((i) => i > currentSegment).sort((a, b) => a - b)[0]
          ?? [...selectedSegments].sort((a, b) => a - b)[0]
          ?? null
        if (next != null) {
          video.currentTime = videoData.segments[next].start + 0.01
          setCurrentSegment(next)
        } else {
          video.pause()
          setIsPlaying(false)
        }
      }
    }

    const handleLoadedMetadata = () => {
      setDuration(video.duration)
    }

    const handleEnded = () => {
      setIsPlaying(false)
    }

    video.addEventListener("timeupdate", handleTimeUpdate)
    video.addEventListener("loadedmetadata", handleLoadedMetadata)
    video.addEventListener("ended", handleEnded)

    return () => {
      video.removeEventListener("timeupdate", handleTimeUpdate)
      video.removeEventListener("loadedmetadata", handleLoadedMetadata)
      video.removeEventListener("ended", handleEnded)
    }
  }, [videoData.segments, currentSegment, isPlaying, selectedSegments])

  const togglePlay = () => {
    const video = videoRef.current
    if (!video) return

    if (isPlaying) {
      video.pause()
    } else {
      if (!selectedSegments.has(currentSegment)) {
        const next = getNextSelected(currentSegment) ?? [...selectedSegments].sort((a, b) => a - b)[0] ?? null
        if (next != null) {
          video.currentTime = videoData.segments[next].start + 0.01
          setCurrentSegment(next)
        }
      }
      video.play()
    }
    setIsPlaying(!isPlaying)
  }

  const handleSeek = (value: number[]) => {
    const video = videoRef.current
    if (!video) return

    video.currentTime = value[0]
    setCurrentTime(value[0])
  }

  const getNextSelected = (from: number) =>
    [...selectedSegments].filter((i) => i > from).sort((a, b) => a - b)[0] ?? null
  const getPrevSelected = (from: number) =>
    [...selectedSegments].filter((i) => i < from).sort((a, b) => b - a)[0] ?? null

  const playNextSegment = () => {
    const video = videoRef.current
    if (!video) return
    const next = getNextSelected(currentSegment)
    if (next === null) return
    video.currentTime = videoData.segments[next].start + 0.01
    setCurrentSegment(next)
    if (!isPlaying) {
      video.play()
      setIsPlaying(true)
    }
  }

  const playPreviousSegment = () => {
    const video = videoRef.current
    if (!video) return
    const prev = getPrevSelected(currentSegment)
    if (prev === null) return
    video.currentTime = videoData.segments[prev].start + 0.01
    setCurrentSegment(prev)
    if (!isPlaying) {
      video.play()
      setIsPlaying(true)
    }
  }

  const toggleMute = () => {
    const video = videoRef.current
    if (!video) return

    video.muted = !isMuted
    setIsMuted(!isMuted)
  }

  const handleVolumeChange = (value: number[]) => {
    const video = videoRef.current
    if (!video) return

    video.volume = value[0]
    setVolume(value[0])
    if (value[0] > 0 && isMuted) {
      video.muted = false
      setIsMuted(false)
    }
  }

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60)
    const seconds = Math.floor(time % 60)
    return `${minutes}:${seconds.toString().padStart(2, "0")}`
  }

  const jumpToSegment = (index: number) => {
    const video = videoRef.current
    if (!video) return

    const segment = videoData.segments[index]
    const seekTime = Math.min(segment.start + 0.15, segment.end - 0.01)
    video.currentTime = Math.max(segment.start, seekTime)
    setCurrentSegment(index)
  }

  const updateScrollButtons = () => {
    const container = timelineScrollRef.current
    if (!container) return

    setCanScrollLeft(container.scrollLeft > 0)
    setCanScrollRight(container.scrollLeft < container.scrollWidth - container.clientWidth - 1)
    setTimelineScroll({ scrollLeft: container.scrollLeft, scrollWidth: container.scrollWidth })
  }

  const scrollTimeline = (direction: "left" | "right") => {
    const container = timelineScrollRef.current
    if (!container) return

    const scrollAmount = container.clientWidth * 0.5
    container.scrollBy({
      left: direction === "left" ? -scrollAmount : scrollAmount,
      behavior: "smooth",
    })
  }

  const scrollToCurrentPosition = () => {
    const container = timelineScrollRef.current
    if (!container || !duration) return

    const playheadPosition = (currentTime / duration) * container.scrollWidth
    const containerWidth = container.clientWidth
    const scrollLeft = container.scrollLeft
    const scrollRight = scrollLeft + containerWidth

    if (playheadPosition < scrollLeft || playheadPosition > scrollRight) {
      const scrollPosition = playheadPosition - containerWidth / 2
      container.scrollTo({
        left: Math.max(0, Math.min(scrollPosition, container.scrollWidth - containerWidth)),
        behavior: "smooth",
      })
    }
  }

  const handleExport = async () => {
    if (selectedSegments.size === 0) {
      alert("Please select at least one segment to export")
      return
    }

    setIsExporting(true)
    setExportProgress(0)

    const progressInterval = setInterval(() => {
      setExportProgress((prev) => {
        if (prev >= 95) return prev
        return prev + 5
      })
    }, 500)

    try {
      const segmentsToExport = videoData.segments
        .filter((_, index) => selectedSegments.has(index))
        .map((seg) => ({ start: seg.start, end: seg.end }))

      const response = await fetch("/api/export", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ segments: segmentsToExport }),
      })

      if (!response.ok) {
        throw new Error("Export failed")
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `highlight-export.mp4`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      setExportProgress(100)
    } catch (error) {
      console.error("Export error:", error)
      alert("Failed to export video")
    } finally {
      clearInterval(progressInterval)
      setTimeout(() => {
        setIsExporting(false)
        setExportProgress(0)
      }, 1000)
    }
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    const container = timelineScrollRef.current
    if (!container) return

    if (e.button !== 0) return

    const rect = container.getBoundingClientRect()
    setIsDragging(true)
    dragStartRef.current = {
      x: e.clientX - rect.left,
      scrollLeft: container.scrollLeft,
    }
    container.style.cursor = "grabbing"
    container.style.userSelect = "none"
  }

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging) return

    const container = timelineScrollRef.current
    if (!container) return

    e.preventDefault()
    const rect = container.getBoundingClientRect()
    const x = e.clientX - rect.left
    const walk = (x - dragStartRef.current.x) * 1.5
    container.scrollLeft = dragStartRef.current.scrollLeft - walk
  }

  const handleMouseUp = () => {
    setIsDragging(false)
    const container = timelineScrollRef.current
    if (container) {
      container.style.cursor = "grab"
      container.style.userSelect = ""
    }
  }

  const handleTimelineScrub = (clientX: number) => {
    const container = timelineScrollRef.current
    if (!container) return
    const inner = container.firstElementChild as HTMLElement
    if (!inner) return
    const totalWidth = inner.scrollWidth
    const offsetX = clientX - container.getBoundingClientRect().left + container.scrollLeft
    const ratio = Math.max(0, Math.min(1, offsetX / totalWidth))
    handleSeek([ratio * duration])
  }

  const handlePlayheadMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    setIsScrubbing(true)
    handleTimelineScrub(e.clientX)
  }

  useEffect(() => {
    if (isScrubbing) {
      const onMove = (e: MouseEvent) => {
        e.preventDefault()
        handleTimelineScrub(e.clientX)
      }
      const onUp = () => setIsScrubbing(false)
      document.addEventListener("mousemove", onMove)
      document.addEventListener("mouseup", onUp)
      return () => {
        document.removeEventListener("mousemove", onMove)
        document.removeEventListener("mouseup", onUp)
      }
    }
  }, [isScrubbing, duration])

  useEffect(() => {
    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove)
      document.addEventListener("mouseup", handleMouseUp)
      return () => {
        document.removeEventListener("mousemove", handleMouseMove)
        document.removeEventListener("mouseup", handleMouseUp)
      }
    }
  }, [isDragging])

  useEffect(() => {
    const container = timelineScrollRef.current
    if (!container) return

    updateScrollButtons()
    container.addEventListener("scroll", updateScrollButtons)
    const resizeObserver = new ResizeObserver(updateScrollButtons)
    resizeObserver.observe(container)

    return () => {
      container.removeEventListener("scroll", updateScrollButtons)
      resizeObserver.disconnect()
    }
  }, [zoom, duration])

  useEffect(() => {
    if (duration > 0 && isPlaying) {
      const timeoutId = setTimeout(() => {
        scrollToCurrentPosition()
      }, 100)
      return () => clearTimeout(timeoutId)
    }
  }, [currentTime, duration, zoom, isPlaying])

  useEffect(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    const container = videoContainerRef.current
    if (!video || !canvas || !container) return
    if (!ballDetections?.length) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    let rafId: number

    const draw = () => {
      rafId = requestAnimationFrame(draw)

      const dpr = window.devicePixelRatio || 1
      const rect = container.getBoundingClientRect()
      const w = Math.round(rect.width)
      const h = Math.round(rect.height)

      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr
        canvas.height = h * dpr
        canvas.style.width = `${w}px`
        canvas.style.height = `${h}px`
        ctx.scale(dpr, dpr)
      }

      ctx.clearRect(0, 0, w, h)

      if (!showBallTracking) return
      if (!video.videoWidth || !video.videoHeight) return

      const currentVideoTime = video.currentTime
      let closestDetection = ballDetections[0]
      let minDiff = Math.abs(closestDetection.time - currentVideoTime)

      for (const detection of ballDetections) {
        const diff = Math.abs(detection.time - currentVideoTime)
        if (diff < minDiff) {
          minDiff = diff
          closestDetection = detection
        }
      }

      if (minDiff > 0.2 || !closestDetection.boxes.length) return

      const videoAspect = video.videoWidth / video.videoHeight
      const containerAspect = w / h

      let displayWidth: number, displayHeight: number, offsetX: number, offsetY: number

      if (videoAspect > containerAspect) {
        displayWidth = w
        displayHeight = w / videoAspect
        offsetX = 0
        offsetY = (h - displayHeight) / 2
      } else {
        displayHeight = h
        displayWidth = h * videoAspect
        offsetX = (w - displayWidth) / 2
        offsetY = 0
      }

      const scaleX = displayWidth / video.videoWidth
      const scaleY = displayHeight / video.videoHeight

      for (const box of closestDetection.boxes) {
        const x = offsetX + box.x * scaleX
        const y = offsetY + box.y * scaleY
        const bw = box.w * scaleX
        const bh = box.h * scaleY

        ctx.shadowColor = "#ff6600"
        ctx.shadowBlur = 12

        ctx.fillStyle = "rgba(255, 102, 0, 0.2)"
        ctx.fillRect(x, y, bw, bh)

        ctx.strokeStyle = "#ff6600"
        ctx.lineWidth = 3
        ctx.strokeRect(x, y, bw, bh)

        ctx.shadowBlur = 0

        const label = `${box.class ?? "Ball"} ${Math.round(box.confidence * 100)}%`
        ctx.font = "bold 12px sans-serif"
        const labelW = ctx.measureText(label).width + 10
        const labelH = 22
        const labelY = y - labelH - 4

        ctx.fillStyle = "rgba(255, 102, 0, 0.9)"
        ctx.beginPath()
        ctx.roundRect(x, labelY, labelW, labelH, 4)
        ctx.fill()

        ctx.fillStyle = "#fff"
        ctx.fillText(label, x + 5, labelY + 15)
      }
    }

    rafId = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafId)
  }, [showBallTracking, ballDetections])

  const ballDetectionTimeRemaining = (): string => {
    if (!isBallDetectionLoading || !ballDetectionStartRef.current) return ""
    if (ballDetectionProgress <= 0) return "Starting..."
    if (ballDetectionProgress >= 99) return "Almost done..."
    const elapsed = Date.now() - ballDetectionStartRef.current
    if (isStreamingRef.current) {
      const framesProcessed = accumulatedDetectionsRef.current.length
      if (framesProcessed > 5) {
        const remaining = Math.max(0, (100 - ballDetectionProgress) / ballDetectionProgress * elapsed)
        const seconds = Math.ceil(remaining / 1000)
        if (seconds < 60) return `~${seconds}s remaining (${framesProcessed} frames)`
        const minutes = Math.floor(seconds / 60)
        const secs = seconds % 60
        return `~${minutes}m ${secs}s remaining (${framesProcessed} frames)`
      }
      return `${accumulatedDetectionsRef.current.length} frames processed`
    }
    const estimatedMs = Math.max(10000, (duration || 60) * 800)
    const remaining = Math.max(0, estimatedMs - elapsed)
    const seconds = Math.ceil(remaining / 1000)
    if (seconds <= 0) return "Almost done..."
    if (seconds < 60) return `~${seconds}s remaining`
    const minutes = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `~${minutes}m ${secs}s remaining`
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-6 md:px-10 lg:px-12 py-6 md:py-6 flex flex-col gap-6">
        <div className="flex items-center justify-between shrink-0">
          <h1 className="flex items-center gap-2 text-lg font-bold text-foreground">
            <AppIcon className="h-5 w-5 shrink-0" />
            Highlight AI
          </h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onReset}>
              <RotateCcw className="h-4 w-4" />
              New Video
            </Button>
            <Button
              size="sm"
              variant={isExporting ? "secondary" : "default"}
              onClick={handleExport}
              disabled={selectedSegments.size === 0}
              className={`relative overflow-hidden w-[100px] ${isExporting ? "pointer-events-none" : ""}`}
            >
              <div
                className="absolute inset-0 bg-primary transition-all duration-300 ease-in-out"
                style={{
                  width: `${exportProgress}%`,
                  opacity: isExporting ? 1 : 0
                }}
              />
              <div className="relative flex items-center justify-center gap-2 z-10 w-full">
                {isExporting ? (
                  <span className="text-xs font-semibold">{exportProgress}%</span>
                ) : (
                  <>
                    <Download className="h-4 w-4" />
                    Export
                  </>
                )}
              </div>
            </Button>
            {isBallDetectionLoading ? (
              <Button variant="outline" size="sm" disabled className="gap-1.5">
                <Spinner className="h-3.5 w-3.5" />
                Ball
              </Button>
            ) : hasBallDetections ? (
              <Button
                variant={showBallTracking ? "default" : "outline"}
                size="sm"
                onClick={() => setShowBallTracking(!showBallTracking)}
                title={showBallTracking ? "Hide ball tracking" : "Show ball tracking"}
              >
                {showBallTracking ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                Ball
              </Button>
            ) : null}
            <ThemeSwitcher />
          </div>
        </div>

        {isBallDetectionLoading && (
          <div className="flex items-center gap-3 rounded-lg border border-orange-500/30 bg-orange-500/5 px-4 py-2.5">
            <Spinner className="h-4 w-4 shrink-0 text-orange-500" />
            <div className="flex flex-1 items-center gap-3">
              <p className="text-sm text-foreground">
                Analyzing ball tracking{accumulatedDetectionsRef.current.length > 0 ? ` (${accumulatedDetectionsRef.current.length} frames)` : ""}...
              </p>
              <p className="text-xs text-muted-foreground">{ballDetectionTimeRemaining()}</p>
            </div>
            <div className="w-32">
              <Progress value={ballDetectionProgress} className="h-1.5 bg-orange-500/20 [&>[data-slot=progress-indicator]]:bg-orange-500" />
            </div>
          </div>
        )}

        {showBallError && ballDetectionError && !isBallDetectionLoading && (
          <div className="flex items-center gap-3 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3">
            <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
            <p className="flex-1 text-sm text-destructive">{ballDetectionError}</p>
            <Button variant="ghost" size="icon-sm" onClick={() => setShowBallError(false)}>
              <X className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        )}

        <div ref={videoContainerRef} className="rounded-xl overflow-hidden bg-black relative aspect-video">
          <video
            ref={videoRef}
            src={videoData.url}
            className="h-full w-full object-contain"
            onClick={togglePlay}
            preload="auto"
            playsInline
            onError={(e) => {
              const video = e.target as HTMLVideoElement
              console.error("[VIDEO] Error loading video")
              console.error("[VIDEO] Video src:", videoData.url)
              console.error("[VIDEO] Error code:", video.error?.code)
              console.error("[VIDEO] Error message:", video.error?.message)
              console.error("[VIDEO] Network state:", video.networkState)
              console.error("[VIDEO] Ready state:", video.readyState)
            }}
            onLoadStart={() => console.log("[VIDEO] Load started")}
            onLoadedMetadata={() => console.log("[VIDEO] Metadata loaded")}
            onCanPlay={() => console.log("[VIDEO] Can play")}
          />

          <canvas
            ref={canvasRef}
            className="absolute inset-0 z-[5] pointer-events-none"
          />

          <div className="absolute bottom-0 left-0 right-0 z-10 bg-gradient-to-t from-black/80 to-transparent p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon-sm" onClick={toggleMute}>
                  {isMuted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </Button>
                <Slider
                  value={[isMuted ? 0 : volume]}
                  max={1}
                  step={0.01}
                  onValueChange={handleVolumeChange}
                  className="w-24"
                />
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={playPreviousSegment}
                  disabled={getPrevSelected(currentSegment) === null}
                >
                  <SkipBack className="h-5 w-5" />
                </Button>
                <Button size="icon-lg" onClick={togglePlay}>
                  {isPlaying ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6" />}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={playNextSegment}
                  disabled={getNextSelected(currentSegment) === null}
                >
                  <SkipForward className="h-5 w-5" />
                </Button>
              </div>

              <div className="flex items-center gap-2 text-xs text-white/70 w-32 justify-end">
                <span>{formatTime(currentTime)}</span>
                <span>/</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col border rounded-lg bg-card/50">
          <div className="px-4 py-3 flex items-center justify-between border-b">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground min-w-[3rem] tabular-nums">
                Clip {currentSegment + 1} of {Math.max(1, videoData.segments.length)}
              </span>
              <Badge variant="outline" className="gap-1">
                <Kbd className="h-4 min-w-4 text-[10px]">⌘</Kbd>
                <span className="text-muted-foreground">+</span>
                <span>Click</span>
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setZoom(Math.max(0.5, zoom - 0.5))}
              >
                -
              </Button>
              <span className="text-xs text-muted-foreground">Zoom: {zoom}x</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setZoom(Math.min(10, zoom + 0.5))}
              >
                +
              </Button>
            </div>
          </div>

          <div className="relative w-full h-[160px] overflow-visible">
            {duration > 0 && (
              <div
                className="absolute z-30 -translate-x-1/2 cursor-col-resize"
                style={{
                  left: Math.max(0, Math.min(
                    timelineScrollRef.current?.clientWidth ?? 0,
                    (currentTime / duration) * timelineScroll.scrollWidth - timelineScroll.scrollLeft
                  )),
                  top: -5,
                }}
                onMouseDown={handlePlayheadMouseDown}
              >
                <div className="w-3.5 h-3.5 rounded-full bg-primary border-2 border-background" />
              </div>
            )}
            {isBallDetectionLoading && duration > 0 && (
              <div
                className="absolute top-0 right-0 h-full z-[5] pointer-events-none transition-all duration-500 ease-linear"
                style={{
                  width: `${100 - ballDetectionProgress}%`,
                  backgroundImage: "repeating-linear-gradient(45deg, transparent, transparent 4px, oklch(0.5 0 0 / 0.15) 4px, oklch(0.5 0 0 / 0.15) 8px)",
                }}
              />
            )}
            {canScrollLeft && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute left-2 top-1/2 -translate-y-1/2 z-10 text-foreground"
                onClick={() => scrollTimeline("left")}
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
            )}
            {canScrollRight && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute right-2 top-1/2 -translate-y-1/2 z-10 text-foreground"
                onClick={() => scrollTimeline("right")}
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
            )}
            <div
              ref={timelineScrollRef}
              className="overflow-x-auto overflow-y-hidden scrollbar-hide w-full h-[160px] cursor-grab active:cursor-grabbing rounded-b-lg"
              onScroll={updateScrollButtons}
              onMouseDown={handleMouseDown}
              onWheel={(e) => {
                if (e.shiftKey) {
                  e.preventDefault()
                  const container = timelineScrollRef.current
                  if (container) {
                    container.scrollLeft += e.deltaY
                  }
                }
              }}
            >
              <div
                className="relative h-full min-w-full bg-muted"
                style={{ width: `${zoom * 100}%`, minHeight: "100%" }}
              >
                {videoData.segments.map((segment, index) => {
                  const selected = selectedSegments.has(index)
                  return (
                    <div
                      role="button"
                      tabIndex={0}
                      key={index}
                      className={`absolute top-0 h-full border-r border-border/50 transition-all ${!selected
                        ? "bg-muted-foreground/20"
                        : currentSegment === index
                          ? "bg-primary/30"
                          : "bg-primary/15 hover:bg-primary/20"
                        }`}
                      style={{
                        left: `${(segment.start / duration) * 100}%`,
                        width: `${((segment.end - segment.start) / duration) * 100}%`,
                      }}
                      onClick={(e) => {
                        if (!isDragging) {
                          if (e.metaKey || e.ctrlKey) {
                            setSelectedSegments((prev) => {
                              const next = new Set(prev)
                              if (next.has(index)) {
                                if (prev.size === videoData.segments.length) return new Set([index])
                                next.delete(index)
                              } else {
                                next.add(index)
                              }
                              return next
                            })
                          } else {
                            jumpToSegment(index)
                          }
                        }
                      }}
                      onMouseDown={(e) => {
                        if (e.button === 0) {
                          e.stopPropagation()
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault()
                          jumpToSegment(index)
                        }
                      }}
                    >
                      <div
                        className="absolute top-1 right-1"
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <Checkbox
                          checked={selected}
                          onCheckedChange={(checked) =>
                            setSelectedSegments((prev) => {
                              const next = new Set(prev)
                              if (checked === true) {
                                next.add(index)
                              } else {
                                if (prev.size === videoData.segments.length) return new Set([index])
                                next.delete(index)
                              }
                              return next
                            })
                          }
                          className="border-foreground/30 bg-background/60 data-[state=checked]:!bg-primary data-[state=checked]:!text-primary-foreground data-[state=checked]:!border-primary"
                        />
                      </div>
                      <div className={`flex h-full flex-col items-center justify-center text-xs font-medium ${
                        !selected
                          ? "text-muted-foreground"
                          : currentSegment === index
                            ? "text-primary"
                            : "text-foreground"
                      }`}>
                        <div>S{index + 1}</div>
                        <div className={`text-[10px] ${
                          !selected
                            ? "text-muted-foreground/60"
                            : currentSegment === index
                              ? "text-primary/70"
                              : "text-muted-foreground"
                        }`}>{formatTime(segment.start)}</div>
                      </div>
                    </div>
                  )
                })}
                <div
                  className="absolute top-0 h-full z-20 -translate-x-1/2 cursor-col-resize"
                  style={{ left: `${(currentTime / duration) * 100}%`, width: "12px" }}
                  onMouseDown={handlePlayheadMouseDown}
                >
                  <div className="absolute left-1/2 -translate-x-1/2 top-0 h-full w-0.5 bg-primary" />
                </div>
                {showBallTracking && ballDetections && duration > 0 && ballDetections
                  .filter(detection => detection.boxes.some(box => box.class === "Made-Basket"))
                  .flatMap((detection, dIndex) =>
                    detection.boxes
                      .filter(box => box.class === "Made-Basket")
                      .map((box, bIndex) => (
                        <div
                          key={`basket-${dIndex}-${bIndex}`}
                          className="pointer-events-none absolute bottom-1 w-4 h-4 -translate-x-1/2 z-10"
                          style={{ left: `${(detection.time / duration) * 100}%` }}
                          title={`Made basket at ${detection.time.toFixed(1)}s (${(box.confidence * 100).toFixed(0)}%)`}
                        >
                          <svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
                            <path fill="#f97316" d="M248.37 41.094c-49.643 1.754-98.788 20.64-137.89 56.656L210.53 197.8c31.283-35.635 45.59-88.686 37.84-156.706zm18.126.107c7.646 71.205-7.793 129.56-43.223 169.345L256 243.27 401.52 97.75c-38.35-35.324-86.358-54.18-135.024-56.55zM97.75 110.48c-36.017 39.102-54.902 88.247-56.656 137.89 68.02 7.75 121.07-6.557 156.707-37.84L97.75 110.48zm316.5 0L268.73 256l32.71 32.71c33.815-30.112 81.05-45.78 138.183-45.11 10.088.118 20.49.753 31.176 1.9-2.37-48.665-21.227-96.672-56.55-135.02zM210.545 223.272c-39.785 35.43-98.14 50.87-169.344 43.223 2.37 48.666 21.226 96.675 56.55 135.025L243.27 256l-32.725-32.727zm225.002 38.27c-51.25.042-92.143 14.29-121.348 39.928l100.05 100.05c36.017-39.102 54.902-88.247 56.656-137.89-12.275-1.4-24.074-2.096-35.36-2.087zM256 268.73L110.48 414.25c38.35 35.324 86.358 54.18 135.024 56.55-7.646-71.205 7.793-129.56 43.223-169.345L256 268.73zm45.47 45.47c-31.283 35.635-45.59 88.686-37.84 156.706 49.643-1.754 98.788-20.64 137.89-56.656L301.47 314.2z" />
                          </svg>
                        </div>
                      ))
                  )
                }
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
