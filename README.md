# Video Editor with AI Scene Detection

An intelligent video editor that automatically detects scene changes and splits videos into meaningful segments using AI-powered scene detection.

## Features

- **Intelligent Scene Detection**: Automatically analyzes videos to detect scene changes using PySceneDetect's ContentDetector algorithm
- **Visual Timeline Editor**: Interactive timeline with segment markers and playback controls
- **Segment Navigation**: Jump between detected scenes with keyboard controls
- **Modern UI**: Beautiful, responsive interface with dark/light mode support
- **Drag & Drop Upload**: Easy video upload with drag-and-drop support

## How It Works

The app uses PySceneDetect to intelligently identify scene boundaries in your videos:

1. **Upload**: Drag and drop your video file into the app
2. **Scene Detection**: The ContentDetector algorithm analyzes the video for significant changes in content (threshold: 70.0, minimum scene length: 15 frames)
3. **Automatic Segmentation**: Detected scenes are automatically converted into navigable segments
4. **Edit & Navigate**: Use the visual timeline to navigate between scenes, preview segments, and manage your video

### Scene Detection Algorithm

The app uses PySceneDetect's ContentDetector with the following parameters:
- **Threshold**: 70.0 (detects moderate to high content changes)
- **Minimum Scene Length**: 15 frames (prevents too-short segments)
- **Downscale Factor**: 4x (optimizes processing speed while maintaining accuracy)

## Setup

### Prerequisites

1. **Node.js** (v18 or higher)
2. **Python 3** with the following packages:
   ```bash
   pip install scenedetect opencv-python
   ```

### Installation

```bash
# Install dependencies
pnpm install

# Run development server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) to use the app.

## Technical Stack

- **Framework**: Next.js 15 with React 19
- **UI Components**: Radix UI with Tailwind CSS
- **Scene Detection**: PySceneDetect + OpenCV
- **Video Processing**: Server-side processing with Node.js child_process

## Project Structure

```
├── app/
│   ├── api/process-video/    # API route for video processing
│   └── page.tsx               # Main app page
├── components/
│   ├── video-upload.tsx       # Upload interface
│   └── video-editor.tsx       # Editor interface
├── highlights-clipper.py      # Python scene detection script
└── clips/                     # Generated video clips (git-ignored)
```

## Supported Formats

MP4, MOV, AVI, WebM, and other common video formats supported by the browser and OpenCV.
