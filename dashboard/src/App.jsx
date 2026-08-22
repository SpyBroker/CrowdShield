import React, { useState, useEffect, useRef } from 'react';
import { 
  MapContainer, 
  TileLayer, 
  Polygon, 
  CircleMarker, 
  Marker, 
  Popup, 
  Tooltip, 
  Polyline,
  useMap,
  useMapEvents
} from 'react-leaflet';
import L from 'leaflet';
import { 
  LineChart, Line, 
  AreaChart, Area, 
  BarChart, Bar, 
  XAxis, YAxis, 
  CartesianGrid, 
  ResponsiveContainer, 
  Legend as ReChartsLegend 
} from 'recharts';
import { 
  Shield, 
  Activity, 
  AlertTriangle, 
  Volume2, 
  VolumeX, 
  Volume1,
  Radio, 
  MapPin, 
  Send, 
  TrendingUp, 
  ListFilter, 
  Flame,
  UserCheck,
  MousePointer,
  PlusCircle,
  HelpCircle,
  RefreshCw,
  Sparkles
} from 'lucide-react';
import './App.css';

// Fix Leaflet Default Icon issue
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

import { mapToGps, gpsToMap, RISK_COLORS } from './models/dashboardModel';

// Custom Red marker for incidents
const incidentIcon = new L.DivIcon({
  className: 'custom-div-icon',
  html: `<div style="font-size: 24px; filter: drop-shadow(0 0 6px #ef4444);">⚠️</div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12]
});

// Static Venue boundaries & configurations
const venueBounds = [
  mapToGps(0, 100),
  mapToGps(100, 100),
  mapToGps(100, 0),
  mapToGps(0, 0)
];

const wallTop = [
  mapToGps(45, 100),
  mapToGps(55, 100),
  mapToGps(55, 60),
  mapToGps(45, 60)
];

const wallBottom = [
  mapToGps(45, 40),
  mapToGps(55, 40),
  mapToGps(55, 0),
  mapToGps(45, 0)
];

const baseEntrances = [
  { pos: mapToGps(5, 50), name: "Entrance 1" },
  { pos: mapToGps(5, 20), name: "Entrance 2" },
  { pos: mapToGps(5, 80), name: "Entrance 3" }
];

const baseExitPos = mapToGps(95, 50);

// Map Controller component removed to prevent automatic resetting of zoom/pan levels

// Prevents Leaflet from auto-resetting zoom/center on re-renders
function ZoomPreserver() {
  const map = useMap();
  const initialised = useRef(false);
  useEffect(() => {
    if (!initialised.current) {
      initialised.current = true;
      // Only set view once on first mount; never again
      map.setView([28.6139, 77.2090], 18, { animate: false });
    }
  }, [map]);
  return null;
}

// Creates a dedicated high-z-index pane for route polylines so they
// always render above tile layers and never disappear on zoom
function RoutePane() {
  const map = useMap();
  useEffect(() => {
    if (!map.getPane('routePane')) {
      map.createPane('routePane');
      map.getPane('routePane').style.zIndex = 650;
      map.getPane('routePane').style.pointerEvents = 'none';
    }
  }, [map]);
  return null;
}

// Map Click Handler for placing custom assets and selecting coordinates
function MapClickHandler({ mapMode, onMapClick }) {
  useMapEvents({
    click(e) {
      onMapClick(e.latlng.lat, e.latlng.lng);
    }
  });
  return null;
}

// A* Pathfinding Algorithm on 50x50 grid representing 100x100m venue
function findPathAStar(startX, startY, endX, endY, obstacles, redHexes) {
  const cols = 51;
  const rows = 51;
  const scale = 2; // scale factor (50 grid cell sizes of 2m = 100m)
  
  const startG = [Math.round(startX / scale), Math.round(startY / scale)];
  const endG = [Math.round(endX / scale), Math.round(endY / scale)];
  
  const clamp = (val, min, max) => Math.max(min, Math.min(max, val));
  startG[0] = clamp(startG[0], 0, cols - 1);
  startG[1] = clamp(startG[1], 0, rows - 1);
  endG[0] = clamp(endG[0], 0, cols - 1);
  endG[1] = clamp(endG[1], 0, rows - 1);

  let openSet = [{ g: 0, h: dist(startG, endG), f: 0, pos: startG, parent: null }];
  let closedGrid = Array(cols).fill().map(() => Array(rows).fill(false));
  
  function dist(p1, p2) {
    return Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
  }

  function getCellCost(gx, gy) {
    const lx = gx * scale;
    const ly = gy * scale;

    // 1. Static walls (bottleneck blocks)
    if (lx >= 44 && lx <= 56) {
      if (ly >= 58 || ly <= 42) {
        return Infinity; // wall boundary
      }
    }

    // 2. Dynamic obstacles (user added red zones / custom obstacles)
    for (const obs of obstacles) {
      const d = Math.hypot(lx - obs.x, ly - obs.y);
      if (d <= obs.radius) {
        return Infinity; // blocked path
      }
    }

    // 3. Simulated Red/Amber Congested Hexagons
    let penalty = 1.0;
    for (const hex of redHexes) {
      const d = Math.hypot(lx - hex.x, ly - hex.y);
      if (d <= 12) { // Hex boundary diameter approximation
        if (hex.risk_level === 'red') {
          return Infinity; // avoid red alerts completely
        } else if (hex.risk_level === 'amber') {
          penalty += 15.0; // bypass amber zones if possible, or penalize heavily
        }
      }
    }

    return penalty;
  }

  let iterations = 0;
  while (openSet.length > 0 && iterations < 1200) {
    iterations++;
    openSet.sort((a, b) => a.f - b.f);
    const current = openSet.shift();
    const [cx, cy] = current.pos;

    if (cx === endG[0] && cy === endG[1]) {
      let path = [];
      let curr = current;
      while (curr !== null) {
        path.push([curr.pos[0] * scale, curr.pos[1] * scale]);
        curr = curr.parent;
      }
      return path.reverse();
    }

    closedGrid[cx][cy] = true;

    // 8-directional movements
    const dirs = [
      [0, 1], [1, 0], [0, -1], [-1, 0],
      [1, 1], [1, -1], [-1, 1], [-1, -1]
    ];

    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;

      if (nx >= 0 && nx < cols && ny >= 0 && ny < rows) {
        if (closedGrid[nx][ny]) continue;

        const cost = getCellCost(nx, ny);
        if (cost === Infinity) continue;

        const weight = (dx !== 0 && dy !== 0) ? 1.414 : 1.0;
        const gScore = current.g + (weight * cost);
        
        let existing = openSet.find(o => o.pos[0] === nx && o.pos[1] === ny);
        if (!existing) {
          const h = dist([nx, ny], endG);
          openSet.push({
            g: gScore,
            h: h,
            f: gScore + h,
            pos: [nx, ny],
            parent: current
          });
        } else if (gScore < existing.g) {
          existing.g = gScore;
          existing.f = gScore + existing.h;
          existing.parent = current;
        }
      }
    }
  }

  return null; // path blocked or timeout
}

function App() {
  // Live WS states
  const [agents, setAgents] = useState([]);
  const [hexagons, setHexagons] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [surgeMode, setSurgeMode] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [recommendations, setRecommendations] = useState([]);
  const [aiSummary, setAiSummary] = useState(null);
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);

  const [selectedHex, setSelectedHex] = useState(null);
  const hexHistory = useRef({});
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const voiceEnabledRef = useRef(voiceEnabled);
  const audioEnabledRef = useRef(audioEnabled);
  const [recHistory, setRecHistory] = useState([]);

  useEffect(() => { voiceEnabledRef.current = voiceEnabled; }, [voiceEnabled]);
  useEffect(() => { audioEnabledRef.current = audioEnabled; }, [audioEnabled]);

  // Settings & Forms
  const [activeTab, setActiveTab] = useState('charts');
  const [incidentForm, setIncidentForm] = useState({
    description: '',
    latitude: 28.6139,
    longitude: 77.2090
  });

  // Incident & History logs
  const [incidents, setIncidents] = useState([]);
  const [history, setHistory] = useState([]);

  // Advanced features custom states
  const [mapMode, setMapMode] = useState('select'); // 'select' | 'add-entrance' | 'add-exit' | 'add-obstacle'
  const [customEntrances, setCustomEntrances] = useState([]);
  const [customExits, setCustomExits] = useState([]);
  const [customObstacles, setCustomObstacles] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [is3DMode, setIs3DMode] = useState(false);
  const [drillRunning, setDrillRunning] = useState(false);
  const [clickedSpot, setClickedSpot] = useState(null);

  // Audio Context Ref
  const audioCtxRef = useRef(null);
  const previousAlertCount = useRef(0);
  const lastReportedTimes = useRef({});

  // Fetch incidents from backend
  const fetchIncidents = async () => {
    try {
      const res = await fetch('/incidents');
      if (res.ok) {
        const data = await res.json();
        setIncidents(data);
      }
    } catch (err) {
      console.error("Failed to fetch incidents:", err);
    }
  };

  const fetchRecHistory = async () => {
    try {
      const res = await fetch('/recommendations');
      if (res.ok) {
        const data = await res.json();
        setRecHistory(data);
      }
    } catch (err) {
      console.error("Failed to fetch recommendation history:", err);
    }
  };

  useEffect(() => {
    if (activeTab === 'recommendations') {
      fetchRecHistory();
      const interval = setInterval(fetchRecHistory, 2000);
      return () => clearInterval(interval);
    }
  }, [activeTab]);

  const speakAlert = (text) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
      window.speechSynthesis.speak(utterance);
    }
  };

  // Play alert sirens
  const playAlertSound = (severity = 'red') => {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      if (severity === 'red') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(520, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(880, ctx.currentTime + 0.3);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
        osc.start();
        osc.stop(ctx.currentTime + 0.5);
      } else {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
      }
    } catch (e) {
      console.warn("Audio Context blocked by browser auto-play policy", e);
    }
  };

  // Connect WebSockets
  useEffect(() => {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socketUrl = `${wsProtocol}//${window.location.host}/ws`;
    let ws = new WebSocket(socketUrl);

    ws.onopen = () => {
      setIsConnected(true);
      fetchIncidents();
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setAgents(data.agents || []);
        setHexagons(data.hexagons || []);
        setAlerts(data.alerts || []);
        setSurgeMode(data.surge_mode || false);
        setRecommendations(data.recommendations || []);

        const redAlerts = data.alerts.filter(a => a.level === 'red');
        const amberAlerts = data.alerts.filter(a => a.level === 'amber');

        if (data.alerts.length > previousAlertCount.current) {
          const newAlerts = data.alerts.slice(previousAlertCount.current);
          if (audioEnabledRef.current) {
            if (redAlerts.length > 0) {
              playAlertSound('red');
            } else if (amberAlerts.length > 0) {
              playAlertSound('amber');
            }
          }
          if (voiceEnabledRef.current) {
            newAlerts.forEach(a => {
              if (a.level === 'red') {
                speakAlert("Attention: " + a.message);
              }
            });
          }
        }
        previousAlertCount.current = data.alerts.length;

        // Update selected hex history
        const cellTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        (data.hexagons || []).forEach(hex => {
          if (!hexHistory.current[hex.hex]) {
            hexHistory.current[hex.hex] = [];
          }
          hexHistory.current[hex.hex].push({
            time: cellTime,
            density: hex.count,
            speed: hex.avg_speed
          });
          if (hexHistory.current[hex.hex].length > 30) {
            hexHistory.current[hex.hex].shift();
          }
        });

        const speeds = data.agents.map(a => a.speed);
        const avgSpeed = speeds.length > 0 ? (speeds.reduce((a, b) => a + b, 0) / speeds.length) : 0;

        setHistory(prev => {
          const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          const newHistory = [
            ...prev,
            {
              time: timestamp,
              agents: data.agents.length,
              avgSpeed: parseFloat(avgSpeed.toFixed(2)),
              redZones: redAlerts.length,
              amberZones: amberAlerts.length
            }
          ];
          if (newHistory.length > 30) {
            newHistory.shift();
          }
          return newHistory;
        });

        // Check for binned critical red risk hexagons to automatically report them (rate limited per hex)
        (data.hexagons || []).forEach(hex => {
          if (hex.risk_level === 'red') {
            const now = Date.now();
            const lastTime = lastReportedTimes.current[hex.hex] || 0;
            if (now - lastTime > 10000) { // 10-second interval
              lastReportedTimes.current[hex.hex] = now;
              const centerLat = hex.boundary.reduce((sum, p) => sum + p[0], 0) / hex.boundary.length;
              const centerLon = hex.boundary.reduce((sum, p) => sum + p[1], 0) / hex.boundary.length;
              
              fetch('/report-incident', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  description: `AUTOMATIC SENSOR ALERT: Critical crowd density of ${hex.count} peds binned in cell ${hex.hex.substring(0, 12)}...`,
                  latitude: parseFloat(centerLat.toFixed(6)),
                  longitude: parseFloat(centerLon.toFixed(6)),
                  user_id: "critical_density_sensor"
                })
              }).then(res => {
                if (res.ok) {
                  fetchIncidents();
                }
              }).catch(err => {
                console.error("Auto incident reporting failed:", err);
              });
            }
          }
        });

      } catch (err) {
        console.error("Error decoding WS frame:", err);
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      setTimeout(() => {
        setIsConnected(false);
      }, 3000);
    };

    return () => {
      ws.close();
    };
  }, []);

  // Sync custom inputs to the backend simulator
  useEffect(() => {
    const syncSimulationAssets = async () => {
      try {
        await fetch('/update-simulation-assets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entrances: customEntrances,
            exits: customExits,
            obstacles: customObstacles.map(obs => ({
              latitude: obs.lat,
              longitude: obs.lon,
              radius: obs.radius
            }))
          })
        });
      } catch (err) {
        console.error("Failed to sync custom map assets to backend simulator:", err);
      }
    };
    
    if (isConnected) {
      syncSimulationAssets();
    }
  }, [customEntrances, customExits, customObstacles, isConnected]);

  // Dynamic Routing Engine — recalculate only when layout changes, NOT on every agent frame
  // This prevents the green lines from flickering/disappearing
  const routeDebounceRef = useRef(null);
  useEffect(() => {
    if (routeDebounceRef.current) clearTimeout(routeDebounceRef.current);
    routeDebounceRef.current = setTimeout(async () => {
      const allEntrances = [
        ...baseEntrances.map(e => e.pos),
        ...customEntrances
      ];
      const allExits = [baseExitPos, ...customExits];
      const localObstacles = customObstacles.map(obs => {
        const [x, y] = gpsToMap(obs.lat, obs.lon);
        return { x, y, radius: obs.radius };
      });
      // Only use hexagon risk data — not agents — so routes don't recompute every tick
      const redHexes = hexagons
        .filter(h => h.risk_level === 'red' || h.risk_level === 'amber')
        .map(h => {
          const cLat = h.boundary.reduce((s, p) => s + p[0], 0) / h.boundary.length;
          const cLon = h.boundary.reduce((s, p) => s + p[1], 0) / h.boundary.length;
          const [x, y] = gpsToMap(cLat, cLon);
          return { x, y, risk_level: h.risk_level };
        });

      const computed = [];
      for (const ent of allEntrances) {
        const [sx, sy] = gpsToMap(ent[0], ent[1]);
        for (const ex of allExits) {
          const [ex2, ey] = gpsToMap(ex[0], ex[1]);
          const path = await new Promise(resolve =>
            setTimeout(() => resolve(findPathAStar(sx, sy, ex2, ey, localObstacles, redHexes)), 0)
          );
          if (path && path.length > 0) {
            computed.push(path.map(([x, y]) => mapToGps(x, y)));
          }
        }
      }
      setRoutes(computed);
    }, 300); // 300ms debounce — layout changes only, not every agent tick
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hexagons, customEntrances, customExits, customObstacles]);

  // Handle map click inputs
  const handleMapClick = (lat, lon) => {
    setClickedSpot({ lat, lon });
    if (mapMode === 'select') {
      // Auto-update reporting coordinates
      setIncidentForm(prev => ({
        ...prev,
        latitude: parseFloat(lat.toFixed(6)),
        longitude: parseFloat(lon.toFixed(6))
      }));
    } else if (mapMode === 'add-entrance') {
      setCustomEntrances(prev => [...prev, [lat, lon]]);
    } else if (mapMode === 'add-exit') {
      setCustomExits(prev => [...prev, [lat, lon]]);
    } else if (mapMode === 'add-obstacle') {
      setCustomObstacles(prev => [...prev, { lat, lon, radius: 8 }]); // 8 meters obstacle radius
    }
  };

  // Toggle simulation surge mode
  const handleToggleSurge = async () => {
    try {
      const res = await fetch('/toggle-surge', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setSurgeMode(data.surge_mode);
      }
    } catch (err) {
      console.error("Failed to toggle surge flow:", err);
    }
  };

  // Submit Incident Report
  const handleIncidentSubmit = async (e) => {
    e.preventDefault();
    if (!incidentForm.description) {
      alert("Situation description is required.");
      return;
    }

    try {
      const res = await fetch('/report-incident', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: incidentForm.description,
          latitude: parseFloat(incidentForm.latitude),
          longitude: parseFloat(incidentForm.longitude),
          user_id: "dashboard_operator"
        })
      });

      if (res.ok) {
        setIncidentForm(prev => ({ ...prev, description: '' }));
        fetchIncidents();
        alert("Incident dispatched successfully!");
      }
    } catch (err) {
      console.error("Failed to submit incident report:", err);
    }
  };

  const clearCustomElements = () => {
    setCustomEntrances([]);
    setCustomExits([]);
    setCustomObstacles([]);
    setRoutes([]);
  };

  const renderHistory = history.length > 0 ? history : [
    { time: '12:00:00', agents: 0, avgSpeed: 0, redZones: 0, amberZones: 0 }
  ];

  return (
    <div className="dashboard-container">
      {/* Sidebar Panel */}
      <div className="sidebar">
        {/* Header */}
        <div className="header">
          <div className="logo-icon">
            <Shield size={22} style={{ filter: 'drop-shadow(0 0 4px white)' }} />
          </div>
          <div className="title-container">
            <h1>CrowdShield</h1>
            <p>Early stampede warning platform</p>
          </div>
        </div>

        {/* WebSocket Stream Connection Status */}
        <div className="status-indicator" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span className={`status-dot ${isConnected ? 'connected' : 'disconnected'}`}></span>
              <span style={{ fontWeight: 600 }}>
                {isConnected ? 'Stream Active' : 'Connecting Stream...'}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
            <button 
              className={`btn-audio-toggle btn ${audioEnabled ? 'active' : ''}`}
              style={{ padding: '6px 10px', flex: 1, fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
              onClick={() => {
                setAudioEnabled(!audioEnabled);
                if (!audioCtxRef.current) {
                  audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
                }
              }}
            >
              {audioEnabled ? <Volume2 size={13} /> : <VolumeX size={13} />}
              <span>Siren {audioEnabled ? 'ON' : 'OFF'}</span>
            </button>
            <button 
              className={`btn-audio-toggle btn ${voiceEnabled ? 'active' : ''}`}
              style={{ padding: '6px 10px', flex: 1, fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
              onClick={() => {
                setVoiceEnabled(!voiceEnabled);
              }}
            >
              {voiceEnabled ? <Volume1 size={13} /> : <VolumeX size={13} />}
              <span>Voice {voiceEnabled ? 'ON' : 'OFF'}</span>
            </button>
          </div>
        </div>

        {/* Live Status Cards Grid */}
        <div className="status-grid">
          <div className="status-card">
            <div className="status-label">Active Agents</div>
            <div className="status-value">{agents.length}</div>
          </div>
          <div className={`status-card ${surgeMode ? 'surge-active' : ''}`}>
            <div className="status-label">Surge State</div>
            <div className="status-value" style={{ color: surgeMode ? 'var(--risk-red)' : 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
              {surgeMode && <Flame size={20} className="pulse-warning" />}
              {surgeMode ? 'ACTIVE' : 'NORMAL'}
            </div>
          </div>
        </div>

        {/* Control Room Buttons */}
        <div className="panel-section">
          <div className="section-title">
            <Radio size={14} /> Control Actions
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button 
              className={`btn ${surgeMode ? 'btn-danger' : 'btn-primary'}`} 
              onClick={handleToggleSurge}
              style={{ flex: 1 }}
            >
              <Flame size={16} />
              {surgeMode ? 'Normal Flow' : 'Trigger Surge'}
            </button>
            <button 
              className="btn btn-secondary"
              onClick={clearCustomElements}
              title="Reset placed entrances/exits/obstacles"
              style={{ width: 'auto', padding: '12px' }}
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        {/* Active Alerts & Recommendations Feed */}
        <div className="panel-section" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minHeight: '160px' }}>
          <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AlertTriangle size={14} /> Live Alerts ({alerts.length})
            </span>
          </div>
          <div className="alert-feed">
            {alerts.length === 0 ? (
              <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '24px 12px', fontSize: '13px', border: '1px dashed var(--border-color)', borderRadius: '10px' }}>
                No threats flagged. Crowd flow is nominal.
              </div>
            ) : (
              alerts.map((alert, idx) => (
                <div key={idx} className={`alert-item ${alert.level}`}>
                  <div className="alert-item-header">
                    <span className="alert-tag">{alert.level} RISK</span>
                    <span style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      {alert.ml_confidence !== null && alert.ml_confidence !== undefined && (
                        <span style={{ fontSize: '10px', color: '#a78bfa', fontWeight: 'bold' }}>
                          🤖 {alert.ml_confidence}%
                        </span>
                      )}
                      <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Cell {alert.hex.substring(0, 10)}...</span>
                    </span>
                  </div>
                  <div className="alert-body">{alert.message}</div>
                  {alert.recommendation && (
                    <div className="alert-rec">
                      <strong>AI Dispatch Suggestion:</strong>
                      <span>{alert.recommendation}</span>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Recommendation Panel */}
        <div className="panel-section" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minHeight: '120px' }}>
          <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              🎯 AI Recommendations ({recommendations.length})
            </span>
            <button
              onClick={async () => {
                setAiSummaryLoading(true);
                try {
                  const res = await fetch('/incident-summary');
                  const data = await res.json();
                  setAiSummary(data.summary);
                } catch(e) { setAiSummary('Failed to generate summary.'); }
                setAiSummaryLoading(false);
              }}
              style={{ background: 'linear-gradient(135deg,#7c3aed,#4f46e5)', border: 'none', color: 'white', borderRadius: '6px', padding: '3px 8px', fontSize: '10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              🤖 {aiSummaryLoading ? 'Generating...' : 'AI Summary'}
            </button>
          </div>

          {aiSummary && (
            <div style={{ background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.3)', borderRadius: '8px', padding: '10px 12px', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '8px', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
              <span style={{ color: '#a78bfa', fontWeight: 'bold', display: 'block', marginBottom: '4px' }}>🤖 AI Session Summary</span>
              {aiSummary}
              <button onClick={() => setAiSummary(null)} style={{ display: 'block', marginTop: '6px', background: 'none', border: 'none', color: '#a78bfa', cursor: 'pointer', fontSize: '10px' }}>✕ Dismiss</button>
            </div>
          )}

          <div className="alert-feed">
            {recommendations.length === 0 ? (
              <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '16px 12px', fontSize: '12px', border: '1px dashed var(--border-color)', borderRadius: '10px' }}>
                No active recommendations. System is monitoring.
              </div>
            ) : (
              recommendations.map((rec) => (
                <div
                  key={rec.id}
                  className={`alert-item ${rec.severity}`}
                  style={{
                    animation: !rec.acknowledged && rec.severity === 'red' ? 'pulse-glow 2s infinite' : 'none',
                    opacity: rec.acknowledged ? 0.5 : 1,
                    transition: 'opacity 0.3s'
                  }}
                >
                  <div className="alert-item-header">
                    <span className="alert-tag" style={{ background: rec.severity === 'red' ? 'rgba(239,68,68,0.2)' : 'rgba(245,158,11,0.2)' }}>
                      {rec.action_code.replace(/_/g, ' ')}
                    </span>
                    <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                      {new Date(rec.timestamp * 1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}
                    </span>
                  </div>
                  <div className="alert-body" style={{ fontWeight: 'bold', marginBottom: '4px' }}>{rec.title}</div>
                  <div className="alert-body" style={{ fontSize: '10.5px' }}>{rec.reason}</div>
                  {!rec.acknowledged && (
                    <button
                      className="btn btn-primary"
                      style={{ marginTop: '8px', padding: '5px 12px', fontSize: '11px', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                      onClick={async () => {
                        await fetch('/acknowledge-recommendation', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ rec_id: rec.id })
                        });
                      }}
                    >
                      ✓ Acknowledge &amp; Dispatch
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
        <div className="panel-section">
          <div className="section-title">
            <MapPin size={14} /> Dispatch Incident Report
          </div>
          <p style={{ fontSize: '10.5px', color: 'var(--text-secondary)', marginTop: '-6px' }}>
            Tip: Click anywhere on the map in "Select" mode to fill coordinates.
          </p>
          <form onSubmit={handleIncidentSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div className="form-group">
              <label className="form-label">Situation Detail</label>
              <input 
                type="text" 
                className="form-input" 
                placeholder="e.g. Corridor corridor blockage" 
                value={incidentForm.description}
                onChange={(e) => setIncidentForm({...incidentForm, description: e.target.value})}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div className="form-group">
                <label className="form-label">Lat</label>
                <input 
                  type="number" 
                  step="0.000001" 
                  className="form-input"
                  value={incidentForm.latitude}
                  onChange={(e) => setIncidentForm({...incidentForm, latitude: parseFloat(e.target.value) || 0})}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Lon</label>
                <input 
                  type="number" 
                  step="0.000001" 
                  className="form-input"
                  value={incidentForm.longitude}
                  onChange={(e) => setIncidentForm({...incidentForm, longitude: parseFloat(e.target.value) || 0})}
                />
              </div>
            </div>
            <button type="submit" className="btn btn-secondary" style={{ padding: '8px' }}>
              <Send size={13} /> Send Report
            </button>
          </form>
        </div>

        {/* Data Privacy Note */}
        <div style={{
          marginTop: '12px',
          padding: '10px',
          background: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          fontSize: '9.5px',
          color: 'var(--text-secondary)',
          lineHeight: '1.4'
        }}>
          🛡️ <b>Privacy Safeguard:</b> All citizen telemetry is immediately binned into aggregated H3 spatial hashed hexagons (Resolution 14). No individual MAC addresses, device identifiers, or GPS trajectories are logged or persisted.
        </div>
      </div>

      {/* Main View Area */}
      <div className="main-content">
        {/* Top Half: Map View */}
        <div className="map-container-wrapper">
          {/* Map Interactive Editor Toolbar */}
          <div style={{
            position: 'absolute',
            top: '20px',
            right: '20px',
            zIndex: 4000,
            display: 'flex',
            background: 'var(--panel-bg)',
            backdropFilter: 'blur(12px)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            padding: '4px',
            gap: '4px',
            boxShadow: '0 4px 15px rgba(0,0,0,0.5)'
          }}>
            <button 
              className={`btn ${mapMode === 'select' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ width: '36px', height: '36px', padding: 0 }}
              onClick={() => setMapMode('select')}
              title="Select / Auto-fill Incident Coordinates"
            >
              <MousePointer size={16} />
            </button>
            <button 
              className={`btn ${mapMode === 'add-entrance' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ width: '36px', height: '36px', padding: 0, color: '#3b82f6' }}
              onClick={() => setMapMode('add-entrance')}
              title="Add Custom Entrance"
            >
              <PlusCircle size={16} />
            </button>
            <button 
              className={`btn ${mapMode === 'add-exit' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ width: '36px', height: '36px', padding: 0, color: '#10b981' }}
              onClick={() => setMapMode('add-exit')}
              title="Add Custom Safe Exit"
            >
              <PlusCircle size={16} />
            </button>
            <button 
              className={`btn ${mapMode === 'add-obstacle' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ width: '36px', height: '36px', padding: 0, color: '#ef4444' }}
              onClick={() => setMapMode('add-obstacle')}
              title="Add Red Zone (Obstacle)"
            >
              <AlertTriangle size={16} />
            </button>
            <div style={{ width: '1px', background: 'var(--border-color)', margin: '4px 2px' }} />
            <button
              className={`btn ${is3DMode ? 'btn-primary' : 'btn-secondary'}`}
              style={{ width: '36px', height: '36px', padding: 0, fontSize: '16px' }}
              onClick={() => setIs3DMode(v => !v)}
              title={is3DMode ? 'Exit 3D Mode' : 'Enable 3D Digital Twin View'}
            >
              {is3DMode ? '🗺️' : '🧊'}
            </button>
            <button
              className={`btn btn-demo-drill ${drillRunning ? 'running' : ''}`}
              style={{ padding: '0 12px', height: '36px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '5px', whiteSpace: 'nowrap' }}
              disabled={drillRunning}
              title="Start automated crisis demo drill"
              onClick={async () => {
                setDrillRunning(true);
                try {
                  await fetch('/trigger-drill', { method: 'POST' });
                  setTimeout(() => setDrillRunning(false), 50000);
                } catch(e) {
                  setDrillRunning(false);
                }
              }}
            >
              {drillRunning ? '⏳ Running…' : '▶ Demo Drill'}
            </button>
          </div>

          {/* Active Mode Banner */}
          <div style={{
            position: 'absolute',
            top: '20px',
            left: '280px',
            zIndex: 4000,
            background: 'rgba(15, 23, 42, 0.85)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            padding: '6px 12px',
            fontSize: '11px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <Sparkles size={12} className="pulse-warning" style={{ color: 'var(--risk-amber)' }} />
            <span>
              Mode: {
                mapMode === 'select' ? 'Click map to set Incident coordinates' :
                mapMode === 'add-entrance' ? 'Click map to place Entrance' :
                mapMode === 'add-exit' ? 'Click map to place Safe Exit' :
                'Click map to place Red Zone (Obstacle)'
              }
            </span>
          </div>

          <div className={`map-perspective-shell ${is3DMode ? 'mode-3d' : ''}`}>
            <div className="map-inner">
          <MapContainer 
            center={[28.6139, 77.2090]} 
            zoom={18}
            minZoom={15}
            maxZoom={22}
            zoomControl={false}
            scrollWheelZoom={true}
            style={{ width: '100%', height: '100%' }}
          >
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              attribution='&copy; OpenStreetMap contributors &copy; CARTO'
              maxZoom={22}
            />
            
            <ZoomPreserver />
            <RoutePane />
            <MapClickHandler mapMode={mapMode} onMapClick={handleMapClick} />

            {/* Clicked Spot Coordinates Marker & Popup */}
            {clickedSpot && (
              <Marker position={[clickedSpot.lat, clickedSpot.lon]}>
                <Popup onClose={() => setClickedSpot(null)}>
                  <div style={{ textAlign: 'center', fontSize: '11px', padding: '2px', color: '#1e293b' }}>
                    <span style={{ fontWeight: 'bold', display: 'block', marginBottom: '3px', color: '#6366f1' }}>
                      📍 Selected Spot Location
                    </span>
                    <div style={{ background: '#f8fafc', padding: '5px 8px', borderRadius: '6px', border: '1px solid #e2e8f0', fontFamily: 'monospace', fontSize: '11.5px', marginBottom: '6px' }}>
                      <strong>Lat:</strong> {clickedSpot.lat.toFixed(6)}<br/>
                      <strong>Lon:</strong> {clickedSpot.lon.toFixed(6)}
                    </div>
                    <button
                      className="btn btn-primary"
                      style={{ padding: '3px 10px', fontSize: '10.5px', width: '100%' }}
                      onClick={() => {
                        setIncidentForm(prev => ({
                          ...prev,
                          latitude: parseFloat(clickedSpot.lat.toFixed(6)),
                          longitude: parseFloat(clickedSpot.lon.toFixed(6))
                        }));
                      }}
                    >
                      ✓ Set Reporting Coordinates
                    </button>
                  </div>
                </Popup>
              </Marker>
            )}

            {/* Venue Boundary Grid */}
            <Polygon 
              positions={venueBounds} 
              pathOptions={{ color: 'rgba(255, 255, 255, 0.15)', fillColor: 'transparent', weight: 2, dashArray: '5, 5', interactive: false }}
            >
              <Tooltip sticky>Digital Twin Venue Boundary (100m x 100m)</Tooltip>
            </Polygon>

            {/* Bottleneck Wall WallTop */}
            <Polygon 
              positions={wallTop} 
              pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.1, weight: 1 }}
            >
              <Tooltip sticky>Bottleneck Obstacle (Top Boundary)</Tooltip>
            </Polygon>

            {/* Bottleneck Wall WallBottom */}
            <Polygon 
              positions={wallBottom} 
              pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.1, weight: 1 }}
            >
              <Tooltip sticky>Bottleneck Obstacle (Bottom Boundary)</Tooltip>
            </Polygon>

            {/* Spawn Entrances */}
            {baseEntrances.map((ent, idx) => (
              <CircleMarker 
                key={`base-ent-${idx}`}
                center={ent.pos} 
                radius={6} 
                pathOptions={{ fillColor: '#3b82f6', color: '#ffffff', weight: 1.5, fillOpacity: 0.9 }}
              >
                <Popup><b>{ent.name}</b><br/>Spawning pedestrian incoming streams.</Popup>
              </CircleMarker>
            ))}

            {/* Custom Added Entrances */}
            {customEntrances.map((pos, idx) => (
              <CircleMarker 
                key={`custom-ent-${idx}`}
                center={pos} 
                radius={6} 
                pathOptions={{ fillColor: '#2563eb', color: '#60a5fa', weight: 2, fillOpacity: 0.9 }}
              >
                <Popup>
                  <div>
                    <b>Custom Entrance #{idx + 1}</b><br/>
                    <button 
                      className="btn btn-danger" 
                      style={{ padding: '4px 8px', fontSize: '10px', marginTop: '6px', width: 'auto' }}
                      onClick={() => {
                        setCustomEntrances(prev => prev.filter((_, i) => i !== idx));
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </Popup>
              </CircleMarker>
            ))}

            {/* Main Exit */}
            <CircleMarker 
              center={baseExitPos} 
              radius={8} 
              pathOptions={{ fillColor: '#10b981', color: '#ffffff', weight: 1.5, fillOpacity: 0.9 }}
            >
              <Popup><b>Main Gate Exit</b><br/>Safe zone exit point.</Popup>
            </CircleMarker>

            {/* Custom Added Exits */}
            {customExits.map((pos, idx) => (
              <CircleMarker 
                key={`custom-exit-${idx}`}
                center={pos} 
                radius={8} 
                pathOptions={{ fillColor: '#059669', color: '#34d399', weight: 2, fillOpacity: 0.9 }}
              >
                <Popup>
                  <div>
                    <b>Custom Exit #{idx + 1}</b><br/>
                    <button 
                      className="btn btn-danger" 
                      style={{ padding: '4px 8px', fontSize: '10px', marginTop: '6px', width: 'auto' }}
                      onClick={() => {
                        setCustomExits(prev => prev.filter((_, i) => i !== idx));
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </Popup>
              </CircleMarker>
            ))}

            {/* Custom Added Obstacles / Red Zones */}
            {customObstacles.map((obs, idx) => (
              <Polygon
                key={`custom-obs-${idx}`}
                // Render a circle approximation using polygon (or L.circle equivalent in react-leaflet)
                positions={Array(16).fill().map((_, i) => {
                  const angle = (i / 16) * Math.PI * 2;
                  // 8 meters corresponds to approx 0.000072 degrees lat, 0.000080 degrees lon
                  const latOffset = Math.sin(angle) * obs.radius * 0.000009;
                  const lonOffset = Math.cos(angle) * obs.radius * 0.000010;
                  return [obs.lat + latOffset, obs.lon + lonOffset];
                })}
                pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.3, weight: 1.5 }}
              >
                <Popup>
                  <div>
                    <b>Custom Red Zone Obstacle #{idx + 1}</b><br/>
                    <button 
                      className="btn btn-danger" 
                      style={{ padding: '4px 8px', fontSize: '10px', marginTop: '6px', width: 'auto' }}
                      onClick={() => {
                        setCustomObstacles(prev => prev.filter((_, i) => i !== idx));
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </Popup>
              </Polygon>
            ))}

            {/* Dynamic Hexagon H3 Grid Overlays */}
            {hexagons.map((hex, idx) => {
              let color = 'var(--risk-green)';
              if (hex.risk_level === 'red') color = 'var(--risk-red)';
              if (hex.risk_level === 'amber') color = 'var(--risk-amber)';
              
              return (
                <Polygon 
                  key={`hex-${hex.hex}-${hex.risk_level}`}
                  positions={hex.boundary} 
                  pathOptions={{ 
                    color: selectedHex === hex.hex ? '#a78bfa' : color, 
                    fillColor: color, 
                    fillOpacity: selectedHex === hex.hex ? 0.55 : 0.25, 
                    weight: selectedHex === hex.hex ? 3.5 : 1.5 
                  }}
                  eventHandlers={{
                    click: (e) => {
                      setSelectedHex(hex.hex);
                      if (e && e.latlng) {
                        handleMapClick(e.latlng.lat, e.latlng.lng);
                      }
                    }
                  }}
                >
                  <Tooltip sticky>
                    <div>
                      <strong>Cell: {hex.hex.substring(0, 15)}...</strong><br/>
                      Density: {hex.count} peds / cell<br/>
                      Avg Speed: {hex.avg_speed} m/s<br/>
                      Status: <span style={{ color: color, fontWeight: 'bold', textTransform: 'uppercase' }}>{hex.risk_level}</span>
                      {hex.ml_confidence !== null && hex.ml_confidence !== undefined && (
                        <><br/><span style={{ color: '#a78bfa', fontSize: '11px' }}>
                          🤖 ML Confidence: <b>{hex.ml_confidence}%</b>
                        </span></>
                      )}
                    </div>
                  </Tooltip>
                </Polygon>
              );
            })}

            {/* Individual Pedestrian Agents */}
            {agents.map((agent) => (
              <CircleMarker
                key={agent.id}
                center={[agent.lat, agent.lon]}
                radius={2.5}
                pathOptions={{ fillColor: '#ffffff', color: '#0f172a', weight: 0.5, fillOpacity: 0.95 }}
              />
            ))}

            {/* Citizen Reported Incident Markers */}
            {incidents.map((inc) => (
              <Marker 
                key={inc.id} 
                position={[inc.latitude, inc.longitude]} 
                icon={incidentIcon}
              >
                <Popup>
                  <div style={{ color: 'black' }}>
                    <strong>Incident Report #{inc.id}</strong><br/>
                    Reporter: {inc.user_id}<br/>
                    <p style={{ margin: '6px 0 0' }}>{inc.description}</p>
                  </div>
                </Popup>
              </Marker>
            ))}

            {/* Safe Predictive Routes — rendered in high-z routePane so they never disappear on zoom */}
            {routes.map((route, idx) => (
              <Polyline 
                key={`route-${idx}`}
                positions={route}
                pane="routePane"
                pathOptions={{ 
                  color: '#10b981', 
                  weight: 4, 
                  opacity: 0.9, 
                  lineCap: 'round', 
                  lineJoin: 'round',
                  dashArray: '10, 6'
                }}
              >
                <Tooltip sticky pane="tooltipPane">Recommended Crowd Safe Route</Tooltip>
              </Polyline>
            ))}
          </MapContainer>
            </div>{/* .map-inner */}
          </div>{/* .map-perspective-shell */}

          {/* ── Placed Items Panel (outside MapContainer so z-index works correctly) ── */}
          {(customEntrances.length > 0 || customExits.length > 0 || customObstacles.length > 0) && (
            <div style={{
              position: 'absolute',
              bottom: '20px',
              left: '20px',
              zIndex: 1100,
              background: 'var(--panel-bg)',
              backdropFilter: 'blur(12px)',
              border: '1px solid var(--border-color)',
              borderRadius: '10px',
              padding: '10px 12px',
              minWidth: '190px',
              maxWidth: '220px',
              maxHeight: '200px',
              overflowY: 'auto',
              boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
              fontSize: '11px'
            }}>
              <div style={{ fontWeight: 700, marginBottom: '8px', color: 'var(--text-secondary)', fontSize: '10px', letterSpacing: '0.5px' }}>PLACED ITEMS</div>

              {customEntrances.map((pos, i) => (
                <div key={`pe-${i}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '5px' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#3b82f6', display: 'inline-block', flexShrink: 0 }} />
                    Entrance {i + 1}
                  </span>
                  <button
                    style={{ border: '1px solid rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.1)', color: '#f87171', borderRadius: 4, padding: '1px 6px', cursor: 'pointer', fontSize: '10px', flexShrink: 0 }}
                    onClick={() => setCustomEntrances(prev => prev.filter((_, j) => j !== i))}
                  >✕</button>
                </div>
              ))}

              {customExits.map((pos, i) => (
                <div key={`pe2-${i}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '5px' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', display: 'inline-block', flexShrink: 0 }} />
                    Exit {i + 1}
                  </span>
                  <button
                    style={{ border: '1px solid rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.1)', color: '#f87171', borderRadius: 4, padding: '1px 6px', cursor: 'pointer', fontSize: '10px', flexShrink: 0 }}
                    onClick={() => setCustomExits(prev => prev.filter((_, j) => j !== i))}
                  >✕</button>
                </div>
              ))}

              {customObstacles.map((obs, i) => (
                <div key={`po-${i}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '5px' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', display: 'inline-block', flexShrink: 0 }} />
                    Red Zone {i + 1}
                  </span>
                  <button
                    style={{ border: '1px solid rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.1)', color: '#f87171', borderRadius: 4, padding: '1px 6px', cursor: 'pointer', fontSize: '10px', flexShrink: 0 }}
                    onClick={() => setCustomObstacles(prev => prev.filter((_, j) => j !== i))}
                  >✕</button>
                </div>
              ))}

              <button
                style={{ width: '100%', marginTop: '8px', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.07)', color: '#f87171', borderRadius: 5, padding: '4px 0', cursor: 'pointer', fontSize: '10px', fontWeight: 600 }}
                onClick={() => { setCustomEntrances([]); setCustomExits([]); setCustomObstacles([]); }}
              >Clear All</button>
            </div>
          )}

          {/* Floating Map Legend Card */}
          <div className="map-overlay-card">
            <div className="map-overlay-title">Visual Legend</div>
            <div className="legend-item">
              <div className="legend-color" style={{ background: '#ef4444' }}></div>
              <span>Critical Risk (Red)</span>
            </div>
            <div className="legend-item">
              <div className="legend-color" style={{ background: '#f59e0b' }}></div>
              <span>Moderate Risk (Amber)</span>
            </div>
            <div className="legend-item">
              <div className="legend-color" style={{ background: '#10b981' }}></div>
              <span>Nominal Flow (Green)</span>
            </div>
            <div className="legend-item">
              <div className="legend-color" style={{ background: '#10b981', height: '3px', borderRadius: 0 }}></div>
              <span style={{ color: '#10b981', fontWeight: 600 }}>Safe Route Recommendation</span>
            </div>
            <div className="legend-item">
              <div className="legend-color circle" style={{ background: '#3b82f6' }}></div>
              <span>Entrances (Base/Custom)</span>
            </div>
            <div className="legend-item">
              <div className="legend-color circle" style={{ background: '#10b981' }}></div>
              <span>Exits (Base/Custom)</span>
            </div>
            <div className="legend-item">
              <div className="legend-color circle" style={{ background: '#ffffff', border: '1px solid #000' }}></div>
              <span>Pedestrian Agent</span>
            </div>
          </div>
        </div>

        {/* Bottom Half: Analytics Panel */}
        <div className="bottom-panel">
          <div className="panel-tabs">
            <div 
              className={`panel-tab ${activeTab === 'charts' ? 'active' : ''}`}
              onClick={() => setActiveTab('charts')}
            >
              <TrendingUp size={14} /> Analytics & Graphs
            </div>
            <div 
              className={`panel-tab ${activeTab === 'incidents' ? 'active' : ''}`}
              onClick={() => setActiveTab('incidents')}
            >
              <ListFilter size={14} /> Incident Logs ({incidents.length})
            </div>
            <div 
              className={`panel-tab ${activeTab === 'recommendations' ? 'active' : ''}`}
              onClick={() => setActiveTab('recommendations')}
            >
              <Activity size={14} /> AI Recommendation Logs
            </div>
            <div 
              className={`panel-tab ${activeTab === 'about' ? 'active' : ''}`}
              onClick={() => setActiveTab('about')}
            >
              <UserCheck size={14} /> Operations Manual
            </div>
            <div 
              className={`panel-tab ${activeTab === 'pitch' ? 'active' : ''}`}
              onClick={() => setActiveTab('pitch')}
              style={{ background: activeTab === 'pitch' ? 'linear-gradient(135deg,rgba(124,58,237,0.3),rgba(79,70,229,0.3))' : '' }}
            >
              🎤 Pitch Deck
            </div>
          </div>

          <div className="tab-content">
            {activeTab === 'charts' && (
              <>
                {/* Hex Cell Drill Down Analytics if selected */}
                {selectedHex && (
                  <div className="chart-card" style={{ gridColumn: 'span 3', background: 'rgba(124, 58, 237, 0.04)', border: '1px solid rgba(124, 58, 237, 0.25)' }}>
                    <div className="chart-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                      <div>
                        <div className="chart-title" style={{ color: '#a78bfa', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          🤖 Hexagon Cell Drill-Down Analysis
                        </div>
                        <div className="chart-subtitle">Cell Index: {selectedHex}</div>
                      </div>
                      <button 
                        className="btn btn-secondary" 
                        style={{ width: 'auto', padding: '4px 10px', fontSize: '10px' }}
                        onClick={() => setSelectedHex(null)}
                      >
                        ✕ Clear Selection
                      </button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                      <div style={{ height: '130px' }}>
                        <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '6px', textAlign: 'center', fontWeight: 'bold' }}>Cell Density (peds/cell)</div>
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={hexHistory.current[selectedHex] || []}>
                            <defs>
                              <linearGradient id="cellDensGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.25}/>
                                <stop offset="95%" stopColor="#a78bfa" stopOpacity={0}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                            <XAxis dataKey="time" stroke="#94a3b8" fontSize={8} tickLine={false} />
                            <YAxis stroke="#94a3b8" fontSize={8} axisLine={false} tickLine={false} />
                            <Area type="monotone" dataKey="density" name="Density" stroke="#a78bfa" fillOpacity={1} fill="url(#cellDensGrad)" strokeWidth={2} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                      <div style={{ height: '130px' }}>
                        <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '6px', textAlign: 'center', fontWeight: 'bold' }}>Cell Avg Speed (m/s)</div>
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={hexHistory.current[selectedHex] || []}>
                            <defs>
                              <linearGradient id="cellSpeedGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.25}/>
                                <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                            <XAxis dataKey="time" stroke="#94a3b8" fontSize={8} tickLine={false} />
                            <YAxis stroke="#94a3b8" fontSize={8} domain={[0, 2]} axisLine={false} tickLine={false} />
                            <Area type="monotone" dataKey="speed" name="Speed" stroke="#10b981" fillOpacity={1} fill="url(#cellSpeedGrad)" strokeWidth={2} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                )}
                {/* Population Trend */}
                <div className="chart-card">
                  <div className="chart-header">
                    <div>
                      <div className="chart-title">Active Crowd Count</div>
                      <div className="chart-subtitle">Pedestrians inside simulated venue bounds</div>
                    </div>
                  </div>
                  <div style={{ flexGrow: 1, minHeight: '120px' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={renderHistory}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="time" stroke="#94a3b8" fontSize={9} tickLine={false} />
                        <YAxis stroke="#94a3b8" fontSize={9} axisLine={false} tickLine={false} />
                        <Line type="monotone" dataKey="agents" name="Agents" stroke="#3b82f6" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Avg Speed Trend */}
                <div className="chart-card">
                  <div className="chart-header">
                    <div>
                      <div className="chart-title">Mean Walking Velocity</div>
                      <div className="chart-subtitle">Average movement speed of the crowd (m/s)</div>
                    </div>
                  </div>
                  <div style={{ flexGrow: 1, minHeight: '120px' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={renderHistory}>
                        <defs>
                          <linearGradient id="speedGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.2}/>
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="time" stroke="#94a3b8" fontSize={9} tickLine={false} />
                        <YAxis stroke="#94a3b8" fontSize={9} domain={[0, 2]} axisLine={false} tickLine={false} />
                        <Area type="monotone" dataKey="avgSpeed" name="Avg Speed" stroke="#10b981" fillOpacity={1} fill="url(#speedGrad)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Spatial Risks */}
                <div className="chart-card">
                  <div className="chart-header">
                    <div>
                      <div className="chart-title">Risk Cell Densities</div>
                      <div className="chart-subtitle">Count of binned spatial zones matching threat profiles</div>
                    </div>
                  </div>
                  <div style={{ flexGrow: 1, minHeight: '120px' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={renderHistory}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="time" stroke="#94a3b8" fontSize={9} tickLine={false} />
                        <YAxis stroke="#94a3b8" fontSize={9} axisLine={false} tickLine={false} />
                        <Bar dataKey="redZones" name="Red (Critical)" fill="#ef4444" stackId="a" />
                        <Bar dataKey="amberZones" name="Amber (Warning)" fill="#f59e0b" stackId="a" />
                        <ReChartsLegend verticalAlign="top" height={24} iconSize={8} wrapperStyle={{ fontSize: 9 }} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </>
            )}

            {activeTab === 'incidents' && (
              <div className="incident-log-list">
                {incidents.length === 0 ? (
                  <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '40px', fontSize: '13px' }}>
                    No citizen incidents reported yet.
                  </div>
                ) : (
                  incidents.map((inc) => (
                    <div key={inc.id} className="incident-log-item">
                      <div className="incident-meta">
                        <div className="incident-id">INCIDENT #{inc.id}</div>
                        <div className="incident-desc">{inc.description}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div className="incident-coords">Lat: {inc.latitude.toFixed(4)}</div>
                        <div className="incident-coords">Lon: {inc.longitude.toFixed(4)}</div>
                        <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '4px' }}>Reporter: {inc.user_id}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === 'recommendations' && (
              <div className="incident-log-list" style={{ gridColumn: 'span 3', padding: '10px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', color: '#e2e8f0' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left', color: 'var(--text-secondary)' }}>
                      <th style={{ padding: '8px' }}>Timestamp</th>
                      <th style={{ padding: '8px' }}>Action Code</th>
                      <th style={{ padding: '8px' }}>Target Hexagon</th>
                      <th style={{ padding: '8px' }}>Explanation Reason</th>
                      <th style={{ padding: '8px', textAlign: 'center' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recHistory.length === 0 ? (
                      <tr>
                        <td colSpan="5" style={{ textAlign: 'center', padding: '24px', color: 'var(--text-secondary)' }}>
                          No system recommendation logs generated yet.
                        </td>
                      </tr>
                    ) : (
                      recHistory.map((rec) => (
                        <tr key={rec.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                          <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>
                            {new Date(rec.timestamp * 1000).toLocaleTimeString()}
                          </td>
                          <td style={{ padding: '8px', color: '#a78bfa', fontWeight: 'bold' }}>
                            {rec.action_code}
                          </td>
                          <td style={{ padding: '8px', fontFamily: 'monospace', fontSize: '10px' }}>
                            {rec.hex}
                          </td>
                          <td style={{ padding: '8px', lineHeight: '1.4' }}>
                            {rec.reason}
                          </td>
                          <td style={{ padding: '8px', textAlign: 'center' }}>
                            <span style={{ 
                              padding: '2px 6px', 
                              borderRadius: '4px', 
                              fontSize: '9px', 
                              fontWeight: 'bold',
                              background: rec.acknowledged ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                              color: rec.acknowledged ? 'var(--risk-green)' : 'var(--risk-red)'
                            }}>
                              {rec.acknowledged ? 'ACKNOWLEDGED' : 'ACTIVE'}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === 'about' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '13px', color: '#e2e8f0', maxWidth: '800px', lineHeight: 1.6 }}>
                <h3>🛡️ CrowdShield Operator manual</h3>
                <p>
                  This command center monitors spatial crowd densities in real-time. By leveraging H3 spatial binning (Uber hex grids), the platform clusters agents and evaluates density levels.
                </p>
                <ul>
                  <li><strong>A* Routing Engine:</strong> Dynamically calculates safe path corridors (represented by dashed green polylines) from entrances to safe exits. The algorithm avoids bottleneck walls, operator-defined red zones, and highly congested red hexagons.</li>
                  <li><strong>Custom Placements:</strong> Use the editor toolbar on the top-right of the map to place custom Entrances, Safe Exits, and Red Zone Obstacles dynamically.</li>
                  <li><strong>Incident Coordinate Autofill:</strong> In "Select" mode (mouse pointer icon), click anywhere on the map to set the Lat/Lon coordinates inside the Dispatch Incident Report form.</li>
                </ul>
              </div>
            )}

            {activeTab === 'pitch' && (
              <div style={{ display: 'flex', gap: '16px', overflowX: 'auto', padding: '8px 4px', scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch' }}>

                {/* Slide 1 — Problem */}
                <div style={{ minWidth: '280px', background: 'linear-gradient(135deg,rgba(239,68,68,0.12),rgba(220,38,38,0.06))', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '14px', padding: '20px', scrollSnapAlign: 'start', flexShrink: 0 }}>
                  <div style={{ fontSize: '28px', marginBottom: '10px' }}>⚠️</div>
                  <div style={{ fontSize: '13px', fontWeight: '800', color: '#fca5a5', marginBottom: '10px', letterSpacing: '-0.3px' }}>The Problem</div>
                  <div style={{ fontSize: '22px', fontWeight: '900', color: '#f1f5f9', lineHeight: 1.2, marginBottom: '12px' }}>2,400+ deaths<br/>from crowd crushes<br/>since 2010</div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', lineHeight: 1.6 }}>
                    Hathras 2024 · 121 dead<br/>
                    Seoul 2022 · 159 dead<br/>
                    Mecca 2015 · 2,400+ dead<br/>
                    <span style={{ color: '#fca5a5', fontWeight: '600' }}>All preventable with early detection.</span>
                  </div>
                </div>

                {/* Slide 2 — Solution */}
                <div style={{ minWidth: '300px', background: 'linear-gradient(135deg,rgba(124,58,237,0.12),rgba(79,70,229,0.06))', border: '1px solid rgba(124,58,237,0.3)', borderRadius: '14px', padding: '20px', scrollSnapAlign: 'start', flexShrink: 0 }}>
                  <div style={{ fontSize: '28px', marginBottom: '10px' }}>🛡️</div>
                  <div style={{ fontSize: '13px', fontWeight: '800', color: '#a78bfa', marginBottom: '10px' }}>Our Solution</div>
                  <div style={{ fontSize: '16px', fontWeight: '800', color: '#f1f5f9', marginBottom: '14px' }}>CrowdShield — Real-Time AI Stampede Prevention</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    {[['📡','H3 Spatial Binning'],['🤖','ML Risk Classifier'],['🎯','Recommendation Engine'],['📱','Citizen Mobile PWA']].map(([icon, label]) => (
                      <div key={label} style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '8px', padding: '8px', fontSize: '10px', color: '#cbd5e1', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>{icon}</span><span>{label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Slide 3 — ML Results */}
                <div style={{ minWidth: '260px', background: 'linear-gradient(135deg,rgba(16,185,129,0.1),rgba(5,150,105,0.05))', border: '1px solid rgba(16,185,129,0.25)', borderRadius: '14px', padding: '20px', scrollSnapAlign: 'start', flexShrink: 0 }}>
                  <div style={{ fontSize: '28px', marginBottom: '10px' }}>📊</div>
                  <div style={{ fontSize: '13px', fontWeight: '800', color: '#6ee7b7', marginBottom: '10px' }}>ML Performance</div>
                  <div style={{ fontSize: '40px', fontWeight: '900', color: '#10b981', lineHeight: 1, marginBottom: '6px' }}>99.97%</div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '12px' }}>Accuracy — GradientBoosting Classifier</div>
                  <div style={{ fontSize: '10px', color: '#6ee7b7', lineHeight: 1.7 }}>
                    ✓ 7-feature vector (density, speed, flow variance, Δ features)<br/>
                    ✓ Dual-gate fusion (rule + ML) reduces false positives<br/>
                    ✓ Real-time confidence score per hexagon cell
                  </div>
                </div>

                {/* Slide 4 — Demo CTA */}
                <div style={{ minWidth: '240px', background: 'linear-gradient(135deg,rgba(245,158,11,0.12),rgba(217,119,6,0.06))', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '14px', padding: '20px', scrollSnapAlign: 'start', flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', gap: '14px' }}>
                  <div style={{ fontSize: '36px' }}>🎬</div>
                  <div style={{ fontSize: '14px', fontWeight: '800', color: '#fcd34d' }}>Watch the Crisis Unfold</div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', lineHeight: 1.6 }}>Automated demo: Normal → Surge → Bottleneck → Red Alerts → Recovery</div>
                  <button
                    className={`btn btn-demo-drill ${drillRunning ? 'running' : ''}`}
                    style={{ padding: '10px 20px', fontSize: '13px', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px', width: '100%', justifyContent: 'center' }}
                    disabled={drillRunning}
                    onClick={async () => {
                      setDrillRunning(true);
                      try { await fetch('/trigger-drill', { method: 'POST' }); setTimeout(() => setDrillRunning(false), 50000); }
                      catch(e) { setDrillRunning(false); }
                    }}
                  >
                    {drillRunning ? '⏳ Running…' : '▶ Start Demo Drill'}
                  </button>
                </div>

                {/* Slide 5 — Scale-Up Roadmap */}
                <div style={{ minWidth: '280px', background: 'linear-gradient(135deg,rgba(59,130,246,0.1),rgba(37,99,235,0.05))', border: '1px solid rgba(59,130,246,0.25)', borderRadius: '14px', padding: '20px', scrollSnapAlign: 'start', flexShrink: 0 }}>
                  <div style={{ fontSize: '28px', marginBottom: '10px' }}>🚀</div>
                  <div style={{ fontSize: '13px', fontWeight: '800', color: '#93c5fd', marginBottom: '12px' }}>Production Scale-Up Path</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {[
                      ['📡','Real Sensors','Bluetooth/WiFi RSSI + Telecom CDR'],
                      ['⚡','AWS Kinesis','Real-time ingestion at 100k events/s'],
                      ['🔧','AWS Glue','Automated ETL & H3 feature pipeline'],
                      ['🧠','SageMaker','Hosted model with auto-retraining'],
                      ['📱','Multi-venue','Dashboard federation across events'],
                    ].map(([icon, title, desc]) => (
                      <div key={title} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                        <span style={{ fontSize: '14px', flexShrink: 0, marginTop: '1px' }}>{icon}</span>
                        <div>
                          <div style={{ fontSize: '10px', fontWeight: '700', color: '#93c5fd' }}>{title}</div>
                          <div style={{ fontSize: '9px', color: '#64748b' }}>{desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Slide 6 — Closing */}
                <div style={{ minWidth: '240px', background: 'linear-gradient(135deg,rgba(15,23,42,0.8),rgba(30,41,59,0.6))', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '14px', padding: '20px', scrollSnapAlign: 'start', flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: '28px', marginBottom: '10px' }}>🏆</div>
                    <div style={{ fontSize: '13px', fontWeight: '800', color: '#f1f5f9', marginBottom: '8px' }}>Thank You</div>
                    <div style={{ fontSize: '11px', color: '#94a3b8', lineHeight: 1.8 }}>
                      Built with: Python · FastAPI · Mesa · H3 · React · scikit-learn<br/>
                      Demo Day — Aug 23, 2026
                    </div>
                  </div>
                  <div style={{ marginTop: '16px', padding: '10px', background: 'rgba(124,58,237,0.12)', borderRadius: '8px', fontSize: '10px', color: '#a78bfa', textAlign: 'center', fontWeight: '600' }}>
                    🛡️ CrowdShield — Every second counts.
                  </div>
                </div>

              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
