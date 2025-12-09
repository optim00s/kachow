// Kachow Background Service Worker
// Handles: Badge updates, Low battery notifications

const BATTERY_THRESHOLDS = [20, 10, 5];
let lastNotifiedThreshold = null;
let lastBatteryLevel = null;

// Update badge with battery percentage
function updateBadge(level, charging) {
  const percent = Math.round(level * 100);
  
  // Set badge text
  chrome.action.setBadgeText({ text: percent.toString() });
  
  // Set badge color based on level and charging status
  let color;
  if (charging) {
    color = "#60efff"; // Cyan for charging
  } else if (percent <= 10) {
    color = "#ff6b6b"; // Red for critical
  } else if (percent <= 20) {
    color = "#ff9f43"; // Orange for low
  } else {
    color = "#00ff87"; // Green for normal
  }
  
  chrome.action.setBadgeBackgroundColor({ color });
}

// Check and send low battery notification
function checkLowBattery(level, charging) {
  // Don't notify if charging
  if (charging) {
    lastNotifiedThreshold = null;
    return;
  }
  
  const percent = Math.round(level * 100);
  
  // Find the current threshold we're at or below
  for (const threshold of BATTERY_THRESHOLDS) {
    if (percent <= threshold) {
      // Only notify if we haven't notified for this threshold yet
      // and we're actually dropping to this level (not starting at it)
      if (lastNotifiedThreshold !== threshold && lastBatteryLevel !== null && lastBatteryLevel > level) {
        sendLowBatteryNotification(percent, threshold);
        lastNotifiedThreshold = threshold;
      }
      break;
    }
  }
  
  // Reset notification state if battery goes above all thresholds
  if (percent > BATTERY_THRESHOLDS[0]) {
    lastNotifiedThreshold = null;
  }
  
  lastBatteryLevel = level;
}

// Send notification
function sendLowBatteryNotification(percent, threshold) {
  let title, message, icon;
  
  if (threshold === 5) {
    title = "⚠️ Critical Battery!";
    message = `Only ${percent}% remaining! Plug in immediately!`;
  } else if (threshold === 10) {
    title = "🔴 Very Low Battery";
    message = `${percent}% remaining. Find a charger soon!`;
  } else {
    title = "🟠 Low Battery";
    message = `${percent}% remaining. Consider plugging in.`;
  }
  
  chrome.notifications.create({
    type: "basic",
    iconUrl: "data:image/svg+xml," + encodeURIComponent(`
      <svg width="128" height="128" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="24" height="24" fill="#0a0a0f"/>
        <path d="M7 2v11h3v9l7-12h-4l4-8H7z" fill="#00ff87"/>
      </svg>
    `),
    title: title,
    message: message,
    priority: 2
  });
}

// Monitor battery status
async function monitorBattery() {
  if (!("getBattery" in navigator)) {
    console.log("Battery API not supported in service worker context");
    return;
  }
  
  try {
    const battery = await navigator.getBattery();
    
    function update() {
      updateBadge(battery.level, battery.charging);
      checkLowBattery(battery.level, battery.charging);
      
      // Store battery state for popup
      chrome.storage.local.set({
        batteryLevel: battery.level,
        batteryCharging: battery.charging,
        lastUpdate: Date.now()
      });
    }
    
    // Initial update
    update();
    
    // Listen for changes
    battery.addEventListener("levelchange", update);
    battery.addEventListener("chargingchange", update);
    
  } catch (err) {
    console.error("Battery monitoring error:", err);
  }
}

// Initialize on install/startup
chrome.runtime.onInstalled.addListener(() => {
  console.log("Kachow installed! ⚡");
  monitorBattery();
});

chrome.runtime.onStartup.addListener(() => {
  monitorBattery();
});

// Also try to start monitoring immediately
monitorBattery();

// Keep service worker alive with periodic alarm
chrome.alarms.create("keepAlive", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "keepAlive") {
    monitorBattery();
  }
});

