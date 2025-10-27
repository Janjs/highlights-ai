"use client"

import type React from "react"

import { useState, useRef, useEffect } from "react"
import { Play, Pause, SkipForward, SkipBack, RotateCcw, Download, Volume2, VolumeX } from "lucide-react"
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
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [currentSegment, setCurrentSegment] = useState(0)
  const [volume, setVolume] = useState(1)
  const [isMuted, setIsMuted] = useState(false)
  const [zoom, setZoom] = useState(1)

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

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black">
      {/* Fullscreen Video */}
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

      {/* Top Controls Bar */}
      <div className="absolute left-0 right-0 top-0 z-10 bg-gradient-to-b from-black/80 to-transparent p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-white">Video Editor</h1>
          <div className="flex gap-2">
            <ThemeSwitcher />
            <Button variant="outline" size="sm" onClick={onReset}>
              <RotateCcw className="mr-2 h-4 w-4" />
              New Video
            </Button>
            <Button size="sm">
              <Download className="mr-2 h-4 w-4" />
              Export
            </Button>
          </div>
        </div>
      </div>

      {/* Scrollable Timeline Overlay */}
      <div className="absolute left-0 right-0 top-20 z-10 px-4">
        <div className="rounded-lg bg-black/70 p-4 backdrop-blur-sm">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-white">
              Segment {currentSegment + 1} of {videoData.segments.length}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-white hover:bg-white/20"
                onClick={() => setZoom(Math.max(0.5, zoom - 0.5))}
              >
                -
              </Button>
              <span className="text-xs text-white">Zoom: {zoom}x</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-white hover:bg-white/20"
                onClick={() => setZoom(Math.min(5, zoom + 0.5))}
              >
                +
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <div
              className="relative h-20 min-w-full rounded-lg bg-black/40"
              style={{ width: `${zoom * 100}%` }}
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
                  onClick={() => jumpToSegment(index)}
                >
                  <div className="flex h-full flex-col items-center justify-center text-xs font-medium text-white">
                    <div>S{index + 1}</div>
                    <div className="text-[10px] opacity-70">{formatTime(segment.start)}</div>
                  </div>
                </button>
              ))}
              {/* Playhead */}
              <div
                className="pointer-events-none absolute top-0 h-full w-1 bg-accent"
                style={{ left: `${(currentTime / duration) * 100}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Controls */}
      <div className="absolute bottom-0 left-0 right-0 z-10 bg-gradient-to-t from-black/80 to-transparent p-6">
        <div className="space-y-4">
          {/* Progress Bar */}
          <div className="relative">
            <Slider value={[currentTime]} max={duration} step={0.1} onValueChange={handleSeek} className="w-full" />
            <div className="mt-1 flex justify-between text-xs text-white/70">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Playback Controls */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={toggleMute} className="h-8 w-8 text-white hover:bg-white/20">
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
                className="text-white"
              >
                <SkipBack className="h-5 w-5" />
              </Button>
              <Button size="icon" onClick={togglePlay} className="h-12 w-12">
                {isPlaying ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6" />}
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={playNextSegment}
                disabled={currentSegment === videoData.segments.length - 1}
                className="text-white"
              >
                <SkipForward className="h-5 w-5" />
              </Button>
            </div>

            <div className="w-32" />
          </div>
        </div>
      </div>
    </div>
  )
}
