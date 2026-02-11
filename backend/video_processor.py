import os
import json
import time
import logging
import subprocess
import shutil
import base64
from logging.handlers import RotatingFileHandler
from flask import Flask, request, jsonify, Response, stream_with_context, send_file
from flask_cors import CORS
import cv2
import requests

CACHE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.cache')
os.makedirs(CACHE_DIR, exist_ok=True)
os.makedirs(os.path.join(CACHE_DIR, 'exports'), exist_ok=True)


def _cache_enabled() -> bool:
    v = os.getenv("CACHE_ENABLED", "1").lower()
    return v in ("1", "true", "yes")


def _clear_cache_files():
    for name in ["input.mp4", "input_original.mp4", "scenes.json", "ball_detections.json"]:
        path = os.path.join(CACHE_DIR, name)
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('video-processor')
logger.setLevel(logging.DEBUG)

console_handler = logging.StreamHandler()
console_handler.setLevel(logging.DEBUG)
console_handler.setFormatter(logging.Formatter(
    '%(asctime)s | %(levelname)-8s | %(message)s',
    datefmt='%H:%M:%S'
))
logger.addHandler(console_handler)

file_handler = RotatingFileHandler(
    os.path.join(CACHE_DIR, 'video-processor.log'),
    maxBytes=5 * 1024 * 1024,
    backupCount=3
)
file_handler.setLevel(logging.DEBUG)
file_handler.setFormatter(logging.Formatter(
    '%(asctime)s | %(levelname)-8s | %(funcName)s | %(message)s'
))
logger.addHandler(file_handler)

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 4 * 1024 * 1024 * 1024
CORS(app)


def detect_scenes(video_path: str, threshold: float = 70.0, min_scene_len: int = 15) -> list:
    from scenedetect import open_video, SceneManager
    from scenedetect.detectors import ContentDetector

    logger.info(f"Starting scene detection for: {video_path}")
    start_time = time.time()

    video = open_video(video_path)
    scene_manager = SceneManager()
    scene_manager.downscale = 4
    scene_manager.add_detector(ContentDetector(threshold=threshold, min_scene_len=min_scene_len))
    scene_manager.detect_scenes(video=video)
    scene_list = scene_manager.get_scene_list(start_in_scene=True)
    logger.info(f"Detected {len(scene_list)} scenes in {time.time() - start_time:.2f}s")

    scenes = []
    for i, (start, end) in enumerate(scene_list):
        start_sec = start.get_seconds()
        end_sec = end.get_seconds()
        scenes.append({"start": start_sec, "end": end_sec})
        logger.debug(f"  Scene {i + 1}: {start_sec:.2f}s - {end_sec:.2f}s")

    if not scenes:
        cap = cv2.VideoCapture(video_path)
        fps = cap.get(cv2.CAP_PROP_FPS) or 30
        frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
        cap.release()
        duration_sec = frame_count / fps if fps > 0 else 0
        if duration_sec > 0:
            scenes = [{"start": 0.0, "end": round(duration_sec, 2)}]
            logger.info(f"No scene cuts detected, using single segment 0 - {duration_sec:.2f}s")

    return scenes


def _extract_predictions(results):
    predictions = []
    if isinstance(results, list) and len(results) > 0:
        result = results[0]
        if isinstance(result, dict):
            predictions = result.get("predictions", [])
        elif hasattr(result, 'predictions'):
            predictions = result.predictions
    elif isinstance(results, dict):
        predictions = results.get("predictions", [])
    return predictions


def _extract_box(pred, confidence_threshold=0.5):
    if isinstance(pred, dict):
        conf = pred.get("confidence", 0)
        cx, cy = pred.get("x", 0), pred.get("y", 0)
        w, h = pred.get("width", 0), pred.get("height", 0)
        cls = pred.get("class", "Basketball")
    else:
        conf = getattr(pred, 'confidence', 0)
        cx, cy = getattr(pred, 'x', 0), getattr(pred, 'y', 0)
        w, h = getattr(pred, 'width', 0), getattr(pred, 'height', 0)
        cls = getattr(pred, 'class_name', None) or getattr(pred, 'class', "Basketball")

    if conf >= confidence_threshold:
        return {
            "x": round(cx - w / 2), "y": round(cy - h / 2),
            "w": round(w), "h": round(h),
            "confidence": round(conf, 3), "class": cls
        }
    return None


ROBOFLOW_MODEL_ID = "made-baskets-gswke/1"
ROBOFLOW_HOSTED_URL = "https://detect.roboflow.com"


def _infer_frame_api(frame, api_key: str, model_id: str, confidence: float = 0.5, overlap: float = 0.5):
    _, buf = cv2.imencode(".jpg", frame)
    b64 = base64.b64encode(buf.tobytes()).decode("ascii")
    url = f"{ROBOFLOW_HOSTED_URL}/{model_id}"
    params = {"api_key": api_key, "confidence": confidence, "overlap": overlap}
    r = requests.post(url, params=params, data=b64, headers={"Content-Type": "application/json"}, timeout=30)
    r.raise_for_status()
    return r.json()


def detect_balls(video_path: str, frame_skip: int = 2, confidence_threshold: float = 0.25) -> list:
    API_KEY = os.getenv("ROBOFLOW_API_KEY", "")
    if not API_KEY:
        raise ValueError("ROBOFLOW_API_KEY is required")

    logger.info(f"Starting ball detection for: {video_path} (Roboflow hosted API)")

    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    detections = []
    frame_count = 0
    processed_count = 0
    start_time = time.time()

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        if frame_count % frame_skip == 0:
            timestamp = frame_count / fps if fps > 0 else 0
            frame_detections = []

            try:
                results = _infer_frame_api(frame, API_KEY, ROBOFLOW_MODEL_ID, confidence=confidence_threshold)
                for pred in _extract_predictions(results):
                    box = _extract_box(pred, confidence_threshold)
                    if box:
                        frame_detections.append(box)
            except Exception as e:
                logger.warning(f"Error processing frame {frame_count}: {e}")

            detections.append({
                "time": round(timestamp, 3),
                "frame": frame_count,
                "boxes": frame_detections
            })
            processed_count += 1

            if processed_count % 100 == 0:
                progress = (frame_count / total_frames) * 100 if total_frames > 0 else 0
                logger.info(f"  Progress: {progress:.1f}% ({processed_count} frames)")

        frame_count += 1

    cap.release()
    logger.info(f"Ball detection complete in {time.time() - start_time:.2f}s ({processed_count} frames)")
    return detections


# ============================================================
# Routes
# ============================================================

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "ok", "service": "video-processor"})


@app.route('/upload', methods=['POST'])
def upload_video():
    if 'video' not in request.files:
        return jsonify({"error": "No video file provided"}), 400

    video = request.files['video']
    if not video.filename:
        return jsonify({"error": "No selected file"}), 400

    logger.info(f"Received video upload: {video.filename}")

    if not _cache_enabled():
        _clear_cache_files()

    original_path = os.path.join(CACHE_DIR, 'input_original.mp4')
    compressed_path = os.path.join(CACHE_DIR, 'input.mp4')
    scenes_path = os.path.join(CACHE_DIR, 'scenes.json')

    save_start = time.time()
    video.save(original_path)
    original_size = os.path.getsize(original_path)
    logger.info(f"Video saved ({original_size / 1024 / 1024:.2f} MB) in {time.time() - save_start:.2f}s")

    compress_start = time.time()
    try:
        subprocess.run([
            'ffmpeg', '-i', original_path,
            '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
            '-c:a', 'aac', '-b:a', '128k',
            '-movflags', '+faststart',
            compressed_path, '-y'
        ], capture_output=True, check=True, timeout=600)
        compressed_size = os.path.getsize(compressed_path)
        reduction = (1 - compressed_size / original_size) * 100 if original_size > 0 else 0
        logger.info(f"Compressed in {time.time() - compress_start:.2f}s "
                     f"({original_size / 1024 / 1024:.1f}MB -> {compressed_size / 1024 / 1024:.1f}MB, "
                     f"{reduction:.1f}% reduction)")
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
        logger.warning(f"Compression failed, using original: {e}")
        shutil.copy2(original_path, compressed_path)

    try:
        scenes = detect_scenes(compressed_path)
        if _cache_enabled():
            with open(scenes_path, 'w') as f:
                json.dump(scenes, f)
        return jsonify({"scenes": scenes})
    except Exception as e:
        logger.exception(f"Scene detection failed: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/video', methods=['GET'])
def serve_video():
    video_path = os.path.join(CACHE_DIR, 'input.mp4')
    if not os.path.exists(video_path):
        return jsonify({"error": "Video not found"}), 404

    file_size = os.path.getsize(video_path)
    range_header = request.headers.get('Range')

    if range_header:
        ranges = range_header.replace('bytes=', '').split('-')
        start = int(ranges[0])
        end = int(ranges[1]) if ranges[1] else file_size - 1
        start = max(0, min(start, file_size - 1))
        end = max(start, min(end, file_size - 1))
        chunk_size = end - start + 1

        def generate():
            with open(video_path, 'rb') as f:
                f.seek(start)
                remaining = chunk_size
                while remaining > 0:
                    data = f.read(min(65536, remaining))
                    if not data:
                        break
                    remaining -= len(data)
                    yield data

        return Response(generate(), status=206, headers={
            'Content-Range': f'bytes {start}-{end}/{file_size}',
            'Accept-Ranges': 'bytes',
            'Content-Length': str(chunk_size),
            'Content-Type': 'video/mp4',
        })

    return send_file(video_path, mimetype='video/mp4')


@app.route('/scenes', methods=['POST'])
def scenes_only():
    data = request.get_json()
    video_path = data.get('video_path')

    if not video_path or not os.path.exists(video_path):
        return jsonify({"error": "Invalid video_path"}), 400

    try:
        scenes = detect_scenes(video_path)
        return jsonify({"scenes": scenes})
    except Exception as e:
        logger.exception(f"Scene detection error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/balls', methods=['POST'])
def balls_only():
    data = request.get_json()
    video_path = data.get('video_path')
    frame_skip = data.get('frame_skip', 2)

    if not video_path or not os.path.exists(video_path):
        return jsonify({"error": "Invalid video_path"}), 400

    try:
        detections = detect_balls(video_path, frame_skip=frame_skip)
        return jsonify({"ballDetections": detections})
    except Exception as e:
        logger.exception(f"Ball detection error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/balls/stream', methods=['POST'])
def balls_stream():
    data = request.get_json() or {}
    frame_skip = data.get('frame_skip', 2)
    confidence_threshold = data.get('confidence_threshold', 0.25)

    video_path = data.get('video_path') or os.path.join(CACHE_DIR, 'input.mp4')
    cache_path = os.path.join(CACHE_DIR, 'ball_detections.json')

    if not os.path.exists(video_path):
        return jsonify({"error": "No video found. Upload a video first."}), 400

    def generate():
        if _cache_enabled() and os.path.exists(cache_path):
            try:
                with open(cache_path) as f:
                    cached = json.load(f)
                logger.info(f"Returning cached ball detections ({len(cached)} frames)")
                yield json.dumps({"type": "meta", "totalFrames": len(cached), "cached": True}) + "\n"
                for detection in cached:
                    yield json.dumps({"type": "detection", "data": detection, "processed": len(cached), "total": len(cached)}) + "\n"
                yield json.dumps({"type": "done", "processed": len(cached), "cached": True}) + "\n"
                return
            except Exception:
                pass

        API_KEY = os.getenv("ROBOFLOW_API_KEY", "")
        if not API_KEY:
            yield json.dumps({"type": "error", "message": "ROBOFLOW_API_KEY is required. Get one at https://docs.roboflow.com/api-reference/authentication#retrieve-an-api-key"}) + "\n"
            return

        cap = cv2.VideoCapture(video_path)
        fps = cap.get(cv2.CAP_PROP_FPS)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        frames_to_process = total_frames // frame_skip + (1 if total_frames % frame_skip else 0)

        yield json.dumps({"type": "meta", "totalFrames": frames_to_process, "fps": fps, "videoFrames": total_frames}) + "\n"

        all_detections = []
        frame_count = 0
        processed_count = 0
        start_time = time.time()

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            if frame_count % frame_skip == 0:
                timestamp = frame_count / fps if fps > 0 else 0
                frame_detections = []

                try:
                    results = _infer_frame_api(frame, API_KEY, ROBOFLOW_MODEL_ID, confidence=confidence_threshold)
                    for pred in _extract_predictions(results):
                        box = _extract_box(pred, confidence_threshold)
                        if box:
                            frame_detections.append(box)
                except Exception as e:
                    logger.warning(f"Error processing frame {frame_count}: {e}")

                processed_count += 1
                detection = {"time": round(timestamp, 3), "frame": frame_count, "boxes": frame_detections}
                all_detections.append(detection)
                yield json.dumps({"type": "detection", "data": detection, "processed": processed_count, "total": frames_to_process}) + "\n"

            frame_count += 1

        cap.release()

        if _cache_enabled():
            try:
                with open(cache_path, 'w') as f:
                    json.dump(all_detections, f)
                logger.info(f"Saved {len(all_detections)} ball detections to cache")
            except Exception as e:
                logger.warning(f"Failed to cache ball detections: {e}")

        elapsed = time.time() - start_time
        logger.info(f"Streaming ball detection complete in {elapsed:.2f}s ({processed_count} frames)")
        yield json.dumps({"type": "done", "processed": processed_count, "elapsed": round(elapsed, 2)}) + "\n"

    return Response(stream_with_context(generate()), content_type='application/x-ndjson')


@app.route('/export', methods=['POST'])
def export_video():
    data = request.get_json()
    segments = data.get('segments', [])

    if not segments:
        return jsonify({"error": "No segments provided"}), 400

    input_path = os.path.join(CACHE_DIR, 'input.mp4')
    if not os.path.exists(input_path):
        return jsonify({"error": "Input video not found. Please upload a video first."}), 404

    export_dir = os.path.join(CACHE_DIR, 'exports')
    os.makedirs(export_dir, exist_ok=True)

    timestamp = int(time.time() * 1000)
    output_path = os.path.join(export_dir, f'export_{timestamp}.mp4')

    filter_complex = ""
    inputs = ""
    for i, seg in enumerate(segments):
        filter_complex += f"[0:v]trim=start={seg['start']}:end={seg['end']},setpts=PTS-STARTPTS[v{i}];"
        filter_complex += f"[0:a]atrim=start={seg['start']}:end={seg['end']},asetpts=PTS-STARTPTS[a{i}];"
        inputs += f"[v{i}][a{i}]"
    filter_complex += f"{inputs}concat=n={len(segments)}:v=1:a=1[outv][outa]"

    logger.info(f"Exporting {len(segments)} segments...")

    try:
        subprocess.run([
            'ffmpeg', '-i', input_path,
            '-filter_complex', filter_complex,
            '-map', '[outv]', '-map', '[outa]',
            '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
            '-c:a', 'aac', '-b:a', '128k',
            '-movflags', '+faststart',
            output_path, '-y'
        ], capture_output=True, check=True, timeout=600)
    except subprocess.CalledProcessError as e:
        stderr = e.stderr.decode() if e.stderr else str(e)
        logger.error(f"FFmpeg export failed: {stderr}")
        return jsonify({"error": "Export failed"}), 500
    except subprocess.TimeoutExpired:
        logger.error("FFmpeg export timed out")
        return jsonify({"error": "Export timed out"}), 500

    logger.info(f"Export complete: {output_path}")
    return send_file(output_path, mimetype='video/mp4', as_attachment=True, download_name='highlight-export.mp4')


@app.route('/balls/cache', methods=['DELETE'])
def clear_ball_cache():
    cache_path = os.path.join(CACHE_DIR, 'ball_detections.json')
    try:
        os.unlink(cache_path)
        logger.info("Cleared ball detection cache")
        return jsonify({"success": True})
    except FileNotFoundError:
        return jsonify({"success": True})


@app.route('/cache', methods=['GET'])
def check_cache():
    if not _cache_enabled():
        return jsonify({"exists": False})

    video_path = os.path.join(CACHE_DIR, 'input.mp4')
    scenes_path = os.path.join(CACHE_DIR, 'scenes.json')
    ball_detections_path = os.path.join(CACHE_DIR, 'ball_detections.json')

    if not os.path.exists(video_path) or not os.path.exists(scenes_path):
        return jsonify({"exists": False})

    try:
        with open(scenes_path) as f:
            scenes = json.load(f)
    except Exception:
        return jsonify({"exists": False})

    ball_detections = []
    if os.path.exists(ball_detections_path):
        try:
            with open(ball_detections_path) as f:
                ball_detections = json.load(f)
        except Exception:
            pass

    return jsonify({
        "exists": True,
        "videoSize": os.path.getsize(video_path),
        "scenes": scenes,
        "ballDetections": ball_detections,
    })


@app.route('/cache', methods=['DELETE'])
def clear_cache():
    files = ['input.mp4', 'input_original.mp4', 'scenes.json', 'ball_detections.json']
    deleted = []
    errors = []

    for filename in files:
        filepath = os.path.join(CACHE_DIR, filename)
        try:
            os.unlink(filepath)
            deleted.append(filepath)
        except FileNotFoundError:
            errors.append(filepath)

    if deleted:
        return jsonify({"success": True, "deleted": deleted, "errors": errors})
    return jsonify({"success": False, "error": "Cache not found"}), 404


if __name__ == '__main__':
    port = int(os.getenv('FLASK_PORT', 5001))
    logger.info(f"Starting Video Processor API on port {port}")
    app.run(host='0.0.0.0', port=port, debug=True)
