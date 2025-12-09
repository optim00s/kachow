// Approx battery capacity for Asus Vivobook X412DA.
// If your specific battery is 32 Wh or 29 Wh, you can change this.
const CAPACITY_WH = 37;

// How many samples to keep in memory (e.g. 60 minutes if interval=5s)
const MAX_SAMPLES = 720;

// Storage keys
const STORAGE_KEY = "kachow_history";
const STORAGE_SESSION_KEY = "kachow_session";
const STORAGE_COMPACT_KEY = "kachow_compact";

// DOM Elements
const levelEl = document.getElementById("level");
const statusBadge = document.getElementById("statusBadge");
const statusText = document.getElementById("statusText");
const powerEl = document.getElementById("power");
const timeInfoEl = document.getElementById("timeInfo");
const timeLabelEl = document.getElementById("timeLabel");
const chartValueEl = document.getElementById("chartValue");
const ringProgress = document.getElementById("ringProgress");
const canvas = document.getElementById("powerChart");
const ctx = canvas.getContext("2d");

// New DOM elements for extended stats
const sessionEnergyEl = document.getElementById("sessionEnergy");
const avg5mEl = document.getElementById("avg5m");
const avg30mEl = document.getElementById("avg30m");
const avg1hEl = document.getElementById("avg1h");
const powerProfileEl = document.getElementById("powerProfile");
const profileTextEl = document.getElementById("profileText");
const exportBtn = document.getElementById("exportBtn");
const compactToggle = document.getElementById("compactToggle");
const rootEl = document.getElementById("root");

// Each sample = { t: timestamp_ms, p: power_W }
let samples = [];

// Ring circumference for progress calculation
const RING_CIRCUMFERENCE = 2 * Math.PI * 52; // r = 52

// Session tracking
let sessionStartTime = Date.now();
let sessionEnergyWh = 0;
let lastSampleTime = null;

// Power tracking for estimation
let lastLevel = null;
let lastLevelTime = null;

// Theme detection
function isDarkMode() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

// Get theme-aware colors
function getChartColors() {
  if (isDarkMode()) {
    return {
      placeholder: "#3f3f46",
      gradientStart: "rgba(0, 255, 135, 0.3)",
      gradientMid: "rgba(96, 239, 255, 0.1)",
      gradientEnd: "rgba(0, 97, 255, 0)",
      lineStart: "#00ff87",
      lineMid: "#60efff",
      lineEnd: "#0061ff",
      dotColor: "#00ff87",
      dotGlow: "rgba(0, 255, 135, 0.3)"
    };
  } else {
    return {
      placeholder: "#94a3b8",
      gradientStart: "rgba(5, 150, 105, 0.2)",
      gradientMid: "rgba(8, 145, 178, 0.1)",
      gradientEnd: "rgba(59, 130, 246, 0)",
      lineStart: "#059669",
      lineMid: "#0891b2",
      lineEnd: "#3b82f6",
      dotColor: "#059669",
      dotGlow: "rgba(5, 150, 105, 0.25)"
    };
  }
}

// Load samples from storage
async function loadHistory() {
  try {
    const result = await chrome.storage.local.get([STORAGE_KEY, STORAGE_SESSION_KEY]);
    
    if (result[STORAGE_KEY] && Array.isArray(result[STORAGE_KEY])) {
      // Filter out samples older than 1 hour to keep storage reasonable
      const oneHourAgo = Date.now() - (60 * 60 * 1000);
      samples = result[STORAGE_KEY].filter(s => s.t > oneHourAgo);
      console.log(`Loaded ${samples.length} samples from history`);
    }
    
    if (result[STORAGE_SESSION_KEY]) {
      sessionEnergyWh = result[STORAGE_SESSION_KEY].energy || 0;
      sessionStartTime = result[STORAGE_SESSION_KEY].startTime || Date.now();
    }
  } catch (err) {
    console.log("Could not load history:", err);
  }
}

// Save samples to storage (debounced)
let saveTimeout = null;
function saveHistory() {
  if (saveTimeout) clearTimeout(saveTimeout);
  
  saveTimeout = setTimeout(async () => {
    try {
      // Only keep last hour of data
      const oneHourAgo = Date.now() - (60 * 60 * 1000);
      const recentSamples = samples.filter(s => s.t > oneHourAgo);
      
      await chrome.storage.local.set({
        [STORAGE_KEY]: recentSamples,
        [STORAGE_SESSION_KEY]: {
          energy: sessionEnergyWh,
          startTime: sessionStartTime
        }
      });
    } catch (err) {
      console.log("Could not save history:", err);
    }
  }, 1000); // Debounce by 1 second
}

// Compact mode functions
async function loadCompactMode() {
  try {
    const result = await chrome.storage.local.get([STORAGE_COMPACT_KEY]);
    if (result[STORAGE_COMPACT_KEY]) {
      rootEl.classList.add("compact");
    }
  } catch (err) {
    console.log("Could not load compact preference:", err);
  }
}

async function toggleCompactMode() {
  const isCompact = rootEl.classList.toggle("compact");
  
  try {
    await chrome.storage.local.set({
      [STORAGE_COMPACT_KEY]: isCompact
    });
  } catch (err) {
    console.log("Could not save compact preference:", err);
  }
  
  // Redraw chart if switching to full mode
  if (!isCompact && samples.length >= 2) {
    setTimeout(drawChart, 50);
  }
}

function formatSeconds(sec) {
  if (!isFinite(sec) || sec < 0) return "--";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h === 0 && m === 0) return "< 1 min";
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function estimatePowerW(battery) {
  const level = battery.level;

  // Charging case: use time until full
  if (battery.charging && isFinite(battery.chargingTime) && battery.chargingTime > 0) {
    const remainingWh = (1 - level) * CAPACITY_WH;
    const hoursToFull = battery.chargingTime / 3600;
    if (hoursToFull > 0) {
      return remainingWh / hoursToFull;
    }
  }

  // Discharging case: use time until empty
  if (!battery.charging && isFinite(battery.dischargingTime) && battery.dischargingTime > 0) {
    const remainingWh = level * CAPACITY_WH;
    const hoursToEmpty = battery.dischargingTime / 3600;
    if (hoursToEmpty > 0) {
      return remainingWh / hoursToEmpty;
    }
  }

  // Fallback: estimate from level change rate
  if (lastLevel !== null && lastLevelTime !== null) {
    const now = Date.now();
    const deltaTime = (now - lastLevelTime) / 1000 / 3600; // hours
    const deltaLevel = Math.abs(level - lastLevel);
    
    if (deltaTime > 0 && deltaLevel > 0) {
      const deltaWh = deltaLevel * CAPACITY_WH;
      return deltaWh / deltaTime;
    }
    
    // If level hasn't changed, return last known power or a placeholder
    if (samples.length > 0) {
      return samples[samples.length - 1].p;
    }
  }

  // Update tracking
  if (lastLevel !== level) {
    lastLevel = level;
    lastLevelTime = Date.now();
  }

  // Return a minimal placeholder to start showing the chart
  return battery.charging ? 15 : 8; // Rough estimates for charging/discharging
}

function addSample(powerW) {
  const now = Date.now();
  
  // Calculate energy for session stats (Wh = W * hours)
  if (lastSampleTime !== null) {
    const hoursDelta = (now - lastSampleTime) / 1000 / 3600;
    sessionEnergyWh += powerW * hoursDelta;
  }
  lastSampleTime = now;
  
  samples.push({ t: now, p: powerW });
  if (samples.length > MAX_SAMPLES) {
    samples.shift();
  }
  
  // Save to persistent storage
  saveHistory();
}

// Calculate average power over a time window (in milliseconds)
function getAveragePower(windowMs) {
  if (samples.length === 0) return null;
  
  const now = Date.now();
  const cutoff = now - windowMs;
  const relevantSamples = samples.filter(s => s.t >= cutoff);
  
  if (relevantSamples.length === 0) return null;
  
  const sum = relevantSamples.reduce((acc, s) => acc + s.p, 0);
  return sum / relevantSamples.length;
}

// Update extended stats display
function updateExtendedStats() {
  // Session energy
  sessionEnergyEl.textContent = sessionEnergyWh.toFixed(2) + " Wh";
  
  // 5 minute average
  const avg5 = getAveragePower(5 * 60 * 1000);
  avg5mEl.textContent = avg5 !== null ? avg5.toFixed(1) + " W" : "-- W";
  
  // 30 minute average
  const avg30 = getAveragePower(30 * 60 * 1000);
  avg30mEl.textContent = avg30 !== null ? avg30.toFixed(1) + " W" : "-- W";
  
  // 1 hour average
  const avg60 = getAveragePower(60 * 60 * 1000);
  avg1hEl.textContent = avg60 !== null ? avg60.toFixed(1) + " W" : "-- W";
}

// Detect power profile based on current power consumption
function detectPowerProfile(powerW, isCharging) {
  powerProfileEl.classList.remove("power-saver", "balanced", "performance", "high-performance");
  
  if (isCharging) {
    // Charging profiles based on charge rate
    if (powerW < 20) {
      profileTextEl.textContent = "Trickle Charge";
      powerProfileEl.classList.add("power-saver");
    } else if (powerW < 35) {
      profileTextEl.textContent = "Normal Charge";
      powerProfileEl.classList.add("balanced");
    } else if (powerW < 50) {
      profileTextEl.textContent = "Fast Charge";
      powerProfileEl.classList.add("performance");
    } else {
      profileTextEl.textContent = "Rapid Charge";
      powerProfileEl.classList.add("high-performance");
    }
  } else {
    // Discharging profiles based on power draw
    if (powerW < 5) {
      profileTextEl.textContent = "Power Saver";
      powerProfileEl.classList.add("power-saver");
    } else if (powerW < 12) {
      profileTextEl.textContent = "Balanced";
      powerProfileEl.classList.add("balanced");
    } else if (powerW < 25) {
      profileTextEl.textContent = "Performance";
      powerProfileEl.classList.add("performance");
    } else {
      profileTextEl.textContent = "High Performance";
      powerProfileEl.classList.add("high-performance");
    }
  }
}

function updateRing(level) {
  const offset = RING_CIRCUMFERENCE * (1 - level);
  ringProgress.style.strokeDashoffset = offset;
  
  // Add low battery warning class
  const root = document.getElementById("root");
  if (level < 0.2) {
    root.classList.add("low-battery");
  } else {
    root.classList.remove("low-battery");
  }
}

function drawChart() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  
  // Set canvas size accounting for device pixel ratio
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  
  const width = rect.width;
  const height = rect.height;
  
  // Get theme-aware colors
  const colors = getChartColors();
  
  ctx.clearRect(0, 0, width, height);

  if (samples.length < 2) {
    // Draw placeholder
    ctx.fillStyle = colors.placeholder;
    ctx.font = "11px 'Outfit', system-ui";
    ctx.textAlign = "center";
    ctx.fillText("Collecting data…", width / 2, height / 2);
    return;
  }

  const padding = { top: 10, right: 10, bottom: 10, left: 10 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const powers = samples.map(s => s.p);
  const minP = Math.min(...powers) * 0.95;
  const maxP = Math.max(...powers) * 1.05;
  const spanP = Math.max(0.1, maxP - minP);

  const minT = samples[0].t;
  const maxT = samples[samples.length - 1].t;
  const spanT = Math.max(1, maxT - minT);

  // Create gradient for the area fill
  const gradient = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
  gradient.addColorStop(0, colors.gradientStart);
  gradient.addColorStop(0.5, colors.gradientMid);
  gradient.addColorStop(1, colors.gradientEnd);

  // Draw area fill
  ctx.beginPath();
  samples.forEach((s, idx) => {
    const x = padding.left + ((s.t - minT) / spanT) * chartWidth;
    const y = height - padding.bottom - ((s.p - minP) / spanP) * chartHeight;

    if (idx === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });

  // Close the path for fill
  const lastX = padding.left + chartWidth;
  const firstX = padding.left;
  ctx.lineTo(lastX, height - padding.bottom);
  ctx.lineTo(firstX, height - padding.bottom);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  // Draw the line
  const lineGradient = ctx.createLinearGradient(0, 0, width, 0);
  lineGradient.addColorStop(0, colors.lineStart);
  lineGradient.addColorStop(0.5, colors.lineMid);
  lineGradient.addColorStop(1, colors.lineEnd);

  ctx.beginPath();
  samples.forEach((s, idx) => {
    const x = padding.left + ((s.t - minT) / spanT) * chartWidth;
    const y = height - padding.bottom - ((s.p - minP) / spanP) * chartHeight;

    if (idx === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });

  ctx.strokeStyle = lineGradient;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();

  // Draw end dot
  const last = samples[samples.length - 1];
  const lastY = height - padding.bottom - ((last.p - minP) / spanP) * chartHeight;
  
  ctx.beginPath();
  ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
  ctx.fillStyle = colors.dotColor;
  ctx.fill();
  
  // Glow effect for dot
  ctx.beginPath();
  ctx.arc(lastX, lastY, 6, 0, Math.PI * 2);
  ctx.fillStyle = colors.dotGlow;
  ctx.fill();
}

// Add this new function to estimate time from power
function estimateTimeSeconds(battery, powerW) {
  if (!powerW || powerW <= 0) return null;
  
  const level = battery.level;
  
  if (battery.charging) {
    // Time to full: remaining capacity / charging power
    const remainingWh = (1 - level) * CAPACITY_WH;
    const hours = remainingWh / powerW;
    return hours * 3600;
  } else {
    // Time to empty: current capacity / discharge power
    const remainingWh = level * CAPACITY_WH;
    const hours = remainingWh / powerW;
    return hours * 3600;
  }
}

// Get export theme colors based on system preference
function getExportThemeColors() {
  if (isDarkMode()) {
    return {
      bgColor: "#0a0a0f",
      gridColor: "rgba(255, 255, 255, 0.05)",
      gridLineColor: "rgba(255, 255, 255, 0.03)",
      textColor: "#e8e8ed",
      labelColor: "#6b7280",
      accentColor: "#00ff87",
      secondaryColor: "#60efff",
      gradientStart: "rgba(0, 255, 135, 0.4)",
      gradientMid: "rgba(96, 239, 255, 0.15)",
      gradientEnd: "rgba(0, 97, 255, 0)",
      lineStart: "#00ff87",
      lineMid: "#60efff",
      lineEnd: "#0061ff",
      dotGlow: "rgba(0, 255, 135, 0.3)",
      statsBoxBg: "rgba(0, 0, 0, 0.6)",
      statsBoxBorder: "rgba(255, 255, 255, 0.1)",
      watermarkColor: "rgba(255, 255, 255, 0.2)",
      statColors: {
        min: "#60efff",
        max: "#ff9f43",
        avg: "#00ff87",
        energy: "#a78bfa"
      }
    };
  } else {
    return {
      bgColor: "#ffffff",
      gridColor: "rgba(0, 0, 0, 0.06)",
      gridLineColor: "rgba(0, 0, 0, 0.04)",
      textColor: "#0f172a",
      labelColor: "#64748b",
      accentColor: "#059669",
      secondaryColor: "#0891b2",
      gradientStart: "rgba(5, 150, 105, 0.25)",
      gradientMid: "rgba(8, 145, 178, 0.12)",
      gradientEnd: "rgba(59, 130, 246, 0)",
      lineStart: "#059669",
      lineMid: "#0891b2",
      lineEnd: "#3b82f6",
      dotGlow: "rgba(5, 150, 105, 0.25)",
      statsBoxBg: "rgba(241, 245, 249, 0.95)",
      statsBoxBorder: "#e2e8f0",
      watermarkColor: "rgba(0, 0, 0, 0.25)",
      statColors: {
        min: "#0891b2",
        max: "#ea580c",
        avg: "#059669",
        energy: "#7c3aed"
      }
    };
  }
}

// Export chart as PNG image
function exportChartImage() {
  if (samples.length < 2) {
    alert("Not enough data to export. Please wait for more samples.");
    return;
  }

  // Create a high-resolution canvas for export
  const exportCanvas = document.createElement("canvas");
  const width = 800;
  const height = 450;
  const dpr = 2; // High DPI for crisp export
  
  exportCanvas.width = width * dpr;
  exportCanvas.height = height * dpr;
  const ectx = exportCanvas.getContext("2d");
  ectx.scale(dpr, dpr);

  // Get theme-aware colors
  const theme = getExportThemeColors();
  const bgColor = theme.bgColor;
  const gridColor = theme.gridColor;
  const textColor = theme.textColor;
  const labelColor = theme.labelColor;
  const accentColor = theme.accentColor;
  const secondaryColor = theme.secondaryColor;

  // Fill background
  ectx.fillStyle = bgColor;
  ectx.fillRect(0, 0, width, height);

  // Draw subtle grid
  ectx.strokeStyle = gridColor;
  ectx.lineWidth = 1;
  for (let x = 0; x < width; x += 40) {
    ectx.beginPath();
    ectx.moveTo(x, 0);
    ectx.lineTo(x, height);
    ectx.stroke();
  }
  for (let y = 0; y < height; y += 40) {
    ectx.beginPath();
    ectx.moveTo(0, y);
    ectx.lineTo(width, y);
    ectx.stroke();
  }

  // Chart area
  const padding = { top: 70, right: 30, bottom: 60, left: 70 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Calculate data bounds
  const powers = samples.map(s => s.p);
  const minP = Math.min(...powers) * 0.9;
  const maxP = Math.max(...powers) * 1.1;
  const spanP = Math.max(0.1, maxP - minP);
  const avgPower = powers.reduce((a, b) => a + b, 0) / powers.length;

  const minT = samples[0].t;
  const maxT = samples[samples.length - 1].t;
  const spanT = Math.max(1, maxT - minT);
  const durationMin = spanT / 1000 / 60;

  // Draw title
  ectx.fillStyle = textColor;
  ectx.font = "bold 24px 'Segoe UI', system-ui, sans-serif";
  ectx.textAlign = "left";
  ectx.fillText("⚡ Kachow Power History", padding.left, 35);

  // Draw subtitle with date
  ectx.fillStyle = labelColor;
  ectx.font = "14px 'Segoe UI', system-ui, sans-serif";
  ectx.fillText(new Date().toLocaleString(), padding.left, 55);

  // Draw Y-axis labels
  ectx.fillStyle = labelColor;
  ectx.font = "12px 'Segoe UI', system-ui, sans-serif";
  ectx.textAlign = "right";
  
  const ySteps = 5;
  for (let i = 0; i <= ySteps; i++) {
    const value = minP + (spanP * i / ySteps);
    const y = padding.top + chartHeight - (chartHeight * i / ySteps);
    ectx.fillText(value.toFixed(1) + " W", padding.left - 10, y + 4);
    
    // Grid line
    ectx.strokeStyle = theme.gridLineColor;
    ectx.beginPath();
    ectx.moveTo(padding.left, y);
    ectx.lineTo(padding.left + chartWidth, y);
    ectx.stroke();
  }

  // Draw X-axis labels
  ectx.textAlign = "center";
  const xSteps = Math.min(6, Math.floor(durationMin));
  for (let i = 0; i <= xSteps; i++) {
    const x = padding.left + (chartWidth * i / xSteps);
    const timeMin = (durationMin * i / xSteps).toFixed(1);
    ectx.fillText(timeMin + "m", x, height - padding.bottom + 25);
  }

  // Axis labels
  ectx.fillStyle = labelColor;
  ectx.font = "13px 'Segoe UI', system-ui, sans-serif";
  ectx.textAlign = "center";
  ectx.fillText("Time (minutes)", padding.left + chartWidth / 2, height - 15);
  
  ectx.save();
  ectx.translate(20, padding.top + chartHeight / 2);
  ectx.rotate(-Math.PI / 2);
  ectx.fillText("Power (Watts)", 0, 0);
  ectx.restore();

  // Draw average line
  const avgY = padding.top + chartHeight - ((avgPower - minP) / spanP) * chartHeight;
  ectx.strokeStyle = secondaryColor;
  ectx.lineWidth = 1.5;
  ectx.setLineDash([8, 4]);
  ectx.beginPath();
  ectx.moveTo(padding.left, avgY);
  ectx.lineTo(padding.left + chartWidth, avgY);
  ectx.stroke();
  ectx.setLineDash([]);

  // Draw average label
  ectx.fillStyle = secondaryColor;
  ectx.font = "11px 'Segoe UI', system-ui, sans-serif";
  ectx.textAlign = "left";
  ectx.fillText(`Avg: ${avgPower.toFixed(1)}W`, padding.left + chartWidth + 5, avgY + 4);

  // Create gradient for area fill
  const gradient = ectx.createLinearGradient(0, padding.top, 0, padding.top + chartHeight);
  gradient.addColorStop(0, theme.gradientStart);
  gradient.addColorStop(0.5, theme.gradientMid);
  gradient.addColorStop(1, theme.gradientEnd);

  // Draw filled area
  ectx.beginPath();
  samples.forEach((s, idx) => {
    const x = padding.left + ((s.t - minT) / spanT) * chartWidth;
    const y = padding.top + chartHeight - ((s.p - minP) / spanP) * chartHeight;
    if (idx === 0) ectx.moveTo(x, y);
    else ectx.lineTo(x, y);
  });
  ectx.lineTo(padding.left + chartWidth, padding.top + chartHeight);
  ectx.lineTo(padding.left, padding.top + chartHeight);
  ectx.closePath();
  ectx.fillStyle = gradient;
  ectx.fill();

  // Draw line
  const lineGradient = ectx.createLinearGradient(padding.left, 0, padding.left + chartWidth, 0);
  lineGradient.addColorStop(0, theme.lineStart);
  lineGradient.addColorStop(0.5, theme.lineMid);
  lineGradient.addColorStop(1, theme.lineEnd);

  ectx.beginPath();
  samples.forEach((s, idx) => {
    const x = padding.left + ((s.t - minT) / spanT) * chartWidth;
    const y = padding.top + chartHeight - ((s.p - minP) / spanP) * chartHeight;
    if (idx === 0) ectx.moveTo(x, y);
    else ectx.lineTo(x, y);
  });
  ectx.strokeStyle = lineGradient;
  ectx.lineWidth = 2.5;
  ectx.lineCap = "round";
  ectx.lineJoin = "round";
  ectx.stroke();

  // Draw end dot
  const lastSample = samples[samples.length - 1];
  const lastX = padding.left + chartWidth;
  const lastY = padding.top + chartHeight - ((lastSample.p - minP) / spanP) * chartHeight;
  
  ectx.beginPath();
  ectx.arc(lastX, lastY, 6, 0, Math.PI * 2);
  ectx.fillStyle = accentColor;
  ectx.fill();
  
  ectx.beginPath();
  ectx.arc(lastX, lastY, 10, 0, Math.PI * 2);
  ectx.fillStyle = theme.dotGlow;
  ectx.fill();

  // Stats box
  const statsX = width - 180;
  const statsY = padding.top + 10;
  const statsW = 150;
  const statsH = 100;

  // Stats background
  ectx.fillStyle = theme.statsBoxBg;
  ectx.strokeStyle = theme.statsBoxBorder;
  ectx.lineWidth = 1;
  ectx.beginPath();
  ectx.roundRect(statsX, statsY, statsW, statsH, 8);
  ectx.fill();
  ectx.stroke();

  // Stats content
  ectx.fillStyle = labelColor;
  ectx.font = "bold 11px 'Segoe UI', system-ui, sans-serif";
  ectx.textAlign = "left";
  ectx.fillText("SESSION STATS", statsX + 12, statsY + 20);

  ectx.font = "12px 'Segoe UI', system-ui, sans-serif";
  const stats = [
    { label: "Min", value: Math.min(...powers).toFixed(1) + " W", color: theme.statColors.min },
    { label: "Max", value: Math.max(...powers).toFixed(1) + " W", color: theme.statColors.max },
    { label: "Avg", value: avgPower.toFixed(1) + " W", color: theme.statColors.avg },
    { label: "Energy", value: sessionEnergyWh.toFixed(2) + " Wh", color: theme.statColors.energy }
  ];

  stats.forEach((stat, i) => {
    const y = statsY + 38 + i * 16;
    ectx.fillStyle = labelColor;
    ectx.fillText(stat.label + ":", statsX + 12, y);
    ectx.fillStyle = stat.color;
    ectx.textAlign = "right";
    ectx.fillText(stat.value, statsX + statsW - 12, y);
    ectx.textAlign = "left";
  });

  // Watermark
  ectx.fillStyle = theme.watermarkColor;
  ectx.font = "11px 'Segoe UI', system-ui, sans-serif";
  ectx.textAlign = "right";
  ectx.fillText("Generated by Kachow ⚡", width - 15, height - 10);

  // Download as PNG
  const link = document.createElement("a");
  link.download = `kachow_${new Date().toISOString().slice(0, 19).replace(/[:-]/g, "")}.png`;
  link.href = exportCanvas.toDataURL("image/png");
  link.click();
}

async function init() {
  // Load compact mode preference first (instant UI)
  await loadCompactMode();
  
  // Load persistent history
  await loadHistory();
  
  // Draw chart with loaded data (if not compact)
  if (samples.length > 0 && !rootEl.classList.contains("compact")) {
    drawChart();
    updateExtendedStats();
  }
  
  // Set up compact mode toggle
  compactToggle.addEventListener("click", toggleCompactMode);
  
  // Listen for system theme changes
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (!rootEl.classList.contains("compact")) {
        drawChart();
      }
    });
  }
  
  if (!("getBattery" in navigator)) {
    statusText.textContent = "Not Supported";
    powerEl.textContent = "N/A";
    levelEl.textContent = "--";
    profileTextEl.textContent = "N/A";
    return;
  }

  // Set up export button
  exportBtn.addEventListener("click", exportChartImage);

  try {
    const battery = await navigator.getBattery();

    function update() {
      const level = battery.level;
      const levelPct = Math.round(level * 100);
      levelEl.textContent = levelPct;
      
      // Update ring progress
      updateRing(level);

      const charging = battery.charging;
      const powerW = estimatePowerW(battery);

      // Update status badge
      statusBadge.classList.remove("charging", "discharging");
      
      if (charging) {
        statusText.textContent = "Charging";
        statusBadge.classList.add("charging");
        timeLabelEl.textContent = "Until Full";
        // Use API time if available, otherwise estimate from power
        const apiTime = battery.chargingTime;
        const estimatedTime = estimateTimeSeconds(battery, powerW);
        timeInfoEl.textContent = formatSeconds(
          isFinite(apiTime) && apiTime > 0 ? apiTime : estimatedTime
        );
      } else {
        statusText.textContent = "On Battery";
        statusBadge.classList.add("discharging");
        timeLabelEl.textContent = "Remaining";
        // Use API time if available, otherwise estimate from power
        const apiTime = battery.dischargingTime;
        const estimatedTime = estimateTimeSeconds(battery, powerW);
        timeInfoEl.textContent = formatSeconds(
          isFinite(apiTime) && apiTime > 0 ? apiTime : estimatedTime
        );
      }

      if (powerW !== null) {
        const powerStr = powerW.toFixed(1) + " W";
        powerEl.textContent = powerStr;
        chartValueEl.textContent = powerStr;
        addSample(powerW);
        
        // Only draw chart and extended stats if not in compact mode
        const isCompact = rootEl.classList.contains("compact");
        if (!isCompact) {
          drawChart();
          updateExtendedStats();
          detectPowerProfile(powerW, charging);
        }
      } else {
        powerEl.textContent = "N/A";
        chartValueEl.textContent = "-- W";
      }
    }

    // Initial update
    update();

    // React to events
    battery.addEventListener("levelchange", update);
    battery.addEventListener("chargingchange", update);
    battery.addEventListener("chargingtimechange", update);
    battery.addEventListener("dischargingtimechange", update);

    // Poll every 5 seconds
    setInterval(update, 5000);
    
    // Redraw chart on resize (only if not compact)
    window.addEventListener("resize", () => {
      if (!rootEl.classList.contains("compact")) {
        drawChart();
      }
    });
    
  } catch (err) {
    console.error(err);
    statusText.textContent = "Error";
    powerEl.textContent = "N/A";
    profileTextEl.textContent = "Error";
  }
}

init();
