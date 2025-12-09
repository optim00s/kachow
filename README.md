# ⚡ Kachow

A sleek Chrome extension that estimates real-time charging and discharging power for your laptop using the Battery API.

![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)
![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-green)

> ⚠️ **Heads up!** Power readings are estimates based on browser-reported battery data — not direct hardware measurements. Think of it as a smart guess, not a lab report. Your mileage may vary! ⚡

## ✨ Features

- **Real-time Power Estimation** — Calculates power draw (in Watts) based on battery level changes and time remaining
- **Battery Ring Progress** — Visual circular indicator showing current charge level
- **Power History Chart** — Live-updating graph tracking power consumption over time
- **Time Estimates** — Shows time until full (charging) or time remaining (on battery)
- **Low Battery Warning** — Visual indicator when battery drops below 20%
- **Beautiful Dark UI** — Modern glassmorphism design with smooth animations

## 📦 Installation

### From Source (Developer Mode)

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked**
5. Select the folder containing this extension
6. Click the extension icon in your toolbar to open the popup

## 🔧 Configuration

The extension is pre-configured for the **ASUS Vivobook X412DA** with a 37 Wh battery. If your laptop has a different battery capacity, edit `popup.js`:

```javascript
// Line 3: Adjust to your battery's capacity in Wh
const CAPACITY_WH = 37;
```

Common Vivobook battery capacities:
- 37 Wh (default)
- 32 Wh
- 29 Wh

## 🎯 How It Works

The extension uses the [Battery Status API](https://developer.mozilla.org/en-US/docs/Web/API/Battery_Status_API) to:

1. **Read battery level** — Current charge percentage
2. **Read charging status** — Whether plugged in or on battery
3. **Read time estimates** — Browser-provided charging/discharging time
4. **Calculate power** — Uses the formula:
   - **Charging:** `Power = (1 - level) × Capacity / Time to Full`
   - **Discharging:** `Power = level × Capacity / Time to Empty`

Data is sampled every 5 seconds and displayed on a real-time chart.

## 📁 Project Structure

```
kachow/
├── manifest.json   # Extension configuration (Manifest V3)
├── popup.html      # Main UI structure
├── popup.css       # Styling with dark theme & animations
├── popup.js        # Battery API logic & chart rendering
└── README.md       # This file
```

## 🖥️ Browser Compatibility

| Browser | Support |
|---------|---------|
| Chrome  | ✅ Full |
| Edge    | ✅ Full |
| Opera   | ✅ Full |
| Firefox | ❌ Battery API disabled for privacy |
| Safari  | ❌ Battery API not supported |

> **Note:** The Battery Status API is available only on Chromium-based browsers. Firefox disabled it due to fingerprinting concerns.

## 📊 UI Overview

| Component | Description |
|-----------|-------------|
| **Battery Ring** | Circular progress showing charge level (0-100%) |
| **Status Badge** | Shows "Charging" or "On Battery" with animated pulse |
| **Power Draw** | Current estimated power in Watts |
| **Time Info** | Time until full (charging) or remaining (discharging) |
| **Power Chart** | Historical power consumption graph |

## ⚠️ Limitations

- Power estimates are **approximations** based on battery API data
- Accuracy depends on the browser's battery time reporting
- Some systems may report `Infinity` for charging/discharging times
- The extension uses a fallback estimation when API times are unavailable

## 🛠️ Development

No build process required — this is a vanilla HTML/CSS/JS extension.

To modify:
1. Edit the source files directly
2. Go to `chrome://extensions/`
3. Click the refresh icon on the extension card
4. Reopen the popup to see changes

## 📄 License

MIT License — feel free to modify and distribute.

---

<p align="center">
  Made with ⚡ Ka-chow!
</p>

