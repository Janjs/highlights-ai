"use client"

import type React from "react"

import { useState, useRef, useEffect, useCallback } from "react"
import { Icons } from "@/components/icons"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Kbd } from "@/components/ui/kbd"
import { Progress } from "@/components/ui/progress"
import { Slider } from "@/components/ui/slider"
import { Spinner } from "@/components/ui/spinner"
import { ThemeSwitcher } from "@/components/theme-switcher"

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
  aiHighlighting?: boolean
  onBallDetectionsLoaded: (detections: BallDetection[], error?: string | null) => void
  onReset: () => void
}

export function VideoEditor({ videoData, ballDetections, ballDetectionError, aiHighlighting = true, onBallDetectionsLoaded, onReset }: VideoEditorProps) {
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
  const [zoom, setZoom] = useState(1)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const [timelineScroll, setTimelineScroll] = useState({ scrollLeft: 0, scrollWidth: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [isScrubbing, setIsScrubbing] = useState(false)
  type SegmentEntry = { start: number; end: number; url: string }
  const [segments, setSegments] = useState(videoData.segments)
  const [selectedSegments, setSelectedSegments] = useState<Set<number>>(
    () => new Set(videoData.segments.map((_, i) => i)),
  )
  const undoStackRef = useRef<{ segments: SegmentEntry[]; selectedSegments: number[] }[]>([])
  const redoStackRef = useRef<{ segments: SegmentEntry[]; selectedSegments: number[] }[]>([])
  const [isExporting, setIsExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const [showBallTracking, setShowBallTracking] = useState(true)
  const [showBallError, setShowBallError] = useState(!!ballDetectionError)
  const [ballDetectionResult, setBallDetectionResult] = useState<{ basketCount: number } | null>(null)
  const dragStartRef = useRef({ x: 0, scrollLeft: 0 })
  const videoRetryCountRef = useRef(0)

  const [isBallDetectionLoading, setIsBallDetectionLoading] = useState(false)
  const [ballDetectionProgress, setBallDetectionProgress] = useState(0)
  const ballDetectionStartRef = useRef(0)
  const ballDetectionAttemptedRef = useRef(false)
  const ballDetectionTimerRef = useRef<ReturnType<typeof setInterval>>(null)
  const accumulatedDetectionsRef = useRef<BallDetection[]>([])
  const lastFlushRef = useRef(0)
  const isStreamingRef = useRef(false)
  const abortControllerRef = useRef<AbortController | null>(null)

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

  const startBallDetection = useCallback(async (force = false) => {
    if (!force && (!aiHighlighting || hasBallDetections || ballDetectionAttemptedRef.current)) return
    ballDetectionAttemptedRef.current = true

    if (force) {
      try {
        await fetch("/api/detect-balls/cache", { method: "DELETE" })
      } catch {}
    }

    setIsBallDetectionLoading(true)
    setBallDetectionProgress(0)
    ballDetectionStartRef.current = Date.now()
    accumulatedDetectionsRef.current = []
    lastFlushRef.current = Date.now()
    isStreamingRef.current = false

    const abortController = new AbortController()
    abortControllerRef.current = abortController
    const timeout = setTimeout(() => abortController.abort(), 10 * 60 * 1000)

    const applyBasketSelection = (detections: BallDetection[]) => {
      const basketTimes = detections
        .filter((d) => d.boxes.some((b) => b.class === "Made-Basket"))
        .map((d) => d.time)
      const segmentsWithBaskets = new Set<number>()
      segments.forEach((seg, i) => {
        if (basketTimes.some((t) => t >= seg.start && t < seg.end)) {
          segmentsWithBaskets.add(i)
        }
      })
      setSelectedSegments(segmentsWithBaskets)
    }

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
              const finalDetections = [...accumulatedDetectionsRef.current]
              onBallDetectionsLoaded(finalDetections)
              applyBasketSelection(finalDetections)
              const basketCount = finalDetections.filter(d => d.boxes.some(b => b.class === "Made-Basket")).length
              setBallDetectionResult({ basketCount })
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
          if (parsed.type === "done") {
            const final = [...accumulatedDetectionsRef.current]
            onBallDetectionsLoaded(final)
            applyBasketSelection(final)
            const basketCount = final.filter(d => d.boxes.some(b => b.class === "Made-Basket")).length
            setBallDetectionResult({ basketCount })
            return
          }
        } catch {
          // skip
        }
      }

      const finalDetections = [...accumulatedDetectionsRef.current]
      onBallDetectionsLoaded(finalDetections)
      applyBasketSelection(finalDetections)
      const basketCount = finalDetections.filter(d => d.boxes.some(b => b.class === "Made-Basket")).length
      setBallDetectionResult({ basketCount })
    } catch (error) {
      console.error("[CLIENT] Ball detection failed:", error)
      if (abortController.signal.aborted) {
        onBallDetectionsLoaded([...accumulatedDetectionsRef.current])
      } else {
        onBallDetectionsLoaded(accumulatedDetectionsRef.current, "Ball detection failed. Check the server logs.")
        setShowBallError(true)
      }
    } finally {
      abortControllerRef.current = null
      clearTimeout(timeout)
      if (ballDetectionTimerRef.current) {
        clearInterval(ballDetectionTimerRef.current)
        ballDetectionTimerRef.current = null
      }
      setIsBallDetectionLoading(false)
      setBallDetectionProgress(0)
    }
  }, [aiHighlighting, hasBallDetections, onBallDetectionsLoaded, startEstimatedProgress])

  const rerunBallDetection = useCallback(() => {
    if (isBallDetectionLoading) return
    onBallDetectionsLoaded([], null)
    setShowBallError(false)
    ballDetectionAttemptedRef.current = false
    startBallDetection(true)
  }, [isBallDetectionLoading, onBallDetectionsLoaded, startBallDetection])

  const stopBallDetection = useCallback(() => {
    abortControllerRef.current?.abort()
  }, [])

  useEffect(() => {
    if (aiHighlighting && !hasBallDetections && !isBallDetectionLoading && !ballDetectionAttemptedRef.current && duration > 0) {
      startBallDetection()
    }
    return () => {
      if (ballDetectionTimerRef.current) clearInterval(ballDetectionTimerRef.current)
    }
  }, [duration, aiHighlighting])

  useEffect(() => {
    if (ballDetectionError) setShowBallError(true)
  }, [ballDetectionError])

  useEffect(() => {
    setSegments(videoData.segments)
    setSelectedSegments(new Set(videoData.segments.map((_, i) => i)))
    undoStackRef.current = []
    redoStackRef.current = []
  }, [videoData.url])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime)

      const segmentIndex = segments.findIndex(
        (seg) => video.currentTime >= seg.start && video.currentTime < seg.end,
      )
      if (segmentIndex !== -1 && segmentIndex !== currentSegment) {
        setCurrentSegment(segmentIndex)
      }

      if (segments.length === 0) return

      if (isPlaying && currentSegment >= 0 && currentSegment < segments.length) {
        const seg = segments[currentSegment]
        if (video.currentTime >= seg.end - 0.02) {
          const next = [...selectedSegments].filter((i) => i > currentSegment).sort((a, b) => a - b)[0] ?? null
          if (next != null) {
            video.currentTime = segments[next].start + 0.01
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
          video.currentTime = segments[next].start + 0.01
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
  }, [segments, currentSegment, isPlaying, selectedSegments])

  const togglePlay = () => {
    const video = videoRef.current
    if (!video) return

    if (isPlaying) {
      video.pause()
    } else {
      if (!selectedSegments.has(currentSegment)) {
        const next = getNextSelected(currentSegment) ?? [...selectedSegments].sort((a, b) => a - b)[0] ?? null
        if (next != null) {
          video.currentTime = segments[next].start + 0.01
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
    video.currentTime = segments[next].start + 0.01
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
    if (prev === null) {
      const seg = segments[currentSegment]
      if (seg) video.currentTime = seg.start + 0.01
      return
    }
    video.currentTime = segments[prev].start + 0.01
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

    const segment = segments[index]
    const seekTime = Math.min(segment.start + 0.15, segment.end - 0.01)
    video.currentTime = Math.max(segment.start, seekTime)
    setCurrentSegment(index)
  }

  const minSplitMargin = 0.05
  const splitSegmentIndex = segments.findIndex(
    (seg) => currentTime > seg.start + minSplitMargin && currentTime < seg.end - minSplitMargin
  )
  const canSplit = splitSegmentIndex !== -1

  const maxUndo = 50
  const segmentsRef = useRef(segments)
  const selectedSegmentsRef = useRef(selectedSegments)
  segmentsRef.current = segments
  selectedSegmentsRef.current = selectedSegments

  const splitAtPlayhead = () => {
    if (!canSplit) return
    const seg = segments[splitSegmentIndex]
    const prevSegments = segmentsRef.current
    const prevSelected = selectedSegmentsRef.current
    if (undoStackRef.current.length >= maxUndo) undoStackRef.current.shift()
    undoStackRef.current.push({
      segments: prevSegments,
      selectedSegments: [...prevSelected],
    })
    redoStackRef.current = []
    setSegments((prev) => [
      ...prev.slice(0, splitSegmentIndex),
      { ...seg, start: seg.start, end: currentTime, url: seg.url },
      { ...seg, start: currentTime, end: seg.end, url: seg.url },
      ...prev.slice(splitSegmentIndex + 1),
    ])
    setSelectedSegments((prev) => {
      const next = new Set<number>()
      prev.forEach((idx) => {
        if (idx < splitSegmentIndex) next.add(idx)
        else if (idx === splitSegmentIndex) {
          next.add(splitSegmentIndex)
          next.add(splitSegmentIndex + 1)
        } else next.add(idx + 1)
      })
      return next
    })
  }

  const undo = useCallback(() => {
    const stack = undoStackRef.current
    if (stack.length === 0) return
    const current = { segments: segmentsRef.current, selectedSegments: [...selectedSegmentsRef.current] }
    redoStackRef.current.push(current)
    const prev = stack.pop()!
    setSegments(prev.segments)
    setSelectedSegments(new Set(prev.selectedSegments))
    setCurrentSegment((s) => Math.min(s, prev.segments.length - 1))
  }, [])

  const redo = useCallback(() => {
    const stack = redoStackRef.current
    if (stack.length === 0) return
    const current = { segments: segmentsRef.current, selectedSegments: [...selectedSegmentsRef.current] }
    undoStackRef.current.push(current)
    const next = stack.pop()!
    setSegments(next.segments)
    setSelectedSegments(new Set(next.selectedSegments))
    setCurrentSegment((s) => Math.min(s, next.segments.length - 1))
  }, [])

  const splitAtPlayheadRef = useRef(splitAtPlayhead)
  splitAtPlayheadRef.current = splitAtPlayhead
  const undoRef = useRef(undo)
  const redoRef = useRef(redo)
  undoRef.current = undo
  redoRef.current = redo
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") return
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault()
        if (e.shiftKey) redoRef.current()
        else undoRef.current()
        return
      }
      if (e.key === "s" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (splitAtPlayheadRef.current) {
          e.preventDefault()
          splitAtPlayheadRef.current()
        }
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

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
      const segmentsToExport = segments
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

        const cx = x + bw / 2
        const cy = y + bh / 2
        const radius = Math.max(bw, bh) / 2

        ctx.shadowColor = "#ff6600"
        ctx.shadowBlur = 12

        ctx.fillStyle = "rgba(255, 102, 0, 0.25)"
        ctx.beginPath()
        ctx.arc(cx, cy, radius, 0, Math.PI * 2)
        ctx.fill()

        ctx.strokeStyle = "#ff6600"
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.arc(cx, cy, radius, 0, Math.PI * 2)
        ctx.stroke()

        ctx.shadowBlur = 0
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
        if (seconds < 60) return `~${seconds}s remaining`
        const minutes = Math.floor(seconds / 60)
        const secs = seconds % 60
        return `~${minutes}m ${secs}s remaining`
      }
      return "Starting..."
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
          <h1 className="text-xl font-bold text-foreground">
            Highlight AI
          </h1>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={rerunBallDetection}
              disabled={isBallDetectionLoading}
              title={hasBallDetections ? "Rerun Detection" : "Run Detection"}
            >
              <Icons.aiSpark className="h-4 w-4" />
              {hasBallDetections ? "Rerun Detection" : "Run Detection"}
            </Button>
            <Button variant="outline" size="sm" onClick={onReset}>
              <Icons.rotateCcw className="h-4 w-4" />
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
                    <Icons.download className="h-4 w-4" />
                    Export
                  </>
                )}
              </div>
            </Button>
            <ThemeSwitcher />
          </div>
        </div>

        {isBallDetectionLoading && (
          <div className="flex items-center gap-3 rounded-lg border border-orange-500/30 bg-orange-500/5 px-4 py-2.5">
            <Spinner className="h-4 w-4 shrink-0 text-orange-500" />
            <div className="flex flex-1 items-center gap-3">
              <p className="text-sm text-foreground">
                Analyzing match...
              </p>
              <p className="text-xs text-muted-foreground">{ballDetectionTimeRemaining()}</p>
            </div>
            <div className="w-32">
              <Progress value={ballDetectionProgress} className="h-1.5 bg-orange-500/20 [&>[data-slot=progress-indicator]]:bg-orange-500" />
            </div>
            <Button variant="ghost" size="icon-sm" onClick={stopBallDetection}>
              <Icons.x className="h-3.5 w-3.5 text-orange-500" />
            </Button>
          </div>
        )}

        {showBallError && ballDetectionError && !isBallDetectionLoading && (
          <div className="flex items-center gap-3 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3">
            <Icons.alertTriangle className="h-4 w-4 shrink-0 text-destructive" />
            <p className="flex-1 text-sm text-destructive">{ballDetectionError}</p>
            <Button variant="ghost" size="icon-sm" onClick={() => setShowBallError(false)}>
              <Icons.x className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        )}

        {ballDetectionResult && !isBallDetectionLoading && (
          <div className="flex items-center gap-3 rounded-lg border border-green-500/30 bg-green-500/5 px-4 py-2.5">
            <Icons.check className="h-4 w-4 shrink-0 text-green-500" />
            <p className="flex-1 text-sm text-foreground">
              AI detection complete
              <span className="ml-2 text-xs text-muted-foreground">
                {ballDetectionResult.basketCount > 0
                  ? `Found ${ballDetectionResult.basketCount} made basket${ballDetectionResult.basketCount === 1 ? "" : "s"}`
                  : "No made baskets detected"}
              </span>
            </p>
            <Button variant="ghost" size="icon-sm" onClick={() => setBallDetectionResult(null)}>
              <Icons.x className="h-3.5 w-3.5 text-green-500" />
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
            onError={() => {
              if (videoRetryCountRef.current < 3) {
                videoRetryCountRef.current++
                setTimeout(() => {
                  const video = videoRef.current
                  if (video) {
                    video.src = videoData.url
                    video.load()
                  }
                }, 500 * videoRetryCountRef.current)
              }
            }}
            onCanPlay={() => { videoRetryCountRef.current = 0 }}
          />

          <canvas
            ref={canvasRef}
            className="absolute inset-0 z-[5] pointer-events-none"
          />

          <div className="absolute bottom-0 left-0 right-0 z-10 bg-gradient-to-t from-black/80 to-transparent p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon-sm" onClick={toggleMute}>
                  {isMuted || volume === 0 ? <Icons.volumeX className="h-4 w-4" /> : <Icons.volume2 className="h-4 w-4" />}
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
                >
                  <Icons.skipBack className="h-5 w-5" />
                </Button>
                <Button size="icon-lg" onClick={togglePlay}>
                  {isPlaying ? <Icons.pause className="h-6 w-6" /> : <Icons.play className="h-6 w-6" />}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={playNextSegment}
                  disabled={getNextSelected(currentSegment) === null}
                >
                  <Icons.skipForward className="h-5 w-5" />
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
                Clip {currentSegment + 1} of {Math.max(1, segments.length)}
              </span>
              <Badge variant="outline" className="gap-1">
                <Kbd className="h-4 min-w-4 text-[10px]">⌘</Kbd>
                <span className="text-muted-foreground">+</span>
                <span>Click</span>
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={splitAtPlayhead}
                disabled={!canSplit}
                title="Split clip at playhead (S)"
              >
                <Icons.scissors className="h-4 w-4" />
                Split
              </Button>
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
                <Icons.chevronLeft className="h-5 w-5" />
              </Button>
            )}
            {canScrollRight && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute right-2 top-1/2 -translate-y-1/2 z-10 text-foreground"
                onClick={() => scrollTimeline("right")}
              >
                <Icons.chevronRight className="h-5 w-5" />
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
                {segments.map((segment, index) => {
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
                                if (prev.size === segments.length) return new Set([index])
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
                                if (prev.size === segments.length) return new Set([index])
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
                          className="pointer-events-none absolute bottom-1 w-4 h-4 -translate-x-1/2 z-10 rounded-full overflow-hidden"
                          style={{ left: `${(detection.time / duration) * 100}%` }}
                          title={`Made basket at ${detection.time.toFixed(1)}s (${(box.confidence * 100).toFixed(0)}%)`}
                        >
                          <Icons.basketball className="w-full h-full" />
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
