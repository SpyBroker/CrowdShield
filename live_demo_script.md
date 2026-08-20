# CrowdShield — Live Demo Script

This document details the step-by-step presentation script and actions to perform during the live demo of CrowdShield to the judges.

---

## 🎬 Act I: The Set Up (0:00 - 1:00)

1. **Open the Operator Dashboard** (`http://localhost:8000`)
   - **Speaker**: *"Welcome to CrowdShield, an AI-powered early warning command system for crowd stampedes. What you see is our digital twin command center of a simulated venue. Pedestrian agents are entering the gates at normal speeds and flowing safely to the main exit."*
2. **Toggle 3D View ON**
   - Click the "3D View" switch in the top map toolbar. The map tilts into perspective.
   - **Speaker**: *"As operators, we can switch to 3D perspective to map out elevation changes, spatial bottlenecks, and crowd lines in real-time."*
3. **Show Data Privacy Card**
   - Point to the privacy note at the bottom of the sidebar.
   - **Speaker**: *"Crucially, CrowdShield solves Telecom/GPS privacy issues: all telemetry is immediately binned into anonymous spatial Uber H3 hexagon hashes, guaranteeing zero tracking of individual coordinates."*

---

## 🎬 Act II: The Crisis (1:00 - 2:00)

1. **Trigger the Demo Drill**
   - Click **"Start Demo Drill"** in the control toolbar.
2. **Observe Surge Spawning** (T+10s)
   - Crowd counts rise quickly as spawn indicators speed up. Amber risk hexagons emerge near entrances.
   - **Speaker**: *"A sudden rush of visitors enters the gates. The heatmaps and graphs instantly adapt, highlighting warning zones in amber."*
3. **Observe Obstacle Bottleneck & Alarms** (T+20s)
   - Red risk grids pop up in the center corridor. The Siren screams (if audio ON) and the Voice announcer speaks: *"Attention: CRITICAL CONGESTION: Bottleneck detected in cell..."*
   - **Speaker**: *"Now, a bottleneck forms. The Rule Engine combined with our Phase 2 GradientBoosting ML Classifier detects the threat, firing a Critical Red warning. Hear the alert siren and automatic voice announcements warning the team."*
4. **Demonstrate AI Recommendations** (T+30s)
   - Points to the **AI Recommendations Panel** in the sidebar. Active cards describe specific chokepoints and actions.
   - **Speaker**: *"Rather than raw numbers, CrowdShield gives actionable explainability. The recommendation engine evaluates spatial flow variance and streaks, advising us to open specific gates."*

---

## 🎬 Act III: Mitigation & Recovery (2:00 - 3:00)

1. **Acknowledge Recommendation**
   - Click **"Acknowledge & Dispatch"** on the exit routing recommendation.
   - The green paths on the map update automatically to guide the crowd to the alternative exits. Simulated agents dynamically bend and walk around red hexagons.
   - **Speaker**: *"We dispatch alternate exit routes. The command system pushes dynamic A* safe navigation lines, and the simulated agents steer away from critical cells."*
2. **Open the Citizen Mobile PWA** (`http://localhost:8000/pwa`)
   - Show the mobile interface. Change the language toggle to Hindi (हिं).
   - **Speaker**: *"On the ground, citizens receive warnings on their CrowdShield PWA—localized in their language (Hindi/English)—prompting them to avoid critical red zones."*
3. **Generate AI Session Summary**
   - Click **"AI Summary"** in the sidebar recommendations panel. A concise Gemini-generated digest card is rendered.
   - **Speaker**: *"Finally, with a single click, our Generative AI summaries compile the entire event history into brief, high-level briefings for supervisor handoffs."*
