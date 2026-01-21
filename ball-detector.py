# Basketball Detection using Roboflow Inference SDK
# Uses custom trained model via get_model()

from inference import get_model
import cv2
import json
import time
import os

video_path = os.getenv("VIDEO_PATH", "input.mp4")
output_path = os.getenv("BALL_DETECTIONS_PATH", "ball_detections.json")

# Process every Nth frame for performance
FRAME_SKIP = int(os.getenv("FRAME_SKIP", "5"))

# Roboflow configuration
API_KEY = "R1yMzldFzNutZoifGLkz"
MODEL_ID = "made-baskets-gswke/1"

# Set API key in environment
os.environ["ROBOFLOW_API_KEY"] = API_KEY

# Confidence threshold
CONFIDENCE_THRESHOLD = 0.3

script_start = time.time()
print("=" * 60)
print("Starting basketball detection with Roboflow...")
print(f"Model: {MODEL_ID}")
print(f"Video: {video_path}")
print(f"Frame skip: {FRAME_SKIP} (processing every {FRAME_SKIP}th frame)")
print("=" * 60)

# Load model
model_start = time.time()
print("Loading Roboflow model...")
model = get_model(model_id=MODEL_ID)
model_time = time.time() - model_start
print(f"✅ Model loaded in {model_time:.2f}s")

# Open video
cap = cv2.VideoCapture(video_path)
if not cap.isOpened():
    print(f"❌ Error: Could not open video {video_path}")
    exit(1)

fps = cap.get(cv2.CAP_PROP_FPS)
total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
duration = total_frames / fps if fps > 0 else 0
frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
print(f"Video info: {total_frames} frames, {fps:.1f} fps, {duration:.1f}s, {frame_width}x{frame_height}")

# Process frames
detection_start = time.time()
detections = []
frame_count = 0
processed_count = 0

while True:
    ret, frame = cap.read()
    if not ret:
        break
    
    # Only process every Nth frame
    if frame_count % FRAME_SKIP == 0:
        timestamp = frame_count / fps if fps > 0 else 0
        
        frame_detections = []
        
        try:
            # Run inference - returns list of results
            results = model.infer(frame)
            
            # Handle different response formats
            predictions = []
            if isinstance(results, list) and len(results) > 0:
                result = results[0]
                # Check if it's a dict with predictions key
                if isinstance(result, dict):
                    predictions = result.get("predictions", [])
                # Check if it has a predictions attribute
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
                    cls = pred.get("class", "Basketball")
                else:
                    conf = getattr(pred, 'confidence', 0)
                    cx = getattr(pred, 'x', 0)
                    cy = getattr(pred, 'y', 0)
                    w = getattr(pred, 'width', 0)
                    h = getattr(pred, 'height', 0)
                    cls = getattr(pred, 'class', 'Basketball')
                
                if conf >= CONFIDENCE_THRESHOLD:
                    frame_detections.append({
                        "x": round(cx - w/2),
                        "y": round(cy - h/2),
                        "w": round(w),
                        "h": round(h),
                        "confidence": round(conf, 3),
                        "class": cls
                    })
                    print(f"   Frame {frame_count} ({timestamp:.2f}s): {cls} at ({cx:.0f}, {cy:.0f}) conf={conf:.2f}")
        
        except Exception as e:
            print(f"   Warning: Error processing frame {frame_count}: {e}")
        
        detections.append({
            "time": round(timestamp, 3),
            "frame": frame_count,
            "boxes": frame_detections
        })
        
        processed_count += 1
        
        # Progress update every 100 processed frames
        if processed_count % 100 == 0:
            progress = (frame_count / total_frames) * 100 if total_frames > 0 else 0
            balls_found = sum(len(d["boxes"]) for d in detections)
            elapsed = time.time() - detection_start
            print(f"   Progress: {progress:.1f}% ({processed_count} frames, {balls_found} balls, {elapsed:.1f}s)")
    
    frame_count += 1

cap.release()

detection_time = time.time() - detection_start
print(f"✅ Processed {processed_count} frames in {detection_time:.2f}s")

# Count frames with detections
frames_with_balls = sum(1 for d in detections if len(d["boxes"]) > 0)
total_balls = sum(len(d["boxes"]) for d in detections)
print(f"   Found balls in {frames_with_balls}/{processed_count} frames ({total_balls} total detections)")

# Save detections
json_start = time.time()
with open(output_path, "w") as f:
    json.dump(detections, f)
json_time = time.time() - json_start

print(f"✅ Detections saved to {output_path} in {json_time:.3f}s")

total_time = time.time() - script_start
print("=" * 60)
print(f"🎉 Total processing time: {total_time:.2f}s")
print(f"   ├─ Model loading: {model_time:.2f}s")
print(f"   ├─ Detection: {detection_time:.2f}s")
print(f"   └─ JSON export: {json_time:.3f}s")
print("=" * 60)
