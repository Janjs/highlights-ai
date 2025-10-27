# pip install scenedetect opencv-python

from scenedetect import VideoManager, SceneManager
from scenedetect.detectors import ContentDetector
import cv2
import os
import shutil
import json

video_path = "input.mp4"
output_dir = "clips"
if os.path.exists(output_dir):
    shutil.rmtree(output_dir)
os.makedirs(output_dir, exist_ok=True)

# 1️⃣ Detect scenes
video_manager = VideoManager([video_path])
scene_manager = SceneManager()
scene_manager.add_detector(ContentDetector(threshold=70.0, min_scene_len=15))

video_manager.set_downscale_factor(4)
video_manager.start()
scene_manager.detect_scenes(frame_source=video_manager)

scene_list = scene_manager.get_scene_list()
print(f"Detected {len(scene_list)} scenes!")

# 2️⃣ Extract scenes as clips
cap = cv2.VideoCapture(video_path)
fps = cap.get(cv2.CAP_PROP_FPS)

scenes_data = []

for i, (start, end) in enumerate(scene_list):
    start_frame, end_frame = start.get_frames(), end.get_frames()
    start_time = start.get_seconds()
    end_time = end.get_seconds()
    
    scenes_data.append({
        "start": start_time,
        "end": end_time,
        "start_frame": start_frame,
        "end_frame": end_frame
    })
    
    cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)

    out = cv2.VideoWriter(
        f"{output_dir}/scene_{i+1}.mp4",
        cv2.VideoWriter_fourcc(*"mp4v"),
        fps,
        (int(cap.get(3)), int(cap.get(4)))
    )

    for f in range(start_frame, end_frame):
        ret, frame = cap.read()
        if not ret:
            break
        out.write(frame)
    out.release()

cap.release()

with open("scenes.json", "w") as f:
    json.dump(scenes_data, f, indent=2)

print("✅ Scenes saved in", output_dir)
print(f"✅ Scene data exported to scenes.json")
