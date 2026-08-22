/**
 * dashboardModel.js
 * CrowdShield Command Dashboard — Models & Data Transformers
 */

export const LAT_ANCHOR = 28.6139;
export const LON_ANCHOR = 77.2090;

/**
 * Maps 0-100 local grid coordinates to GPS Lat/Lon
 */
export function mapToGps(x, y) {
  const lat = LAT_ANCHOR + (y - 50) * 0.000009;
  const lon = LON_ANCHOR + (x - 50) * 0.000010;
  return [parseFloat(lat.toFixed(6)), parseFloat(lon.toFixed(6))];
}

/**
 * Maps GPS Lat/Lon back to 0-100 local grid coordinates
 */
export function gpsToMap(lat, lon) {
  const x = (lon - LON_ANCHOR) / 0.000010 + 50;
  const y = (lat - LAT_ANCHOR) / 0.000009 + 50;
  return [parseFloat(x.toFixed(2)), parseFloat(y.toFixed(2))];
}

export const RISK_COLORS = {
  green: '#10b981',
  amber: '#f59e0b',
  red: '#ef4444'
};

export const BASE_ENTRANCES = [
  { name: 'Entrance Gate 1 (North-West)', pos: mapToGps(5, 50) },
  { name: 'Entrance Gate 2 (South-West)', pos: mapToGps(5, 20) },
  { name: 'Entrance Gate 3 (North-East)', pos: mapToGps(5, 80) }
];

export const BASE_EXIT_POS = mapToGps(95, 50);

export const DEFAULT_INCIDENT_FORM = {
  description: '',
  latitude: 28.6139,
  longitude: 77.2090,
  category: 'Crowd Crush'
};
