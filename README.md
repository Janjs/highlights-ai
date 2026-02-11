# 🏀 Highlights AI

**Basketball highlight reel maker that uses [Roboflow](https://roboflow.com) for basketball and made-basket detection, with scene-based editing so you can pick your best moments and export a clip.**

## Features

- 🎬 **Scene detection** — Splits video into segments using PySceneDetect (ContentDetector)
- 🏀 **Basketball & made-basket detection** — Roboflow-powered ball tracking and “Made-Basket” labels
- ✂️ **Visual timeline editor** — Interactive timeline with segment markers and playback
- ⏭️ **Segment navigation** — Jump between scenes and auto-select clips with made baskets
- 🎨 **Modern UI** — Responsive interface with dark/light mode, drag & drop upload

## How it works

1. **Upload** — Drag and drop your basketball video.
2. **Detect** — Scenes are split (ContentDetector); Roboflow detects basketball and made baskets per frame.
3. **Edit** — Use the timeline to navigate, optionally auto-select segments that contain made baskets.
4. **Export** — Pick segments and export your highlight reel.

### Detection

- **Scenes**: PySceneDetect ContentDetector (threshold 70, min length 15 frames, 4× downscale).
- **Ball & baskets**: Roboflow model (requires `ROBOFLOW_API_KEY`); classes include `Basketball` and `Made-Basket`.

## Setup

### Prerequisites

- **Node.js** (v18+)
- **Python 3** with: `pip install scenedetect opencv-python`

### Install & run

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The editor talks to a Flask backend for processing; see repo for backend setup.

### Environment variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXT_PUBLIC_CACHE` | Client-side cache (`0` or `1`) | `0` |
| `FLASK_API_URL` | Flask backend URL | `http://localhost:5001` |
| `FLASK_PORT` | Flask port | `5001` |
| `ROBOFLOW_API_KEY` | Roboflow API key for ball/basket detection ([get one](https://docs.roboflow.com/api-reference/authentication#retrieve-an-api-key)) | — |
| `SKIP_DETECTION` | Skip ball detection (`0` or `1`) | `0` |

## Stack

- **Frontend**: Next.js 15, React 19, Radix UI, Tailwind
- **Scenes**: PySceneDetect + OpenCV
- **Basketball & made baskets**: Roboflow
- **Video processing**: Flask backend + Node child_process where used

## Project structure

```
├── app/
│   ├── api/process-video/
│   └── page.tsx
├── components/
│   ├── video-upload.tsx
│   └── video-editor.tsx
├── highlights-clipper.py
└── clips/                 # generated clips (git-ignored)
```

## Supported formats

MP4, MOV, AVI, WebM, and other formats supported by the browser and OpenCV.
