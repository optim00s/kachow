// Kachow Background Service Worker
// Handles: Badge updates, Low battery notifications

const BATTERY_THRESHOLDS = [20, 10, 5];

// Initialize badge on install
chrome.runtime.onInstalled.addListener(() => {
  console.log("Kachow installed! ⚡");
  chrome.action.setBadgeText({ text: "" });
  chrome.action.setBadgeBackgroundColor({ color: "#00ff87" });
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "batteryUpdate") {
    handleBatteryUpdate(message.level, message.charging);
    sendResponse({ success: true });
  }
  return true;
});

// Handle battery update from popup
async function handleBatteryUpdate(level, charging) {
  const percent = Math.round(level * 100);
  
  // Update badge
  updateBadge(percent, charging);
  
  // Check for low battery notification
  await checkLowBattery(percent, charging);
}

// Update badge with battery percentage
function updateBadge(percent, charging) {
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
async function checkLowBattery(percent, charging) {
  // Don't notify if charging
  if (charging) {
    await chrome.storage.local.set({ lastNotifiedThreshold: null });
    return;
  }
  
  // Get stored state
  const stored = await chrome.storage.local.get(["lastNotifiedThreshold", "lastBatteryPercent"]);
  const lastNotifiedThreshold = stored.lastNotifiedThreshold;
  const lastBatteryPercent = stored.lastBatteryPercent;
  
  // Find the current threshold we're at or below
  for (const threshold of BATTERY_THRESHOLDS) {
    if (percent <= threshold) {
      // Only notify if we haven't notified for this threshold yet
      // and we're actually dropping to this level (not starting at it)
      if (lastNotifiedThreshold !== threshold && lastBatteryPercent !== null && lastBatteryPercent > percent) {
        await sendLowBatteryNotification(percent, threshold);
        await chrome.storage.local.set({ lastNotifiedThreshold: threshold });
      }
      break;
    }
  }
  
  // Reset notification state if battery goes above all thresholds
  if (percent > BATTERY_THRESHOLDS[0]) {
    await chrome.storage.local.set({ lastNotifiedThreshold: null });
  }
  
  // Store current level
  await chrome.storage.local.set({ lastBatteryPercent: percent });
}

// Send notification
async function sendLowBatteryNotification(percent, threshold) {
  let title, message;
  
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
  
  // Create notification with a simple data URL icon
  const iconDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAABZUlEQVR4nO2WMU7DQBBF30pIFBQcgSNQ0HIEjkBJwxE4AiUNR+AIlDQcgZKGI1BS0NJQQBEKQFAglCIvsmXJ2N61d+0UPGkkW/v/nxnvjMNgMPxHANvAGXAHfAIvwG5N25tVnz4DroETYB7znruuzAA+gGNgVLAdA8dFG5oC0G0tgJu8DQHt+GsgmCYE4CpheQ+sCWNXJASgmwVgZu5CAOZ2BZBr3wObOXuJHIBw/xGwkwUQ7t8HPnI2kg4A8BYBPE35LhKWCoBknwqWVbEqgGQ/JiytYlkAYe4F4FEVq1JAeKJ+VbEshOTQrIr1Elq0gWUbWFawKQBWEiTslAAktahgYQAqLQqYU8B3AvAGsBZqKQ7IM/Alr0NdASSXaJa9AGgQwLNCLBOW0wRgOQaOaH4gg3tVrJcCiE/Rx9pV7RBA8rj29lcA8mYDT9pVbQ1A7mwgqmJZALmzgWgaAPnfMRgM/xS/+RQgXqTnFbcAAAAASUVORK5CYII=";
  
  try {
    await chrome.notifications.create(`kachow-battery-${Date.now()}`, {
      type: "basic",
      iconUrl: iconDataUrl,
      title: title,
      message: message,
      priority: 2
    });
  } catch (err) {
    console.log("Could not send notification:", err);
  }
}
