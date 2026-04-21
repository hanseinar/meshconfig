# MeshConfig

**Browser-based configuration tool for Meshtastic nodes**

MeshConfig connects directly to a Meshtastic node over USB and provides a guided workflow for reading, editing and applying configuration — no app installation, no Python CLI, no backend server required.

🔗 **Live tool:** [hanseinar.github.io/meshconfig](https://hanseinar.github.io/meshconfig/)

---

## Features

- Connects to a Meshtastic node via **WebSerial** (USB cable, Chrome or Edge required)
- Reads and displays current node configuration automatically on connect
- **Full configuration editor** covering all Radio and Module sections
- **Template library** — create, edit, export and import templates (stored in browser localStorage)
- **Backup** — export full node config to a YAML file
- **Restore** — import a YAML backup and apply it to a node
- Works entirely offline after first page load
- No build tools, no npm, no local setup — all files editable directly in GitHub's web UI

---

## Requirements

| Requirement | Details |
|---|---|
| Browser | Chrome or Edge (WebSerial API — Firefox and Safari not supported) |
| Connection | USB cable with data support (not charge-only) |
| Firmware | Meshtastic 2.5 or later (tested against 2.7.x stable) |

---

## How to use

### Editing a connected node

1. Open [hanseinar.github.io/meshconfig](https://hanseinar.github.io/meshconfig/) in Chrome or Edge
2. Connect your node via USB and click **Connect via USB**
3. Wait a few seconds — node info and configuration loads automatically into the editor
4. Navigate the tabs to review or adjust settings
5. Optionally load a template as a starting point using the **Load template** bar
6. Click **▶ Apply all to Node** to write the configuration

### Creating and using templates

1. Scroll to **Template Library** — this works with or without a node connected
2. Click **＋ New template** to create from scratch, or **📥 New from connected node** to capture a node's current config
3. Edit all sections, give the template a name and description, click **💾 Save template**
4. When configuring a new node, connect it, then use **Load template** in the editor to overlay the template onto the node's current config

---

## Configuration sections

### Radio Configuration

| Section | Key settings |
|---|---|
| **Device** | Node name (long + short), role, rebroadcast mode, timezone |
| **LoRa** | Region, modem preset, TX power, hop limit, manual BW/SF/CR |
| **Position** | GPS mode, fixed position + coordinates, broadcast interval |
| **Power** | Power saving, sleep timers, Bluetooth timeout |
| **Display** | Screen timeout, flip, compass orientation |
| **Bluetooth** | Enable, pairing mode, fixed PIN |
| **Network** | WiFi SSID/password, NTP server, syslog |
| **Security** | Public key (read-only), private key (behind toggle), serial API |

### Module Configuration

| Section | Purpose |
|---|---|
| **Telemetry** | Device metrics, environment and power sensor intervals |
| **MQTT** | Broker address, topic root, encryption, JSON output |
| **Detection Sensor** | GPIO monitoring, mesh alerts on state change |
| **Canned Messages** | Predefined messages via hardware buttons or rotary encoder |
| **Ext. Notification** | Drive GPIO/buzzer/LED on message receipt |
| **Store & Forward** | Message caching for router nodes |
| **Range Test** | Coverage measurement with periodic test packets |
| **Serial Module** | UART tunnel or protobuf API on serial port |
| **Ambient Lighting** | RGB LED control |

---

## Node roles — quick reference

| Role | When to use |
|---|---|
| **CLIENT** | Almost all nodes — participates fully in mesh routing |
| **CLIENT_MUTE** | Near a stronger node — sends/receives but never rebroadcasts |
| **ROUTER** | High, well-positioned infrastructure sites only — misuse degrades the mesh |
| **TRACKER** | GPS trackers — position only, special sleep behaviour |
| **SENSOR** | Telemetry sensors — environment data only, special sleep behaviour |

> `CLIENT_BASE` was deprecated in firmware 2.7.11 and is effectively replaced by `CLIENT`.
> See [Meshtastic role documentation](https://meshtastic.org/blog/choosing-the-right-device-role/) for details.

---

## Apply transaction

When **Apply all to Node** is pressed, MeshConfig wraps all changes in a settings transaction to prevent repeated reboots:

```
AdminMessage { begin_edit_settings: true }
  → setConfig (device, lora, position, power, display, bluetooth, network, security)
  → setModuleConfig (telemetry, mqtt, detection sensor, …)
  → setFixedPosition  (if fixed position is enabled and coordinates are set)
  → setOwner          (if node name was changed)
AdminMessage { commit_edit_settings: true }
```

---

## Template library

Templates are stored in browser `localStorage` and persist across sessions on the same machine.
To share templates, use **📥 Export** to save as YAML and **📂 Import YAML** to load on another machine.

Example template YAML:

```yaml
_name: Vestlandsnett Fixed Install
_desc: Solar node for Vestlandsnett 62 kHz network
config:
  device:
    role: 0
    nodeInfoBroadcastSecs: 10800
    ledHeartbeatDisabled: true
  lora:
    region: 3
    usePreset: false
    bandwidth: 62
    spreadFactor: 8
    codingRate: 5
    overrideFrequency: 869.618
    txPower: 27
    hopLimit: 4
    sx126xRxBoostedGain: true
  position:
    positionBroadcastSecs: 900
    fixedPosition: true
    gpsMode: 1
  power:
    isPowerSaving: true
    lsSecs: 300
    minWakeSecs: 10
    sdsSecs: 4294967295
    waitBluetoothSecs: 60
moduleConfig:
  telemetry:
    deviceUpdateInterval: 3600
```

---

## Architecture

Fully static — no build tools, no server, no npm.

| File | Purpose |
|---|---|
| `index.html` | Application layout and UI structure |
| `style.css` | Dark theme styling |
| `app.js` | All logic: WebSerial, protobuf framing, editor, templates, backup/restore |
| `meshtastic.proto.json` | Hand-crafted protobuf JSON descriptor for `protobufjs` |

**External dependency:** [`protobufjs`](https://github.com/protobufjs/protobuf.js) 7.4.0 loaded from jsDelivr CDN. No other dependencies.

### Serial framing

```
[0x94] [0xC3] [MSB length] [LSB length] [protobuf payload…]
```

A sliding window parser handles debug output from the device and robustly skips false sync markers in the byte stream.

### Updating for new firmware

Meshtastic protobuf field numbers are stable within a major version. If a future major release changes the schema, update `meshtastic.proto.json` by checking the diff at [github.com/meshtastic/protobufs](https://github.com/meshtastic/protobufs).

---

## Known limitations

- Channel configuration (PSK, channel URL, secondary channels) not yet supported
- Templates stored in `localStorage` only — not synced across machines (use export/import)
- Firmware older than 2.5 is untested

---

## Planned

- Channel configuration editor
- Help text shown on field focus
- Diff view before restore — show what will change before applying a backup
- Admin key management

---

## Author

Developed by **Hans Einar Steinsland** — amateur radio operator [LA8DKA](https://www.qrz.com/db/LA8DKA), Hjelmeland, Norway.

Active in local emergency preparedness, mesh networking and LoRa/APRS experimentation in the Rogaland region.

---

*Not an official Meshtastic project. For the official web client, see [client.meshtastic.org](https://client.meshtastic.org).*
