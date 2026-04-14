---
name: Slicer Profiles Reference
description: All default printer, material, and print profiles in DesignCAD slicer with key values
type: reference
---

## Printer Profiles (3 defaults)

| ID | Name | Build Volume | Nozzle | Flavor |
|---|---|---|---|---|
| `duet3d-generic` | Duet3D Generic | 300×300×300 mm | 0.4mm | duet |
| `marlin-generic` | Marlin Generic | 220×220×250 mm | 0.4mm | marlin |
| `klipper-generic` | Klipper Generic | 250×250×300 mm | 0.4mm | klipper |

All use 1.75mm filament. Duet and Klipper support 300°C max nozzle. Marlin 260°C.

### G-code Template Variables (start/end G-code)
`{nozzleTemp}`, `{nozzleTempFirstLayer}`, `{bedTemp}`, `{bedTempFirstLayer}`

Klipper uses macro calls: `START_PRINT BED_TEMP={bedTemp} EXTRUDER_TEMP={nozzleTemp}`

---

## Material Profiles (9 defaults)

| ID | Type | Nozzle °C | Bed °C | Fan | Retract | Density |
|---|---|---|---|---|---|---|
| `pla-generic` | PLA | 210 (215 FL) | 60 (65 FL) | 100% | 0.8mm@45mm/s | 1.24 g/cm³ |
| `abs-generic` | ABS | 240 (245 FL) | 100 (105 FL) | 0–30% | 0.8mm@40mm/s | 1.04 |
| `petg-generic` | PETG | 230 (235 FL) | 80 (85 FL) | 50–70% | 1.0mm@40mm/s | 1.27 |
| `tpu-generic` | TPU | 225 (230 FL) | 50 (55 FL) | 50–70% | 0.5mm@25mm/s | 1.21 |
| `asa-generic` | ASA | 250 (255 FL) | 100 (105 FL) | 0–40% | 0.8mm@40mm/s | 1.07 |
| `nylon-generic` | Nylon | 260 (265 FL) | 80 (85 FL) | 0–30% | 1.2mm@40mm/s | 1.14 |
| `pc-generic` | PC | 270 (275 FL) | 110 (115 FL) | 0–20% | 0.8mm@35mm/s | 1.20 |
| `pva-generic` | PVA | 200 (205 FL) | 55 (60 FL) | 100% | 1.0mm@35mm/s | 1.23 |
| `hips-generic` | HIPS | 235 (240 FL) | 100 (105 FL) | 20–50% | 0.8mm@40mm/s | 1.04 |

All include `flowRate: 1.0`, `retractionZHop: 0.2mm`, `costPerKg` values.

---

## Print Profiles (3 defaults)

| ID | Name | Layer H | Walls | Infill | Speed | Key |
|---|---|---|---|---|---|---|
| `standard-quality` | Standard (0.2mm) | 0.2mm | 3 | 20% grid | 50mm/s | All features default off |
| `draft-quality` | Draft (0.3mm) | 0.3mm | 2 | 15% lines | 70mm/s | Faster, less detail |
| `fine-quality` | Fine (0.1mm) | 0.1mm | 4 | 20% grid | 40mm/s | Adaptive layers ON, monotonic ON, outer wall first ON |

---

## G-code Color Coding (Preview Mode)

| Color | Move Type |
|---|---|
| Orange `#ff8844` | Outer wall |
| Tan `#ffbb66` | Inner wall |
| Blue `#44aaff` | Infill |
| Green `#44ff88` | Top/bottom |
| Magenta `#ff44ff` | Support |
| Gray `#aaaaaa` | Skirt/brim |
| Dark gray `#888888` | Raft |
| Red `#ff4444` | Bridge |
| Light green `#88ff88` | Ironing |
| Dark gray `#666666` | Travel |

Color modes: `type` (above), `speed` (HSL blue→red), `flow` (HSL green→red)
