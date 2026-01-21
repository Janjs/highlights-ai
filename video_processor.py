# Flask API for Video Processing
# Provides scene detection and ball detection endpoints with logging

import os
import json
import time
import logging
from logging.handlers import RotatingFileHandler
from flask import Flask, request, jsonify
import cv2

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('video-processor')
logger.setLevel(logging.DEBUG)

# Console handler with formatting
console_handler = logging.StreamHandler()
console_handler.setLevel(logging.DEBUG)
console_format = logging.Formatter(
    '%(asctime)s | %(levelname)-8s | %(message)s',
    datefmt='%H:%M:%S'
)
console_handler.setFormatter(console_format)
logger.addHandler(console_handler)

# File handler for persistent logs
os.makedirs('.cache', exist_ok=True)
file_handler = RotatingFileHandler(
    '.cache/video-processor.log',
    maxBytes=5*1024*1024,  # 5MB
    backupCount=3
)
file_handler.setLevel(logging.DEBUG)
file_format = logging.Formatter(
    '%(asctime)s | %(levelname)-8s | %(funcName)s | %(message)s'
)
file_handler.setFormatter(file_format)
logger.addHandler(file_handler)

app = Flask(__name__)

# ============================================================
# Scene Detection
# ============================================================

def detect_scenes(video_path: str, threshold: float = 70.0, min_scene_len: int = 15) -> list:
    """Detect scenes in a video using PySceneDetect"""
    from scenedetect import VideoManager, SceneManager
    from scenedetect.detectors import ContentDetector
    
    logger.info(f"🎬 Starting scene detection for: {video_path}")
    logger.debug(f"   Threshold: {threshold}, Min scene length: {min_scene_len}")
    
    start_time = time.time()
    
    video_manager = VideoManager([video_path])
    scene_manager = SceneManager()
    scene_manager.add_detector(ContentDetector(threshold=threshold, min_scene_len=min_scene_len))
    
    logger.debug("   Setting downscale factor to 4...")
    video_manager.set_downscale_factor(4)
    
    logger.info("   Processing video frames...")
    video_manager.start()
    scene_manager.detect_scenes(frame_source=video_manager)
    
    scene_list = scene_manager.get_scene_list()
    detection_time = time.time() - start_time
    
    logger.info(f"✅ Detected {len(scene_list)} scenes in {detection_time:.2f}s")
    
    scenes = []
    for i, (start, end) in enumerate(scene_list):
        start_time_sec = start.get_seconds()
        end_time_sec = end.get_seconds()
        scenes.append({
            "start": start_time_sec,
            "end": end_time_sec,
        })
        logger.debug(f"   Scene {i+1}: {start_time_sec:.2f}s - {end_time_sec:.2f}s")
    
    return scenes

# ============================================================
# Ball Detection with Roboflow
# ============================================================

def detect_balls(video_path: str, frame_skip: int = 5, confidence_threshold: float = 0.3) -> list:
    """Detect basketballs in video using Roboflow get_model()"""
    from inference import get_model
    
    API_KEY = "R1yMzldFzNutZoifGLkz"
    MODEL_ID = "made-baskets-gswke/1"
    
    # Set API key in environment
    os.environ["ROBOFLOW_API_KEY"] = API_KEY
    
    logger.info(f"🏀 Starting ball detection for: {video_path}")
    logger.debug(f"   Model: {MODEL_ID}")
    logger.debug(f"   Frame skip: {frame_skip}, Confidence threshold: {confidence_threshold}")
    
    # Load model
    model_start = time.time()
    logger.info("   Loading Roboflow model...")
    model = get_model(model_id=MODEL_ID)
    model_time = time.time() - model_start
    logger.info(f"   Model loaded in {model_time:.2f}s")
    
    # Get video info
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total_frames / fps if fps > 0 else 0
    frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    
    logger.info(f"   Video: {total_frames} frames, {fps:.1f} fps, {duration:.1f}s, {frame_width}x{frame_height}")
    
    # Process frames
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
                # Run inference - returns list of results
                results = model.infer(frame)
                
                # Handle different response formats
                predictions = []
                if isinstance(results, list) and len(results) > 0:
                    result = results[0]
                    if isinstance(result, dict):
                        predictions = result.get("predictions", [])
                    elif hasattr(result, 'predictions'):
                        predictions = result.predictions
                elif isinstance(results, dict):
                    predictions = results.get("predictions", [])
                
                for pred in predictions:
                    # Handle both dict and object formats
                    if isinstance(pred, dict):
                        conf = pred.get("confidence", 0)
                        cx = pred.get("x", 0)
                        cy = pred.get("y", 0)
                        w = pred.get("width", 0)
                        h = pred.get("height", 0)
                    else:
                        conf = getattr(pred, 'confidence', 0)
                        cx = getattr(pred, 'x', 0)
                        cy = getattr(pred, 'y', 0)
                        w = getattr(pred, 'width', 0)
                        h = getattr(pred, 'height', 0)
                    
                    if conf >= confidence_threshold:
                        frame_detections.append({
                            "x": round(cx - w/2),
                            "y": round(cy - h/2),
                            "w": round(w),
                            "h": round(h),
                            "confidence": round(conf, 3)
                        })
                        logger.debug(f"   Frame {frame_count} ({timestamp:.2f}s): Ball at ({cx:.0f}, {cy:.0f}) conf={conf:.2f}")
            
            except Exception as e:
                logger.warning(f"   Error processing frame {frame_count}: {e}")
            
            detections.append({
                "time": round(timestamp, 3),
                "frame": frame_count,
                "boxes": frame_detections
            })
            
            processed_count += 1
            
            if processed_count % 100 == 0:
                progress = (frame_count / total_frames) * 100 if total_frames > 0 else 0
                balls_found = sum(len(d["boxes"]) for d in detections)
                elapsed = time.time() - start_time
                logger.info(f"   Progress: {progress:.1f}% ({processed_count} frames, {balls_found} balls, {elapsed:.1f}s)")
        
        frame_count += 1
    
    cap.release()
    
    detection_time = time.time() - start_time
    frames_with_balls = sum(1 for d in detections if len(d["boxes"]) > 0)
    total_balls = sum(len(d["boxes"]) for d in detections)
    
    logger.info(f"✅ Ball detection complete in {detection_time:.2f}s")
    logger.info(f"   Processed {processed_count} frames, found {total_balls} balls in {frames_with_balls} frames")
    
    return detections

# ============================================================
# Flask Routes
# ============================================================

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    logger.debug("Health check requested")
    return jsonify({"status": "ok", "service": "video-processor"})

@app.route('/process', methods=['POST'])
def process_video():
    """Process a video: detect scenes and balls"""
    data = request.get_json()
    video_path = data.get('video_path')
    
    if not video_path:
        logger.error("No video_path provided")
        return jsonify({"error": "video_path is required"}), 400
    
    if not os.path.exists(video_path):
        logger.error(f"Video not found: {video_path}")
        return jsonify({"error": f"Video not found: {video_path}"}), 404
    
    logger.info("=" * 60)
    logger.info(f"📹 Processing video: {video_path}")
    logger.info("=" * 60)
    
    total_start = time.time()
    
    try:
        # Scene detection
        scene_start = time.time()
        scenes = detect_scenes(video_path)
        scene_time = time.time() - scene_start
        
        # Ball detection
        ball_start = time.time()
        frame_skip = data.get('frame_skip', 5)
        ball_detections = detect_balls(video_path, frame_skip=frame_skip)
        ball_time = time.time() - ball_start
        
        total_time = time.time() - total_start
        
        logger.info("=" * 60)
        logger.info(f"🎉 Processing complete in {total_time:.2f}s")
        logger.info(f"   Scene detection: {scene_time:.2f}s")
        logger.info(f"   Ball detection: {ball_time:.2f}s")
        logger.info("=" * 60)
        
        return jsonify({
            "scenes": scenes,
            "ballDetections": ball_detections,
            "timing": {
                "total": round(total_time, 2),
                "sceneDetection": round(scene_time, 2),
                "ballDetection": round(ball_time, 2)
            }
        })
        
    except Exception as e:
        logger.exception(f"Error processing video: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/scenes', methods=['POST'])
def scenes_only():
    """Detect only scenes"""
    data = request.get_json()
    video_path = data.get('video_path')
    
    if not video_path or not os.path.exists(video_path):
        return jsonify({"error": "Invalid video_path"}), 400
    
    logger.info(f"Scene detection requested for: {video_path}")
    
    try:
        scenes = detect_scenes(video_path)
        return jsonify({"scenes": scenes})
    except Exception as e:
        logger.exception(f"Error in scene detection: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/balls', methods=['POST'])
def balls_only():
    """Detect only balls"""
    data = request.get_json()
    video_path = data.get('video_path')
    frame_skip = data.get('frame_skip', 5)
    
    if not video_path or not os.path.exists(video_path):
        return jsonify({"error": "Invalid video_path"}), 400
    
    logger.info(f"Ball detection requested for: {video_path}")
    
    try:
        detections = detect_balls(video_path, frame_skip=frame_skip)
        return jsonify({"ballDetections": detections})
    except Exception as e:
        logger.exception(f"Error in ball detection: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    port = int(os.getenv('FLASK_PORT', 5001))
    logger.info(f"🚀 Starting Video Processor API on port {port}")
    app.run(host='0.0.0.0', port=port, debug=True)
