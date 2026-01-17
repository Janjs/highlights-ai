"use client"

import type React from "react"

import { useState, useRef, useEffect } from "react"
import { Play, Pause, SkipForward, SkipBack, RotateCcw, Download, Volume2, VolumeX, ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { ThemeSwitcher } from "@/components/theme-switcher"

interface VideoEditorProps {
  videoData: {
    url: string
    segments: Array<{ start: number; end: number; url: string }>
  }
  onReset: () => void
}

export function VideoEditor({ videoData, onReset }: VideoEditorProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
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
  const [isDragging, setIsDragging] = useState(false)
  const dragStartRef = useRef({ x: 0, scrollLeft: 0 })

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
  }, [videoData.segments, currentSegment])

  const togglePlay = () => {
    const video = videoRef.current
    if (!video) return

    if (isPlaying) {
      video.pause()
    } else {
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

  const playNextSegment = () => {
    const video = videoRef.current
    if (!video) return

    const nextSegment = Math.min(currentSegment + 1, videoData.segments.length - 1)
    video.currentTime = videoData.segments[nextSegment].start
    setCurrentSegment(nextSegment)
    if (!isPlaying) {
      video.play()
      setIsPlaying(true)
    }
  }

  const playPreviousSegment = () => {
    const video = videoRef.current
    if (!video) return

    const prevSegment = Math.max(currentSegment - 1, 0)
    video.currentTime = videoData.segments[prevSegment].start
    setCurrentSegment(prevSegment)
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

    video.currentTime = videoData.segments[index].start
    setCurrentSegment(index)
  }

  const updateScrollButtons = () => {
    const container = timelineScrollRef.current
    if (!container) return

    setCanScrollLeft(container.scrollLeft > 0)
    setCanScrollRight(container.scrollLeft < container.scrollWidth - container.clientWidth - 1)
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

  return (
    <div className="flex flex-col h-screen max-h-screen w-screen overflow-hidden bg-black">
      {/* Top Header Bar */}
      <div className="bg-black border-b border-white/20 px-4 py-2 shrink-0">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-white">Highlight AI</h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onReset}>
              <RotateCcw className="h-4 w-4" />
              New Video
            </Button>
            <Button size="sm">
              <Download className="h-4 w-4" />
              Export
            </Button>
            <ThemeSwitcher />
          </div>
        </div>
      </div>

      {/* Video Container with Overlay Controls */}
      <div className="flex-1 relative min-h-0">
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

        {/* Video Controls Overlay */}
        <div className="absolute bottom-0 left-0 right-0 z-10 bg-gradient-to-t from-black via-black/80 to-transparent p-4">
          <div className="space-y-3">
            {/* Progress Bar */}
            <Slider value={[currentTime]} max={duration} step={0.1} onValueChange={handleSeek} className="w-full" />
            <div className="flex justify-between text-xs text-white/70">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>

            {/* Playback Controls */}
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
                  disabled={currentSegment === 0}
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
                  disabled={currentSegment === videoData.segments.length - 1}
                >
                  <SkipForward className="h-5 w-5" />
                </Button>
              </div>

              <div className="w-32" />
            </div>
          </div>
        </div>
      </div>

      {/* Segments Timeline Footer */}
      <div className="bg-black border-t border-white/20 shrink-0 flex flex-col">
        <div className="px-3 py-2 flex items-center justify-between">
          <span className="text-sm font-medium text-white">
            Segment {currentSegment + 1} of {videoData.segments.length}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setZoom(Math.max(0.5, zoom - 0.5))}
            >
              -
            </Button>
            <span className="text-xs text-white">Zoom: {zoom}x</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setZoom(Math.min(5, zoom + 0.5))}
            >
              +
            </Button>
          </div>
        </div>

        <div className="relative w-full flex-1 min-h-[200px]">
          {canScrollLeft && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute left-0 top-1/2 -translate-y-1/2 z-10"
              onClick={() => scrollTimeline("left")}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
          )}
          {canScrollRight && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute right-0 top-1/2 -translate-y-1/2 z-10"
              onClick={() => scrollTimeline("right")}
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          )}
          <div
            ref={timelineScrollRef}
            className="overflow-x-auto overflow-y-hidden scrollbar-hide w-full h-full cursor-grab active:cursor-grabbing"
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
              className="relative h-full min-w-full bg-black/40"
              style={{ width: `${zoom * 100}%`, minHeight: "100%" }}
            >
              {videoData.segments.map((segment, index) => (
                <button
                  key={index}
                  className={`absolute top-0 h-full border-r border-white/10 transition-all ${currentSegment === index
                    ? "bg-primary"
                    : "bg-white/20 hover:bg-white/30"
                    }`}
                  style={{
                    left: `${(segment.start / duration) * 100}%`,
                    width: `${((segment.end - segment.start) / duration) * 100}%`,
                  }}
                  onClick={(e) => {
                    if (!isDragging) {
                      jumpToSegment(index)
                    }
                  }}
                  onMouseDown={(e) => {
                    if (e.button === 0) {
                      e.stopPropagation()
                    }
                  }}
                >
                  <div className="flex h-full flex-col items-center justify-center text-xs font-medium text-white">
                    <div>S{index + 1}</div>
                    <div className="text-[10px] opacity-70">{formatTime(segment.start)}</div>
                  </div>
                </button>
              ))}
              {/* Playhead */}
              <div
                className="pointer-events-none absolute top-0 h-full w-1 bg-accent z-20"
                style={{ left: `${(currentTime / duration) * 100}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
