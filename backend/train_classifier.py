"""
train_classifier.py
CrowdShield Phase 2 — ML Risk Classifier Trainer

Reads training_data.csv produced by generate_training_data.py,
trains a GradientBoostingClassifier, evaluates it, and saves
the fitted model + scaler to disk.

Usage:
    python backend/train_classifier.py

Outputs:
    backend/risk_model.pkl
    backend/model_scaler.pkl
"""

import os
import sys
import pickle

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split, StratifiedKFold, cross_val_score
from sklearn.metrics import (
    classification_report,
    confusion_matrix,
    accuracy_score
)

# ── Paths ────────────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(__file__)
DATA_PATH  = os.path.join(BASE_DIR, "training_data.csv")
MODEL_PATH = os.path.join(BASE_DIR, "risk_model.pkl")
SCALER_PATH = os.path.join(BASE_DIR, "model_scaler.pkl")

FEATURE_COLS = [
    "density", "avg_speed",
    "d_density", "d_speed",
    "neighbor_density", "neighbor_speed",
    "flow_variance",
]
LABEL_COL = "label"
LABEL_NAMES = {0: "safe", 1: "warning", 2: "crush"}


def load_data() -> tuple:
    if not os.path.exists(DATA_PATH):
        print(f"ERROR: Training data not found at {DATA_PATH}")
        print("Run  python backend/generate_training_data.py  first.")
        sys.exit(1)

    df = pd.read_csv(DATA_PATH)
    print(f"Loaded {len(df):,} samples from {DATA_PATH}")

    # Class distribution
    counts = df[LABEL_COL].value_counts().sort_index()
    print("\nClass distribution:")
    for label_id, count in counts.items():
        pct = count / len(df) * 100
        print(f"  {LABEL_NAMES[label_id]:>7} (class {label_id}): {count:>6} samples  ({pct:.1f}%)")

    X = df[FEATURE_COLS].values
    y = df[LABEL_COL].values
    return X, y


def train(X: np.ndarray, y: np.ndarray):
    # ── Scale features ───────────────────────────────────────────────────────
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    # ── Train / test split ───────────────────────────────────────────────────
    X_train, X_test, y_train, y_test = train_test_split(
        X_scaled, y, test_size=0.20, random_state=42, stratify=y
    )
    print(f"\nTrain set: {len(X_train):,} samples | Test set: {len(X_test):,} samples")

    # ── Model ────────────────────────────────────────────────────────────────
    model = GradientBoostingClassifier(
        n_estimators=200,
        learning_rate=0.08,
        max_depth=4,
        subsample=0.85,
        min_samples_leaf=5,
        random_state=42,
        verbose=0,
    )

    print("\nTraining GradientBoostingClassifier ...")
    model.fit(X_train, y_train)

    # ── Evaluation ───────────────────────────────────────────────────────────
    y_pred = model.predict(X_test)
    acc = accuracy_score(y_test, y_pred)

    print(f"\n{'='*60}")
    print(f"Test Accuracy: {acc * 100:.2f}%")
    print(f"{'='*60}")
    print("\nClassification Report:")
    print(classification_report(y_test, y_pred,
                                 target_names=[LABEL_NAMES[i] for i in sorted(LABEL_NAMES)]))

    print("Confusion Matrix (rows=actual, cols=predicted):")
    cm = confusion_matrix(y_test, y_pred)
    header = "         " + "  ".join(f"{LABEL_NAMES[i]:>7}" for i in sorted(LABEL_NAMES))
    print(header)
    for i, row in enumerate(cm):
        row_str = "  ".join(f"{v:>7}" for v in row)
        print(f"  {LABEL_NAMES[i]:>7}  {row_str}")

    # ── Cross-validation ─────────────────────────────────────────────────────
    print("\nRunning 5-fold stratified cross-validation ...")
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    cv_scores = cross_val_score(model, X_scaled, y, cv=cv, scoring="accuracy")
    print(f"CV Accuracy: {cv_scores.mean() * 100:.2f}% ± {cv_scores.std() * 100:.2f}%")

    # ── Feature importance ───────────────────────────────────────────────────
    print("\nFeature importances:")
    importances = model.feature_importances_
    for name, imp in sorted(zip(FEATURE_COLS, importances), key=lambda x: -x[1]):
        bar = "#" * int(imp * 50)
        print(f"  {name:<20} {imp:.4f}  {bar}")

    return model, scaler


def save(model, scaler):
    with open(MODEL_PATH, "wb") as f:
        pickle.dump(model, f)
    with open(SCALER_PATH, "wb") as f:
        pickle.dump(scaler, f)
    print(f"\nModel saved  -> {MODEL_PATH}")
    print(f"Scaler saved -> {SCALER_PATH}")


if __name__ == "__main__":
    print("=" * 60)
    print("CrowdShield — Phase 2 Classifier Trainer")
    print("=" * 60)

    X, y = load_data()
    model, scaler = train(X, y)
    save(model, scaler)

    print("\nDone! Restart the backend server to load the new model.")
