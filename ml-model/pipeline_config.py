"""
Configuration for the feedback-enhanced training pipeline.
Edit these values before running train_with_feedback.py
"""
import os

# ─── Supabase ───
SUPABASE_URL = "https://peztcwpkuiysezzlazmv.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBlenRjd3BrdWl5c2V6emxhem12Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgxOTYyMDMsImV4cCI6MjA3Mzc3MjIwM30.UxonFYbew0ysvtuC8FhM7HyhNhzS4EGu2huum9JLbL4"
FEEDBACK_BUCKET = "waste-feedback-images"
FEEDBACK_TABLE = "waste_classification_feedback"

# ─── Paths ───
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ORIGINAL_DATASET_DIR = os.path.join(BASE_DIR, "ml-model", "dataset", "TrashType_Image_Dataset")
FEEDBACK_DOWNLOAD_DIR = os.path.join(BASE_DIR, "feedback_images")
MERGED_DATASET_DIR = os.path.join(BASE_DIR, "merged_dataset")
OUTPUT_DIR = os.path.join(BASE_DIR, "output")

# ─── Classes (alphabetical — must match TF dataset_from_directory order) ───
CLASS_NAMES = ["cardboard", "glass", "metal", "paper", "plastic", "trash"]

# ─── Data mixing & Weighting ───
FEEDBACK_MIX_RATIO = 0.30        # Batch başına %30 feedback, %70 orijinal veri
BASE_FEEDBACK_WEIGHT = 5.0       # Feedback resimlerinin başlangıç ağırlığı
MIN_FEEDBACK_WEIGHT = 3.0        # Feedback resimlerinin sönümlenme taban değeri
WEIGHT_CLIP_MAX = 6.0            # Final ağırlık tavan değeri (gradient explosion'u önlemek için)

# ─── Training ───
IMG_HEIGHT = 224
IMG_WIDTH = 224
BATCH_SIZE = 32
EPOCHS = 30
LEARNING_RATE = 0.0005
EARLY_STOP_PATIENCE = 5
FINE_TUNE_LAYERS = 20            # unfreeze last N layers of MobileNetV2 for fine-tuning
FINE_TUNE_LR = 1e-5
FINE_TUNE_EPOCHS = 10

# ─── Quality gate ───
MIN_MACRO_F1 = 0.70
MIN_CLASS_RECALL = 0.50          # per-class minimum recall
MIN_CLASS_PRECISION = 0.50       # per-class minimum precision

# ─── Versioning ───
CURRENT_MODEL_VERSION = "v0.0.1-tflite-fp32"
