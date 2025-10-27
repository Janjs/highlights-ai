"use client"

import type React from "react"

import { useState, useRef, useEffect } from "react"
import { Play, Pause, SkipForward, SkipBack, RotateCcw, Download, Volume2, VolumeX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
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
  const timelineRef = useRef<HTMLDivElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [currentSegment, setCurrentSegment] = useState(0)
  const [volume, setVolume] = useState(1)
  const [isMuted, setIsMuted] = useState(false)

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

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current
    const timeline = timelineRef.current
    if (!video || !timeline) return

    const rect = timeline.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const percentage = clickX / rect.width
    const newTime = percentage * duration

    video.currentTime = newTime
    setCurrentTime(newTime)
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
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="border-b border-border bg-card px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-foreground">Video Editor</h1>
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
      </header>

      {/* Main Content */}
      <div className="flex flex-1 flex-col gap-4 p-6">
        {/* Video Player */}
        <Card className="overflow-hidden">
          <div className="relative aspect-video bg-black">
            <video ref={videoRef} src={videoData.url} className="h-full w-full" onClick={togglePlay} />
            <div className="absolute bottom-4 right-4 rounded-lg bg-black/70 px-3 py-2 text-sm font-medium text-white">
              Segment {currentSegment + 1}/{videoData.segments.length}
            </div>
          </div>
        </Card>

        {/* Controls */}
        <Card className="p-6">
          <div className="space-y-6">
            {/* Playback Controls */}
            <div className="flex items-center justify-center gap-2">
              <Button variant="outline" size="icon" onClick={playPreviousSegment} disabled={currentSegment === 0}>
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
              >
                <SkipForward className="h-5 w-5" />
              </Button>
            </div>

            <div className="space-y-2">
              <div className="relative">
                <Slider value={[currentTime]} max={duration} step={0.1} onValueChange={handleSeek} className="w-full" />
                {/* Segment markers */}
                <div className="pointer-events-none absolute inset-0 flex">
                  {videoData.segments.map((segment, index) => (
                    <div
                      key={index}
                      className="border-r border-muted-foreground/20"
                      style={{ width: `${((segment.end - segment.start) / duration) * 100}%` }}
                    />
                  ))}
                </div>
              </div>
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>{formatTime(currentTime)}</span>
                <span>
                  Segment {currentSegment + 1} of {videoData.segments.length}
                </span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" onClick={toggleMute} className="h-8 w-8">
                {isMuted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </Button>
              <Slider
                value={[isMuted ? 0 : volume]}
                max={1}
                step={0.01}
                onValueChange={handleVolumeChange}
                className="w-32"
              />
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="mb-4 text-lg font-semibold text-foreground">Timeline</h2>
          <div className="space-y-4">
            {/* Visual timeline bar */}
            <div
              ref={timelineRef}
              onClick={handleTimelineClick}
              className="relative h-16 cursor-pointer overflow-hidden rounded-lg bg-secondary"
            >
              {/* Segment blocks */}
              {videoData.segments.map((segment, index) => (
                <div
                  key={index}
                  className={`absolute top-0 h-full border-r border-background transition-colors ${
                    currentSegment === index ? "bg-primary" : "bg-secondary hover:bg-secondary/80"
                  }`}
                  style={{
                    left: `${(segment.start / duration) * 100}%`,
                    width: `${((segment.end - segment.start) / duration) * 100}%`,
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    jumpToSegment(index)
                  }}
                >
                  <div className="flex h-full items-center justify-center text-xs font-medium text-foreground">
                    {index + 1}
                  </div>
                </div>
              ))}
              {/* Playhead indicator */}
              <div
                className="absolute top-0 h-full w-0.5 bg-accent"
                style={{ left: `${(currentTime / duration) * 100}%` }}
              />
            </div>

            {/* Segment list */}
            <div className="grid grid-cols-5 gap-2 md:grid-cols-10">
              {videoData.segments.map((segment, index) => (
                <button
                  key={index}
                  onClick={() => jumpToSegment(index)}
                  className={`rounded-lg p-3 text-center text-sm font-medium transition-all ${
                    currentSegment === index
                      ? "bg-primary text-primary-foreground shadow-lg"
                      : "bg-secondary text-secondary-foreground hover:bg-secondary/80 hover:shadow"
                  }`}
                >
                  <div className="text-xs opacity-80">S{index + 1}</div>
                  <div className="mt-1 text-xs">{formatTime(segment.start)}</div>
                </button>
              ))}
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
