# CrowdShield — System Architecture

The following Mermaid diagrams illustrate the real-time data ingestion, spatial aggregation, machine learning prediction, and recommendation dispatch pipeline.

---

## 1. System Components & Ingestion Pipeline

```mermaid
graph TD
    subgraph Simulation
        A[Venue Crowd Simulator - Mesa] -- "Synthetic Telemetry (lat, lon, speed, heading)" --> B[FastAPI Backend /ws]
    end

    subgraph Preprocessing
        B -- "Ingest coordinates" --> C[H3 Hashing Library]
        C -- "Spatial Binning (Res 14)" --> D[Feature Extractor]
        D -- "7-Feature Vector: d_density, d_speed, flow_variance, neighbor metrics" --> E[ML Risk Classifier]
    end

    subgraph Risk Assessment & Recommendations
        E -- "Predict Probability (crush/warn/safe)" --> F[Dual-Gate Fusion Logic]
        F -- "Amber / Red Risk status" --> G[Recommendation Engine]
        G -- "Decision Table & Streaks" --> H[Active Action triggers]
    end

    subgraph Outputs
        F -- "WebSocket Broadcast payload" --> I[React Operator Dashboard]
        F -- "WebSocket Broadcast payload" --> J[Citizen Mobile PWA]
        H -- "Open Gates / Deploy Monitors" --> I
        K[Gemini 2.0 API] -- "incident-summary" --> I
    end
```

---

## 2. Ingestion & Event Sequence

```mermaid
sequenceDiagram
    autonumber
    participant Simulator as Mesa Simulation Loop
    participant Backend as FastAPI Server
    participant Classifier as scikit-learn GradientBoosting
    participant Dashboard as React Dashboard
    participant PWA as Citizen PWA

    loop Every 1.0 Second
        Simulator->>Backend: Telemetry step (x, y, speed, heading)
        Backend->>Backend: Bin peds into H3 hexagons
        Backend->>Backend: Calculate flow convergence & deltas
        Backend->>Classifier: Extract 7-feature vector
        Classifier-->>Backend: Probabilities & Confidence (%)
        Backend->>Backend: Evaluate streaks & recommendations
        Backend-->>Dashboard: Stream JSON payload (WS)
        Backend-->>PWA: Stream JSON payload (WS)
    end

    opt Operator Places Asset
        Dashboard->>Backend: POST /update-simulation-assets
        Backend->>Simulator: Update obstacles/exits bounds
        Simulator->>Simulator: Recalculate A* routing paths
    end

    opt Citizen Submits Report
        PWA->>Backend: POST /report-incident
        Backend-->>Dashboard: Refresh incident list
    end
```
