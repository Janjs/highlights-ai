"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import Link from "next/link"
import { Icons } from "@/components/icons"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ThemeSwitcher } from "@/components/theme-switcher"
import { Film, Zap, Target, ArrowRight, Play, ChevronDown } from "lucide-react"

interface BallDetection {
  time: number
  frame: number
  boxes: Array<{ x: number; y: number; w: number; h: number; confidence: number; class?: string }>
}

function DemoVideo() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const madeBasketLabelsRef = useRef<Map<number, { firstSeen: number; box: { x: number; y: number; w: number; h: number } }>>(new Map())
  const [isPlaying, setIsPlaying] = useState(false)
  const [ballDetections, setBallDetections] = useState<BallDetection[]>([])
  const [currentDetection, setCurrentDetection] = useState<{ confidence: number; isMadeBasket: boolean } | null>(null)

  useEffect(() => {
    fetch("/demo-detections.json")
      .then(res => res.json())
      .then((data: BallDetection[]) => {
        if (data?.length) setBallDetections(data)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!video || !canvas || !container) return
    if (!ballDetections.length) return

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

      const now = performance.now()
      const delay = 1500
      const fadeDuration = 800

      if (!video.videoWidth || !video.videoHeight) return

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

      if (minDiff <= 0.2 && closestDetection.boxes.length) {
        const topBox = closestDetection.boxes.reduce((a, b) => (b.confidence > a.confidence ? b : a), closestDetection.boxes[0])
        const hasMadeBasket = closestDetection.boxes.some(b => b.class === "Made-Basket")
        setCurrentDetection({ confidence: topBox.confidence, isMadeBasket: hasMadeBasket })

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

          if (box.class === "Made-Basket") {
            const key = closestDetection.time
            if (!madeBasketLabelsRef.current.has(key)) {
              madeBasketLabelsRef.current.set(key, { firstSeen: now, box: { x: box.x, y: box.y, w: box.w, h: box.h } })
            }
          }
        }
      } else {
        setCurrentDetection(null)
      }

      for (const [key, entry] of madeBasketLabelsRef.current) {
        const elapsed = now - entry.firstSeen
        if (elapsed > delay + fadeDuration) {
          madeBasketLabelsRef.current.delete(key)
          continue
        }
        let opacity = 1
        if (elapsed > delay) {
          opacity = Math.max(0, 1 - (elapsed - delay) / fadeDuration)
        }
        const lx = offsetX + entry.box.x * scaleX
        const ly = offsetY + entry.box.y * scaleY

        const label = "Made Basket"
        ctx.font = "bold 12px sans-serif"
        const labelW = ctx.measureText(label).width + 10
        const labelH = 22
        const labelY = ly - labelH - 4

        ctx.fillStyle = `rgba(255, 102, 0, ${0.9 * opacity})`
        ctx.beginPath()
        ctx.roundRect(lx, labelY, labelW, labelH, 4)
        ctx.fill()

        ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`
        ctx.fillText(label, lx + 5, labelY + 15)
      }
    }

    rafId = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafId)
  }, [ballDetections])

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      video.play()
      setIsPlaying(true)
    } else {
      video.pause()
      setIsPlaying(false)
    }
  }, [])

  return (
    <div className="relative mx-auto mt-16 max-w-4xl">
      <div className="relative overflow-hidden rounded-xl border bg-card shadow-xl">
        <div className="flex items-center gap-1.5 border-b bg-muted/50 px-4 py-2.5">
          <div className="h-2.5 w-2.5 rounded-full bg-destructive/60" />
          <div className="h-2.5 w-2.5 rounded-full bg-primary/40" />
          <div className="h-2.5 w-2.5 rounded-full bg-green-500/40" />
          <span className="ml-3 text-xs text-muted-foreground">Highlight AI Editor</span>
        </div>
        <div ref={containerRef} className="relative cursor-pointer" onClick={togglePlay}>
          <video
            ref={videoRef}
            src="/demo.mp4"
            className="w-full"
            muted
            loop
            playsInline
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
          />
          <canvas
            ref={canvasRef}
            className="absolute inset-0 z-[5] pointer-events-none"
          />
          {!isPlaying && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-foreground/5">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-110">
                <Play className="ml-1 h-7 w-7" />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-center gap-3 text-sm">
        {currentDetection ? (
          <>
            <div className="flex items-center gap-1.5 rounded-full bg-card border px-3 py-1.5 shadow-sm">
              <Icons.basketball className="h-4 w-4" />
              <span className="font-medium text-foreground">
                {(currentDetection.confidence * 100).toFixed(0)}%
              </span>
              <span className="text-muted-foreground">confidence</span>
            </div>
            {currentDetection.isMadeBasket && (
              <div className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-primary-foreground shadow-sm animate-in fade-in duration-300">
                <Icons.check className="h-3.5 w-3.5" />
                <span className="font-medium">Made Basket</span>
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center gap-1.5 rounded-full bg-card border px-3 py-1.5 shadow-sm text-muted-foreground">
            <Icons.basketball className="h-4 w-4 opacity-40" />
            <span>{isPlaying ? "Scanning..." : "Play to see AI detection"}</span>
          </div>
        )}
      </div>

      <div className="absolute -bottom-3 left-1/2 h-6 w-[90%] -translate-x-1/2 rounded-xl bg-primary/10 blur-xl" />
    </div>
  )
}

const features = [
  {
    icon: Film,
    title: "AI Scene Detection",
    description: "Automatically splits your footage into individual scenes. No more scrubbing through hours of video.",
  },
  {
    icon: Target,
    title: "Ball Tracking",
    description: "Computer vision detects the ball in real-time, identifying made baskets and key plays automatically.",
  },
  {
    icon: Zap,
    title: "One-Click Export",
    description: "Select your best clips and export a polished highlight reel in seconds, ready to share.",
  },
]

const steps = [
  { number: "01", title: "Upload", description: "Drop in your game footage" },
  { number: "02", title: "AI Analyzes", description: "Scenes and key moments detected" },
  { number: "03", title: "Edit & Export", description: "Pick highlights, export your reel" },
]

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="fixed right-6 top-6 z-50">
        <ThemeSwitcher />
      </div>

      <section className="relative overflow-hidden px-6 pb-12 pt-24">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-1/2 left-1/2 h-[800px] w-[800px] -translate-x-1/2 rounded-full bg-primary/5 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-4xl text-center">
          <div className="mb-6 flex items-center justify-center gap-1">
            <Icons.appIcon className="h-7 w-7 text-primary" />
            <span className="text-2xl font-semibold text-foreground">Highlight AI</span>
          </div>

          <Badge variant="secondary" className="mb-6">
            <Icons.aiSpark className="h-3.5 w-3.5 text-primary" />
            Powered by computer vision
          </Badge>

          <h1 className="mx-auto max-w-3xl font-serif text-5xl font-bold leading-tight tracking-tight text-foreground sm:text-6xl lg:text-7xl">
            Turn game footage into
            <span className="text-primary"> highlight reels</span>
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
            Upload your basketball video. AI detects every scene and made basket.
            Pick your best moments and export — in minutes, not hours.
          </p>

          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Button size="lg" className="h-12 px-8 text-base" asChild>
              <Link href="/editor">
                Start editing
                <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" className="h-12 px-8 text-base" asChild>
              <a href="#demo">
                See it in action
                <ChevronDown className="ml-1 h-4 w-4" />
              </a>
            </Button>
          </div>
        </div>

        <div id="demo">
          <DemoVideo />
        </div>
      </section>

      <section className="px-6 py-24">
        <div className="mx-auto max-w-5xl">
          <div className="mb-14 text-center">
            <h2 className="font-serif text-3xl font-bold text-foreground sm:text-4xl">
              Everything you need, nothing you don&apos;t
            </h2>
            <p className="mt-3 text-muted-foreground">
              AI handles the tedious work so you can focus on the highlights.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-3">
            {features.map((feature) => (
              <Card key={feature.title} className="relative overflow-hidden p-6">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <feature.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="mb-2 font-semibold text-foreground">{feature.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {feature.description}
                </p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t bg-muted/30 px-6 py-24">
        <div className="mx-auto max-w-3xl">
          <div className="mb-14 text-center">
            <h2 className="font-serif text-3xl font-bold text-foreground sm:text-4xl">
              Three steps. That&apos;s it.
            </h2>
          </div>

          <div className="flex flex-col gap-8 sm:flex-row sm:gap-0">
            {steps.map((step, i) => (
              <div key={step.number} className="flex flex-1 items-start gap-4 sm:flex-col sm:items-center sm:text-center">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-foreground">
                  {step.number}
                </div>
                {i < steps.length - 1 && (
                  <div className="hidden h-px flex-1 self-center bg-border sm:block sm:mx-4" />
                )}
                <div className="sm:mt-4">
                  <h3 className="font-semibold text-foreground">{step.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{step.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-24">
        <div className="mx-auto max-w-2xl text-center">
          <Icons.basketball className="mx-auto mb-6 h-12 w-12" />
          <h2 className="font-serif text-3xl font-bold text-foreground sm:text-4xl">
            Ready to make your highlight reel?
          </h2>
          <p className="mt-4 text-muted-foreground">
            Upload your first video and let AI do the heavy lifting.
          </p>
          <Button size="lg" className="mt-8 h-12 px-8 text-base" asChild>
            <Link href="/editor">
              Get started — it&apos;s free
              <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </section>

      <footer className="border-t px-6 py-8">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icons.appIcon className="h-4 w-4 text-primary" />
            Highlight AI
          </div>
          <p className="text-xs text-muted-foreground">Built with AI + computer vision</p>
        </div>
      </footer>
    </div>
  )
}
