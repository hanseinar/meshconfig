# MeshConfig

**Browser-based configuration tool for Meshtastic nodes**

MeshConfig connects directly to a Meshtastic node over USB and provides a guided workflow for configuring the node — no app installation, no Python CLI, no backend server required.

🔗 **Live tool:** [hanseinar.github.io/meshconfig](https://hanseinar.github.io/meshconfig/)

---

## Features

- Connects to a Meshtastic node via **WebSerial** (USB cable, Chrome or Edge required)
- Reads and displays current node configuration and identity
- **Two-level configuration editor:**
  - Select a **network profile** (LoRa parameters — must match your mesh)
  - Select a **function** (node role and behaviour)
  - Fine-tune individual fields with inline documentation
- Collapsible **Advanced** sections for less common settings
- **Backup** — export full node config to a YAML file
- **Restore** — import a YAML backup and apply it to a node
- Works entirely offline after first page load

---

## Requirements

| Requirement | Details |
|---|---|
| Browser | Chrome or Edge (WebSerial API required — Firefox and Safari not supported) |
| Connection | USB cable with data support (not charge-only) |
| Firmware | Meshtastic firmware 2.5 or later (tested against 2.7.x) |

---

## How to use

1. Open [hanseinar.github.io/meshconfig](https://hanseinar.github.io/meshconfig/) in Chrome or Edge
2. Connect your Meshtastic node via USB
3. Click **Connect via USB** and select the correct COM port
4. Wait a few seconds — node info and configuration loads automatically
5. Select a **network profile** and a **function** to load a starting configuration
6. Adjust individual fields as needed (hover **?** for help on any field)
7. Click **▶ Apply to Node** to write the configuration

---

## Network profiles

| Profile | Description |
|---|---|
| **Meshtastic Standard** | Default Meshtastic settings. LongFast preset, EU_868. Compatible with factory-default devices. |
| **Vestlandsnett** | Narrow-band network used in Rogaland/Vestlandet, Norway. 62 kHz BW, SF8, CR5, 869.618 MHz. Longer range, lower throughput. |

---

## Function profiles

| Function | Role | Description |
|---|---|---|
| **Client** | `CLIENT` | General-purpose node. Sends, receives and rebroadcasts. Bluetooth active, normal TX power. |
| **Fixed Install** | `CLIENT` | Permanently mounted node (rooftop, mast, solar). Power saving enabled, fixed GPS position. |
| **Repeater** | `ROUTER` | Always awake, always rebroadcasts with priority. **For high, well-positioned infrastructure sites only.** Misuse degrades the mesh. |

> **Note on roles:** `CLIENT` is correct for the vast majority of nodes, including rooftop installations. `ROUTER` should only be used at sites with genuinely excellent line-of-sight coverage. See [Meshtastic role documentation](https://meshtastic.org/blog/choosing-the-right-device-role/) for details.

---

## YAML backup format

Backup files are compatible with the Meshtastic `--export-config` format and can be used as a reference or restored to another node of the same type.

```yaml
# MeshConfig backup — 2025-01-01T12:00:00.000Z
owner:
  longName: My Node
  shortName: MN01
config:
  device:
    role: 0
    nodeInfoBroadcastSecs: 3600
  lora:
    region: 3
    usePreset: true
    modemPreset: 0
    txPower: 20
    hopLimit: 3
  # ...
module_config:
  telemetry:
    deviceUpdateInterval: 3600
```

---

## Architecture

MeshConfig is a fully static site — no build tools, no server, no dependencies to install. All files can be edited directly in the GitHub web UI.

| File | Purpose |
|---|---|
| `index.html` | Application layout and UI structure |
| `style.css` | Styling |
| `app.js` | All application logic — WebSerial, protobuf framing, config editor |
| `meshtastic.proto.json` | Meshtastic protobuf definitions (hand-crafted JSON descriptor for `protobufjs`) |

**External dependency:** [`protobufjs`](https://github.com/protobufjs/protobuf.js) loaded from jsDelivr CDN (pinned to 7.4.0). No other external dependencies.

### Serial protocol

Meshtastic uses a binary framing protocol over serial:

```
[0x94] [0xC3] [MSB length] [LSB length] [protobuf payload...]
```

The read loop uses a sliding window parser to handle debug output from the device and false sync markers robustly.

### Updating for new firmware versions

Meshtastic protobuf field numbers are stable within a major version. If a new firmware major version changes the schema, update `meshtastic.proto.json` by checking the diff at [github.com/meshtastic/protobufs](https://github.com/meshtastic/protobufs) and adjusting field numbers as needed.

---

## Limitations (Phase 1)

- Channel configuration (PSK, channel URL) is not yet supported
- Module config (telemetry intervals, MQTT, detection sensor etc.) is read and backed up but not yet editable in the UI
- Network profiles and function profiles are hardcoded — user-defined profiles are planned for Phase 2
- Meshtastic firmware older than 2.5 is untested

---

## Planned (Phase 2)

- User-defined and editable network profiles (stored in browser localStorage)
- Channel configuration editor
- Module config editor (telemetry, MQTT, detection sensor, canned messages)
- Diff view before restore — show what will change before applying a backup
- Admin key management

---

## License

MIT

---

## Author

Developed by **Hans Einar Steinsland** —  [LA8DKA](https://www.qrz.com/db/LA8DKA), Hjelmeland, Norway.

Active in local emergency preparedness, mesh networking and LoRa/APRS experimentation in the Rogaland region.

---

*Not an official Meshtastic project. For the official web client, see [client.meshtastic.org](https://client.meshtastic.org).*
