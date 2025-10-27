"use client"

import { useState } from "react"
import { VideoUpload } from "@/components/video-upload"
import { VideoEditor } from "@/components/video-editor"

export default function Home() {
  const [videoData, setVideoData] = useState<{
    url: string
    segments: Array<{ start: number; end: number; url: string }>
  } | null>(null)

  return (
    <main className="min-h-screen bg-background">
      {!videoData ? (
        <VideoUpload onVideoProcessed={setVideoData} />
      ) : (
        <VideoEditor videoData={videoData} onReset={() => setVideoData(null)} />
      )}
    </main>
  )
}
