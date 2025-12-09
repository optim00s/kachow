// Approx battery capacity for Asus Vivobook X412DA.
// If your specific battery is 32 Wh or 29 Wh, you can change this.
const CAPACITY_WH = 37;

// How many samples to keep in memory (e.g. 5 minutes if interval=1s)
const MAX_SAMPLES = 300;

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

// Each sample = { t: timestamp_ms, p: power_W }
const samples = [];

// Ring circumference for progress calculation
const RING_CIRCUMFERENCE = 2 * Math.PI * 52; // r = 52

// Add this near the top, after MAX_SAMPLES
let lastLevel = null;
let lastLevelTime = null;

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
  samples.push({ t: now, p: powerW });
  if (samples.length > MAX_SAMPLES) {
    samples.shift();
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
  
  ctx.clearRect(0, 0, width, height);

  if (samples.length < 2) {
    // Draw placeholder
    ctx.fillStyle = "#3f3f46";
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
  gradient.addColorStop(0, "rgba(0, 255, 135, 0.3)");
  gradient.addColorStop(0.5, "rgba(96, 239, 255, 0.1)");
  gradient.addColorStop(1, "rgba(0, 97, 255, 0)");

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
  lineGradient.addColorStop(0, "#00ff87");
  lineGradient.addColorStop(0.5, "#60efff");
  lineGradient.addColorStop(1, "#0061ff");

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
  ctx.fillStyle = "#00ff87";
  ctx.fill();
  
  // Glow effect for dot
  ctx.beginPath();
  ctx.arc(lastX, lastY, 6, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0, 255, 135, 0.3)";
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

async function init() {
  if (!("getBattery" in navigator)) {
    statusText.textContent = "Not Supported";
    powerEl.textContent = "N/A";
    levelEl.textContent = "--";
    return;
  }

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
        drawChart();
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
    
    // Redraw chart on resize
    window.addEventListener("resize", drawChart);
    
  } catch (err) {
    console.error(err);
    statusText.textContent = "Error";
    powerEl.textContent = "N/A";
  }
}

init();
