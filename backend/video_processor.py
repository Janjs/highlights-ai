import os
import json
import time
import logging
import subprocess
import shutil
import base64
import math
import threading
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from logging.handlers import RotatingFileHandler
from flask import Flask, request, jsonify, Response, stream_with_context, send_file
from flask_cors import CORS
import cv2
import requests

CACHE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.cache')
os.makedirs(CACHE_DIR, exist_ok=True)
os.makedirs(os.path.join(CACHE_DIR, 'exports'), exist_ok=True)


def _cache_enabled() -> bool:
    return False


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


def _env_int(name: str, default: int, min_value: int = 1, max_value: int = 64) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return max(min_value, min(max_value, value))


def _env_float(name: str, default: float, min_value: float = 0.0, max_value: float = 1.0) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = float(raw)
    except ValueError:
        return default
    return max(min_value, min(max_value, value))


def _persist_ball_cache_async(cache_path: str, detections: list):
    if not _cache_enabled():
        return

    snapshot = list(detections)

    def _worker():
        try:
            snapshot.sort(key=lambda d: d["frame"])
            with open(cache_path, 'w') as f:
                json.dump(snapshot, f)
            logger.info(f"Saved {len(snapshot)} ball detections to cache (async)")
        except Exception as e:
            logger.warning(f"Failed to cache ball detections: {e}")

    threading.Thread(target=_worker, daemon=True).start()


def _effective_frame_skip(requested_frame_skip: int, total_frames: int, target_samples: int) -> int:
    if requested_frame_skip > 0:
        return requested_frame_skip
    if total_frames <= 0:
        return 1
    return max(1, math.ceil(total_frames / max(1, target_samples)))


def _upload_encode_mode() -> str:
    # remux: fast path, transcode: slower but most compatible
    mode = os.getenv("UPLOAD_ENCODE_MODE", "remux").strip().lower()
    if mode in ("remux", "transcode"):
        return mode
    return "remux"


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


def _resize_for_inference(frame, infer_max_width: int):
    if infer_max_width <= 0:
        return frame, 1.0, 1.0
    h, w = frame.shape[:2]
    if w <= infer_max_width:
        return frame, 1.0, 1.0
    scale = infer_max_width / float(w)
    resized_h = max(1, int(h * scale))
    resized = cv2.resize(frame, (infer_max_width, resized_h), interpolation=cv2.INTER_AREA)
    scale_x = w / float(infer_max_width)
    scale_y = h / float(resized_h)
    return resized, scale_x, scale_y


def _infer_frame_api(frame, api_key: str, model_id: str, confidence: float = 0.5, overlap: float = 0.5,
                     session: requests.Session | None = None, infer_max_width: int = 0):
    frame_for_inference, scale_x, scale_y = _resize_for_inference(frame, infer_max_width)
    _, buf = cv2.imencode(".jpg", frame_for_inference, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
    b64 = base64.b64encode(buf.tobytes()).decode("ascii")
    url = f"{ROBOFLOW_HOSTED_URL}/{model_id}"
    params = {"api_key": api_key, "confidence": confidence, "overlap": overlap}
    client = session if session else requests
    r = client.post(url, params=params, data=b64, headers={"Content-Type": "application/json"}, timeout=30)
    r.raise_for_status()
    results = r.json()

    # Predictions are produced in resized-frame coordinates; map back to original frame size.
    if scale_x != 1.0 or scale_y != 1.0:
        predictions = _extract_predictions(results)
        for pred in predictions:
            if isinstance(pred, dict):
                pred["x"] = pred.get("x", 0) * scale_x
                pred["y"] = pred.get("y", 0) * scale_y
                pred["width"] = pred.get("width", 0) * scale_x
                pred["height"] = pred.get("height", 0) * scale_y

    return results


def detect_balls(video_path: str, frame_skip: int = 2, confidence_threshold: float = 0.25,
                 max_workers: int = 4, infer_max_width: int = 960) -> tuple[list, dict]:
    API_KEY = os.getenv("ROBOFLOW_API_KEY", "")
    if not API_KEY:
        raise ValueError("ROBOFLOW_API_KEY is required")

    frame_skip = max(1, int(frame_skip))
    max_workers = max(1, int(max_workers))
    infer_max_width = max(0, int(infer_max_width))

    logger.info(
        f"Starting ball detection for: {video_path} "
        f"(Roboflow hosted API, frame_skip={frame_skip}, workers={max_workers}, infer_max_width={infer_max_width})"
    )

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Failed to open video: {video_path}")
    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    frames_to_process = total_frames // frame_skip + (1 if total_frames % frame_skip else 0)

    detections = []
    frame_count = 0
    processed_count = 0
    start_time = time.time()
    submit_time = 0.0
    wait_time = 0.0
    failed_frames = 0

    thread_local = threading.local()

    def _get_session():
        if not hasattr(thread_local, "session"):
            session = requests.Session()
            adapter = requests.adapters.HTTPAdapter(pool_connections=max_workers, pool_maxsize=max_workers)
            session.mount("https://", adapter)
            session.mount("http://", adapter)
            thread_local.session = session
        return thread_local.session

    def _infer_task(frame, sampled_frame_count: int, timestamp: float):
        infer_start = time.time()
        frame_detections = []
        error_msg = None
        try:
            results = _infer_frame_api(
                frame,
                API_KEY,
                ROBOFLOW_MODEL_ID,
                confidence=confidence_threshold,
                session=_get_session(),
                infer_max_width=infer_max_width,
            )
            for pred in _extract_predictions(results):
                box = _extract_box(pred, confidence_threshold)
                if box:
                    frame_detections.append(box)
        except Exception as e:
            error_msg = str(e)

        infer_elapsed = (time.time() - infer_start) * 1000
        return {
            "time": round(timestamp, 3),
            "frame": sampled_frame_count,
            "boxes": frame_detections,
        }, error_msg, infer_elapsed

    max_in_flight = max_workers * 2
    in_flight = set()
    future_meta = {}

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        while True:
            grabbed = cap.grab()
            if not grabbed:
                break

            if frame_count % frame_skip == 0:
                ret, frame = cap.retrieve()
                if not ret:
                    break
                timestamp = frame_count / fps if fps > 0 else 0
                submit_start = time.time()
                future = executor.submit(_infer_task, frame, frame_count, timestamp)
                submit_time += (time.time() - submit_start) * 1000
                in_flight.add(future)
                future_meta[future] = frame_count

            frame_count += 1

            while len(in_flight) >= max_in_flight:
                wait_start = time.time()
                done, _ = wait(in_flight, return_when=FIRST_COMPLETED)
                wait_time += (time.time() - wait_start) * 1000
                for future in done:
                    in_flight.remove(future)
                    sampled_frame = future_meta.pop(future, None)
                    detection, error_msg, _ = future.result()
                    if error_msg:
                        failed_frames += 1
                        logger.warning(f"Error processing frame {sampled_frame}: {error_msg}")
                    detections.append(detection)
                    processed_count += 1
                    if processed_count % 100 == 0:
                        progress = (processed_count / frames_to_process) * 100 if frames_to_process > 0 else 0
                        logger.info(f"  Progress: {progress:.1f}% ({processed_count} frames)")

        while in_flight:
            wait_start = time.time()
            done, _ = wait(in_flight, return_when=FIRST_COMPLETED)
            wait_time += (time.time() - wait_start) * 1000
            for future in done:
                in_flight.remove(future)
                sampled_frame = future_meta.pop(future, None)
                detection, error_msg, _ = future.result()
                if error_msg:
                    failed_frames += 1
                    logger.warning(f"Error processing frame {sampled_frame}: {error_msg}")
                detections.append(detection)
                processed_count += 1
                if processed_count % 100 == 0:
                    progress = (processed_count / frames_to_process) * 100 if frames_to_process > 0 else 0
                    logger.info(f"  Progress: {progress:.1f}% ({processed_count} frames)")

    cap.release()
    detections.sort(key=lambda d: d["frame"])

    elapsed_ms = (time.time() - start_time) * 1000
    timings = {
        "totalMs": round(elapsed_ms, 2),
        "submitMs": round(submit_time, 2),
        "waitMs": round(wait_time, 2),
    }
    logger.info(
        f"Ball detection complete in {elapsed_ms / 1000:.2f}s "
        f"({processed_count} frames, failed={failed_frames}, timings={timings})"
    )
    return detections, timings


# ============================================================
# Routes
# ============================================================

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "ok", "service": "video-processor"})


@app.route('/upload', methods=['POST'])
def upload_video():
    request_start = time.time()
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
    save_ms = (time.time() - save_start) * 1000
    original_size = os.path.getsize(original_path)
    logger.info(f"Video saved ({original_size / 1024 / 1024:.2f} MB) in {save_ms / 1000:.2f}s")

    compress_start = time.time()
    compressed_size = original_size
    compression_fallback = False
    encode_mode = _upload_encode_mode()
    try:
        if encode_mode == "remux":
            subprocess.run([
                'ffmpeg', '-i', original_path,
                '-c', 'copy',
                '-movflags', '+faststart',
                compressed_path, '-y'
            ], capture_output=True, check=True, timeout=300)
        else:
            subprocess.run([
                'ffmpeg', '-i', original_path,
                '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
                '-c:a', 'aac', '-b:a', '128k',
                '-movflags', '+faststart',
                compressed_path, '-y'
            ], capture_output=True, check=True, timeout=600)
        compress_ms = (time.time() - compress_start) * 1000
        compressed_size = os.path.getsize(compressed_path)
        reduction = (1 - compressed_size / original_size) * 100 if original_size > 0 else 0
        logger.info(f"Upload encode ({encode_mode}) finished in {compress_ms / 1000:.2f}s "
                     f"({original_size / 1024 / 1024:.1f}MB -> {compressed_size / 1024 / 1024:.1f}MB, "
                     f"{reduction:.1f}% reduction)")
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
        if encode_mode == "remux":
            logger.warning(f"Remux failed, retrying with transcode: {e}")
            try:
                transcode_start = time.time()
                subprocess.run([
                    'ffmpeg', '-i', original_path,
                    '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
                    '-c:a', 'aac', '-b:a', '128k',
                    '-movflags', '+faststart',
                    compressed_path, '-y'
                ], capture_output=True, check=True, timeout=600)
                compress_ms = (time.time() - compress_start) * 1000
                compressed_size = os.path.getsize(compressed_path)
                logger.info(
                    f"Upload encode (fallback transcode) finished in {(time.time() - transcode_start):.2f}s"
                )
                compression_fallback = True
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e2:
                compress_ms = (time.time() - compress_start) * 1000
                logger.warning(f"Transcode fallback failed, using original: {e2}")
                shutil.copy2(original_path, compressed_path)
                compression_fallback = True
        else:
            compress_ms = (time.time() - compress_start) * 1000
            logger.warning(f"Compression failed, using original: {e}")
            shutil.copy2(original_path, compressed_path)
            compression_fallback = True

    try:
        scene_start = time.time()
        scenes = detect_scenes(compressed_path)
        scene_detect_ms = (time.time() - scene_start) * 1000
        if _cache_enabled():
            with open(scenes_path, 'w') as f:
                json.dump(scenes, f)
        timings = {
            "saveMs": round(save_ms, 2),
            "compressMs": round(compress_ms, 2),
            "sceneDetectMs": round(scene_detect_ms, 2),
            "totalMs": round((time.time() - request_start) * 1000, 2),
            "inputSizeBytes": original_size,
            "outputSizeBytes": compressed_size,
            "compressionFallback": compression_fallback,
            "encodeMode": encode_mode,
        }
        logger.info(f"Upload pipeline timings: {timings}")
        return jsonify({"scenes": scenes, "timings": timings})
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
    requested_frame_skip = int(data.get('frame_skip', _env_int("ROBOFLOW_FRAME_SKIP", 0, min_value=0, max_value=240)))
    confidence_threshold = float(data.get(
        'confidence_threshold',
        _env_float("ROBOFLOW_CONFIDENCE_THRESHOLD", 0.25, min_value=0.01, max_value=0.99),
    ))
    max_workers = int(data.get('max_workers', _env_int("ROBOFLOW_MAX_WORKERS", 4, min_value=1, max_value=16)))
    infer_max_width = int(data.get(
        'infer_max_width',
        _env_int("ROBOFLOW_INFER_MAX_WIDTH", 960, min_value=160, max_value=3840),
    ))

    if not video_path or not os.path.exists(video_path):
        return jsonify({"error": "Invalid video_path"}), 400

    try:
        cap = cv2.VideoCapture(video_path)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        cap.release()
        target_samples = _env_int("ROBOFLOW_TARGET_SAMPLES", 450, min_value=50, max_value=10000)
        frame_skip = _effective_frame_skip(requested_frame_skip, total_frames, target_samples)
        detections, timings = detect_balls(
            video_path,
            frame_skip=frame_skip,
            confidence_threshold=confidence_threshold,
            max_workers=max_workers,
            infer_max_width=infer_max_width,
        )
        return jsonify({
            "ballDetections": detections,
            "timings": timings,
            "settings": {
                "frameSkip": frame_skip,
                "requestedFrameSkip": requested_frame_skip,
                "targetSamples": target_samples,
                "confidenceThreshold": confidence_threshold,
                "maxWorkers": max_workers,
                "inferMaxWidth": infer_max_width,
            }
        })
    except Exception as e:
        logger.exception(f"Ball detection error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/balls/stream', methods=['POST'])
def balls_stream():
    request_start = time.time()
    data = request.get_json() or {}
    requested_frame_skip = int(data.get('frame_skip', _env_int("ROBOFLOW_FRAME_SKIP", 0, min_value=0, max_value=240)))
    confidence_threshold = float(data.get(
        'confidence_threshold',
        _env_float("ROBOFLOW_CONFIDENCE_THRESHOLD", 0.25, min_value=0.01, max_value=0.99),
    ))
    max_workers = int(data.get('max_workers', _env_int("ROBOFLOW_MAX_WORKERS", 4, min_value=1, max_value=16)))
    infer_max_width = int(data.get(
        'infer_max_width',
        _env_int("ROBOFLOW_INFER_MAX_WIDTH", 960, min_value=160, max_value=3840),
    ))

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
                yield json.dumps({
                    "type": "meta",
                    "totalFrames": len(cached),
                    "cached": True,
                    "settings": {
                        "frameSkip": frame_skip,
                        "confidenceThreshold": confidence_threshold,
                        "maxWorkers": max_workers,
                        "inferMaxWidth": infer_max_width,
                    }
                }) + "\n"
                for detection in cached:
                    yield json.dumps({"type": "detection", "data": detection, "processed": len(cached), "total": len(cached)}) + "\n"
                yield json.dumps({
                    "type": "done",
                    "processed": len(cached),
                    "cached": True,
                    "elapsed": round(time.time() - request_start, 2),
                    "timings": {
                        "totalMs": round((time.time() - request_start) * 1000, 2)
                    }
                }) + "\n"
                return
            except Exception:
                pass

        API_KEY = os.getenv("ROBOFLOW_API_KEY", "")
        if not API_KEY:
            yield json.dumps({"type": "error", "message": "ROBOFLOW_API_KEY is required. Get one at https://docs.roboflow.com/api-reference/authentication#retrieve-an-api-key"}) + "\n"
            return

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            yield json.dumps({"type": "error", "message": f"Failed to open video: {video_path}"}) + "\n"
            return
        fps = cap.get(cv2.CAP_PROP_FPS)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        target_samples = _env_int("ROBOFLOW_TARGET_SAMPLES", 450, min_value=50, max_value=10000)
        frame_skip = _effective_frame_skip(requested_frame_skip, total_frames, target_samples)
        frames_to_process = total_frames // frame_skip + (1 if total_frames % frame_skip else 0)
        logger.info(
            f"Ball stream settings: requested_frame_skip={requested_frame_skip}, "
            f"effective_frame_skip={frame_skip}, target_samples={target_samples}, "
            f"frames_to_process={frames_to_process}, total_frames={total_frames}"
        )

        yield json.dumps({
            "type": "meta",
            "totalFrames": frames_to_process,
            "fps": fps,
            "videoFrames": total_frames,
            "settings": {
                "frameSkip": frame_skip,
                "requestedFrameSkip": requested_frame_skip,
                "targetSamples": target_samples,
                "confidenceThreshold": confidence_threshold,
                "maxWorkers": max_workers,
                "inferMaxWidth": infer_max_width,
            }
        }) + "\n"

        all_detections = []
        frame_count = 0
        processed_count = 0
        start_time = time.time()
        submit_time = 0.0
        wait_time = 0.0
        failed_frames = 0
        thread_local = threading.local()

        def _get_session():
            if not hasattr(thread_local, "session"):
                session = requests.Session()
                adapter = requests.adapters.HTTPAdapter(pool_connections=max_workers, pool_maxsize=max_workers)
                session.mount("https://", adapter)
                session.mount("http://", adapter)
                thread_local.session = session
            return thread_local.session

        def _infer_task(frame, sampled_frame_count: int, timestamp: float):
            frame_detections = []
            error_msg = None
            try:
                results = _infer_frame_api(
                    frame,
                    API_KEY,
                    ROBOFLOW_MODEL_ID,
                    confidence=confidence_threshold,
                    session=_get_session(),
                    infer_max_width=infer_max_width,
                )
                for pred in _extract_predictions(results):
                    box = _extract_box(pred, confidence_threshold)
                    if box:
                        frame_detections.append(box)
            except Exception as e:
                error_msg = str(e)

            return {
                "time": round(timestamp, 3),
                "frame": sampled_frame_count,
                "boxes": frame_detections,
            }, error_msg

        max_in_flight = max_workers * 2
        in_flight = set()
        future_meta = {}

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            while True:
                grabbed = cap.grab()
                if not grabbed:
                    break

                if frame_count % frame_skip == 0:
                    ret, frame = cap.retrieve()
                    if not ret:
                        break
                    timestamp = frame_count / fps if fps > 0 else 0
                    submit_start = time.time()
                    future = executor.submit(_infer_task, frame, frame_count, timestamp)
                    submit_time += (time.time() - submit_start) * 1000
                    in_flight.add(future)
                    future_meta[future] = frame_count

                frame_count += 1

                while len(in_flight) >= max_in_flight:
                    wait_start = time.time()
                    done, _ = wait(in_flight, return_when=FIRST_COMPLETED)
                    wait_time += (time.time() - wait_start) * 1000
                    for future in done:
                        in_flight.remove(future)
                        sampled_frame = future_meta.pop(future, None)
                        detection, error_msg = future.result()
                        if error_msg:
                            failed_frames += 1
                            logger.warning(f"Error processing frame {sampled_frame}: {error_msg}")
                        processed_count += 1
                        all_detections.append(detection)
                        yield json.dumps({
                            "type": "detection",
                            "data": detection,
                            "processed": processed_count,
                            "total": frames_to_process
                        }) + "\n"

            while in_flight:
                wait_start = time.time()
                done, _ = wait(in_flight, return_when=FIRST_COMPLETED)
                wait_time += (time.time() - wait_start) * 1000
                for future in done:
                    in_flight.remove(future)
                    sampled_frame = future_meta.pop(future, None)
                    detection, error_msg = future.result()
                    if error_msg:
                        failed_frames += 1
                        logger.warning(f"Error processing frame {sampled_frame}: {error_msg}")
                    processed_count += 1
                    all_detections.append(detection)
                    yield json.dumps({
                        "type": "detection",
                        "data": detection,
                        "processed": processed_count,
                        "total": frames_to_process
                    }) + "\n"

        cap.release()
        elapsed = time.time() - start_time
        timings = {
            "totalMs": round(elapsed * 1000, 2),
            "submitMs": round(submit_time, 2),
            "waitMs": round(wait_time, 2),
            "failedFrames": failed_frames,
            "requestTotalMs": round((time.time() - request_start) * 1000, 2),
        }
        logger.info(
            f"Streaming ball detection complete in {elapsed:.2f}s "
            f"({processed_count} frames, failed={failed_frames}, timings={timings})"
        )
        yield json.dumps({
            "type": "done",
            "processed": processed_count,
            "elapsed": round(elapsed, 2),
            "timings": timings
        }) + "\n"

        # Keep stream completion fast for clients; cache persistence happens in the background.
        _persist_ball_cache_async(cache_path, all_detections)

    return Response(stream_with_context(generate()), content_type='application/x-ndjson')


@app.route('/export', methods=['POST'])
def export_video():
    request_start = time.time()
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
        ffmpeg_start = time.time()
        subprocess.run([
            'ffmpeg', '-i', input_path,
            '-filter_complex', filter_complex,
            '-map', '[outv]', '-map', '[outa]',
            '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
            '-c:a', 'aac', '-b:a', '128k',
            '-movflags', '+faststart',
            output_path, '-y'
        ], capture_output=True, check=True, timeout=600)
        ffmpeg_ms = (time.time() - ffmpeg_start) * 1000
    except subprocess.CalledProcessError as e:
        stderr = e.stderr.decode() if e.stderr else str(e)
        logger.error(f"FFmpeg export failed: {stderr}")
        return jsonify({"error": "Export failed"}), 500
    except subprocess.TimeoutExpired:
        logger.error("FFmpeg export timed out")
        return jsonify({"error": "Export timed out"}), 500

    total_ms = (time.time() - request_start) * 1000
    timings = {
        "ffmpegMs": round(ffmpeg_ms, 2),
        "totalMs": round(total_ms, 2),
        "segments": len(segments),
    }
    logger.info(f"Export complete: {output_path} timings={timings}")
    response = send_file(output_path, mimetype='video/mp4', as_attachment=True, download_name='highlight-export.mp4')
    response.headers["X-Export-Ffmpeg-Ms"] = str(timings["ffmpegMs"])
    response.headers["X-Export-Total-Ms"] = str(timings["totalMs"])
    return response


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
