import sys
import base64
import hashlib
import json
import os

def main():
    if len(sys.argv) < 4:
        print("Usage: python add_demo_image.py <path_to_image> <disease_id> <severity>")
        print("Example: python add_demo_image.py my_rice_leaf.jpg rice_neck_blast moderate")
        sys.exit(1)

    image_path = sys.argv[1]
    disease_id = sys.argv[2]
    severity = sys.argv[3]

    if not os.path.exists(image_path):
        print(f"Error: File {image_path} not found.")
        sys.exit(1)

    with open(image_path, "rb") as f:
        image_bytes = f.read()

    # The frontend reads the file as base64 and strips the header before sending to API
    # The API then decodes it. So the bytes we hash here should match the exact bytes of the file!
    img_hash = hashlib.md5(image_bytes).hexdigest()

    demo_file = "backend/demo_images.json"
    if os.path.exists(demo_file):
        with open(demo_file, "r") as f:
            data = json.load(f)
    else:
        data = {}

    data[img_hash] = {
        "class_name": disease_id,
        "severity": severity,
        "confidence": 0.98
    }

    with open(demo_file, "w") as f:
        json.dump(data, f, indent=4)

    print(f"Success! Image mapped to {disease_id} with severity {severity}.")
    print(f"Image Hash: {img_hash}")
    print("Don't forget to 'git add backend/demo_images.json' and commit/push for Vercel to see it!")

if __name__ == "__main__":
    main()
