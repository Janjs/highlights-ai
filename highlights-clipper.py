# pip install scenedetect

from scenedetect import VideoManager, SceneManager
from scenedetect.detectors import ContentDetector
import json
import time
import os

video_path = os.getenv("VIDEO_PATH", "input_original.mp4")

script_start = time.time()
print("=" * 60)
print("Starting scene detection...")
print("=" * 60)

# 1️⃣ Detect scenes
detection_start = time.time()
video_manager = VideoManager([video_path])
scene_manager = SceneManager()
scene_manager.add_detector(ContentDetector(threshold=70.0, min_scene_len=15))

# Timer for downscaling
downscale_start = time.time()
video_manager.set_downscale_factor(4)
downscale_time = time.time() - downscale_start
print(f"⏱️ Downscaling set in {downscale_time:.3f}s")

video_manager.start()
scene_manager.detect_scenes(frame_source=video_manager)

scene_list = scene_manager.get_scene_list()
detection_time = time.time() - detection_start
print(f"✅ Detected {len(scene_list)} scenes in {detection_time:.2f}s")

# 2️⃣ Collect scene timing data (skip clip extraction)
print("\n📋 Collecting scene timing data...")
data_start = time.time()

scenes_data = []

for i, (start, end) in enumerate(scene_list):
    start_time = start.get_seconds()
    end_time = end.get_seconds()
    
    scenes_data.append({
        "start": start_time,
        "end": end_time,
    })
    print(f"   Scene {i+1}: {start_time:.2f}s - {end_time:.2f}s")

data_time = time.time() - data_start
print(f"✅ Collected timing for {len(scene_list)} scenes in {data_time:.3f}s")

# 3️⃣ Export scene data
json_start = time.time()
with open("scenes.json", "w") as f:
    json.dump(scenes_data, f, indent=2)
json_time = time.time() - json_start

print(f"\n✅ Scene data exported to scenes.json in {json_time:.3f}s")

total_time = time.time() - script_start
print("=" * 60)
print(f"🎉 Total processing time: {total_time:.2f}s")
print(f"   ├─ Downscaling: {downscale_time:.3f}s")
print(f"   ├─ Detection: {detection_time:.2f}s ({detection_time/total_time*100:.1f}%)")
print(f"   ├─ Data collection: {data_time:.3f}s")
print(f"   └─ JSON export: {json_time:.3f}s")
print("=" * 60)
