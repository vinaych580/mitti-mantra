"""
ml/training/train_disease_tfjs.py
Keras MobileNetV2 training script on PlantVillage dataset with automatic TF.js export.

To run:
  pip install tensorflow tensorflowjs requests tqdm
  python ml/training/train_disease_tfjs.py
"""
import os
import json
import zipfile
import shutil
from pathlib import Path
import numpy as np
import requests
from tqdm import tqdm

# We will dynamically import tensorflow to avoid errors if not installed
tf = None

DISEASE_CLASSES = [
  "maize_common_rust", "maize_gray_leaf_spot", "maize_northern_leaf_blight", "maize_healthy",
  "potato_early_blight", "potato_late_blight", "potato_healthy",
  "soybean_healthy",
  "tomato_bacterial_spot", "tomato_early_blight", "tomato_late_blight", "tomato_leaf_mold",
  "tomato_septoria_leaf_spot", "tomato_spider_mites", "tomato_target_spot",
  "tomato_yellow_leaf_curl_virus", "tomato_mosaic_virus", "tomato_healthy"
]

DATASET_URL = "https://storage.googleapis.com/sml-dataset/plantvillage-18-classes.zip"
PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATASET_DIR = PROJECT_ROOT / "dataset" / "plantvillage"
EXPORT_DIR = PROJECT_ROOT / "frontend" / "models" / "disease"

def download_dataset():
  """Download and extract a curated subset of the PlantVillage dataset."""
  if DATASET_DIR.exists():
    print(f"Dataset already exists at {DATASET_DIR}")
    return

  print("Downloading PlantVillage dataset subset...")
  DATASET_DIR.parent.mkdir(parents=True, exist_ok=True)
  zip_path = DATASET_DIR.parent / "plantvillage.zip"

  response = requests.get(DATASET_URL, stream=True)
  total_size = int(response.headers.get('content-length', 0))
  
  with open(zip_path, 'wb') as file, tqdm(
      desc="Downloading",
      total=total_size,
      unit='B',
      unit_scale=True,
      unit_divisor=1024,
  ) as bar:
    for data in response.iter_content(chunk_size=1024):
      size = file.write(data)
      bar.update(size)

  print("Extracting dataset...")
  with zipfile.ZipFile(zip_path, 'r') as zip_ref:
    zip_ref.extractall(DATASET_DIR.parent)

  # Clean up zip file
  if zip_path.exists():
    os.remove(zip_path)
  print("Dataset ready!")

def setup_tensorflow():
  global tf
  try:
    import tensorflow as tf_lib
    tf = tf_lib
    print(f"TensorFlow {tf.__version__} loaded successfully.")
    return True
  except ImportError:
    print("\n[ERROR] TensorFlow is not installed.")
    print("Please run: pip install tensorflow tensorflowjs requests tqdm")
    return False

def train_and_export():
  if not setup_tensorflow():
    return

  download_dataset()

  # Create directories
  EXPORT_DIR.mkdir(parents=True, exist_ok=True)

  # Check if we can load dataset
  if not DATASET_DIR.exists():
    print(f"Error: Dataset path {DATASET_DIR} does not exist.")
    return

  print("Loading datasets with tf.keras.utils.image_dataset_from_directory...")
  
  # Image inputs must match 224x224 for MobileNetV2
  IMG_SIZE = (224, 224)
  BATCH_SIZE = 32

  # Check subclasses directories
  # If directory structure is flat or customized, we adapt. Otherwise we assume standard ImageFolder structure.
  train_ds = tf.keras.utils.image_dataset_from_directory(
    DATASET_DIR,
    validation_split=0.2,
    subset="training",
    seed=123,
    image_size=IMG_SIZE,
    batch_size=BATCH_SIZE,
    label_mode='categorical'
  )

  val_ds = tf.keras.utils.image_dataset_from_directory(
    DATASET_DIR,
    validation_split=0.2,
    subset="validation",
    seed=123,
    image_size=IMG_SIZE,
    batch_size=BATCH_SIZE,
    label_mode='categorical'
  )

  # Ensure classes match
  class_names = train_ds.class_names
  print(f"Detected classes in dataset: {class_names}")

  # Configure datasets for performance
  AUTOTUNE = tf.data.AUTOTUNE
  train_ds = train_ds.prefetch(buffer_size=AUTOTUNE)
  val_ds = val_ds.prefetch(buffer_size=AUTOTUNE)

  # Augmentation Layers
  data_augmentation = tf.keras.Sequential([
    tf.keras.layers.RandomFlip("horizontal_and_vertical"),
    tf.keras.layers.RandomRotation(0.15),
    tf.keras.layers.RandomZoom(0.1),
  ])

  # Base Model - Pretrained MobileNetV2
  base_model = tf.keras.applications.MobileNetV2(
    input_shape=(224, 224, 3),
    include_top=False,
    weights='imagenet'
  )
  base_model.trainable = False  # Freeze backbone initially

  # Classification Head
  inputs = tf.keras.Input(shape=(224, 224, 3))
  x = data_augmentation(inputs)
  # Preprocess inputs for MobileNetV2 (scales pixels between -1 and 1)
  x = tf.keras.applications.mobilenet_v2.preprocess_input(x)
  x = base_model(x, training=False)
  x = tf.keras.layers.GlobalAveragePooling2D()(x)
  x = tf.keras.layers.Dropout(0.2)(x)
  outputs = tf.keras.layers.Dense(len(DISEASE_CLASSES), activation='softmax')(x)
  
  model = tf.keras.Model(inputs, outputs)

  print("Compiling model...")
  model.compile(
    optimizer=tf.keras.optimizers.Adam(learning_rate=0.0005),
    loss='categorical_crossentropy',
    metrics=['accuracy']
  )

  model.summary()

  print("Training classifier head (Epoch 1)...")
  model.fit(
    train_ds,
    epochs=3,
    validation_data=val_ds
  )

  # Unfreeze last few layers of MobileNetV2 for fine tuning
  print("Fine-tuning base model...")
  base_model.trainable = True
  # Freeze all layers prior to the last 20 layers
  for layer in base_model.layers[:-20]:
    layer.trainable = False

  model.compile(
    optimizer=tf.keras.optimizers.Adam(learning_rate=0.00005),
    loss='categorical_crossentropy',
    metrics=['accuracy']
  )

  model.fit(
    train_ds,
    epochs=3,
    validation_data=val_ds
  )

  # Save local Keras model
  keras_model_path = PROJECT_ROOT / "ml" / "models" / "disease" / "mobilenet_disease.h5"
  keras_model_path.parent.mkdir(parents=True, exist_ok=True)
  model.save(keras_model_path)
  print(f"Saved Keras model to {keras_model_path}")

  # Convert to TensorFlow.js LayersModel
  print("Exporting model to TensorFlow.js LayersModel format...")
  try:
    import tensorflowjs as tfjs
    # Run the export with quantization
    tfjs.converters.save_keras_model(
      model,
      str(EXPORT_DIR),
      quantization_dtype_map={"uint8": "*"}  # Full uint8 quantization to compress weights
    )
    print(f"Successfully converted and exported quantized TF.js model files to {EXPORT_DIR}")
  except ImportError:
    print("\n[WARNING] tensorflowjs package not installed. Could not convert Keras model to TF.js format.")
    print("Please install it: pip install tensorflowjs")
    print("You can run the command line tool manually later:")
    print(f"tensorflowjs_converter --input_format=keras --quantization_bytes=1 {keras_model_path} {EXPORT_DIR}")

if __name__ == "__main__":
  train_and_export()
