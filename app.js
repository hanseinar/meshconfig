// MeshConfig — app.js  v2
// Hans Einar Steinsland (LA8DKA)
// WebSerial + Meshtastic protocol + Config/Module editor + Template library

// ─── Constants ────────────────────────────────────────────────────────────────

const BAUD_RATE      = 115200;
const START1         = 0x94;
const START2         = 0xc3;
const MAX_PACKET     = 512;
const WANT_CONFIG_ID = 0xdeadbeef;
const LS_TEMPLATES   = 'meshconfig_templates';

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  port: null, reader: null, writer: null, connected: false,
  myInfo: null, nodeInfo: null, nodeInfos: {},
  config: {}, moduleConfig: {}, channels: [], metadata: null, configDone: false,
};

let Root = null, Types = {};
let adminSessionKey = null;  // bytes — obtained from node before sending admin commands
let ROLE_OPTIONS=[], REGION_OPTIONS=[], MODEM_OPTIONS=[],
    GPS_OPTIONS=[], BT_MODE_OPTIONS=[], REBROADCAST_OPTIONS=[];

// ─── Editor state ─────────────────────────────────────────────────────────────
// mode: 'node' (editing connected node) | 'template' (editing a template)

let editorMode       = 'node';
let editorConfig     = {};       // { device:{}, lora:{}, ... }
let editorModule     = {};       // { telemetry:{}, mqtt:{}, ... }
let editorSection    = 'device'; // active tab key
let editorTplId      = null;     // id of template being edited (null = new)

// ─── Radio section definitions ────────────────────────────────────────────────

const RADIO_SECTIONS = {
  device: {
    label:'Device', icon:'⚙️',
    fields: [
      { key:'_longName',  label:'Node Name (long)',   type:'text',   common:true,
        desc:'Full name of this node, shown in app node lists. Max ~40 characters. Example: "Hans Portabel-3".' },
      { key:'_shortName', label:'Node Name (short)',  type:'text',   common:true,
        desc:'Short 2-4 character identifier shown on screen and in compact lists. Example: "HES3".' },
      { key:'role',                  label:'Role',                   type:'select', optKey:'ROLE_OPTIONS',        common:true,
        desc:'Defines how the node participates in the mesh. CLIENT is correct for almost all nodes — it sends, receives and intelligently rebroadcasts. Only use ROUTER at genuinely strategic high sites with excellent coverage.' },
      { key:'nodeInfoBroadcastSecs', label:'Node Info Interval',     type:'number', unit:'s', min:60,             common:true,
        desc:'How often this node announces itself to the mesh. 3600s (1h) is sufficient for fixed nodes. Shorter intervals increase airtime use.' },
      { key:'rebroadcastMode',       label:'Rebroadcast Mode',       type:'select', optKey:'REBROADCAST_OPTIONS', common:false,
        desc:'Controls which packets this node repeats. ALL is the default and correct for most nodes.' },
      { key:'tzdef',                 label:'Timezone (POSIX)',        type:'text',                                 common:false,
        desc:'POSIX timezone string. Norway: CET-1CEST,M3.5.0,M10.5.0/3. Used for display purposes on the node.' },
      { key:'ledHeartbeatDisabled',  label:'Disable LED Heartbeat',  type:'bool',                                 common:false,
        desc:'Disables the periodic LED blink. Useful for covert or battery-sensitive installations.' },
      { key:'isManaged',             label:'Managed Mode',           type:'bool',                                 common:false,
        desc:'⚠️ Locks the device to remote admin commands only. Very difficult to undo without physical access.', warn:true },
    ],
  },
  lora: {
    label:'LoRa', icon:'📻',
    fields: [
      { key:'region',               label:'Region',             type:'select', optKey:'REGION_OPTIONS', common:true,
        desc:'Frequency region — must match every other node in your mesh. EU_868 is correct for Norway/Europe.' },
      { key:'usePreset',            label:'Use Modem Preset',   type:'bool',                            common:true,
        desc:'Use a named preset (e.g. LongFast) rather than manually specifying bandwidth, SF and CR. Recommended for standard Meshtastic networks.' },
      { key:'modemPreset',          label:'Modem Preset',       type:'select', optKey:'MODEM_OPTIONS',  common:true,
        desc:'LongFast is the Meshtastic worldwide default. ~1 kbps, good balance of range and speed.' },
      { key:'txPower',              label:'TX Power',           type:'number', unit:'dBm', min:1, max:30, common:true,
        desc:'Transmit power. 27 dBm is the typical maximum for EU_868. Higher power does not always mean better performance — it can increase collisions on a busy mesh.' },
      { key:'hopLimit',             label:'Hop Limit',          type:'number', min:1, max:7,             common:true,
        desc:'Maximum hops a packet may take. 3 covers most real-world meshes. 7 wastes airtime and should only be used in very sparse, extended networks.' },
      { key:'txEnabled',            label:'TX Enabled',         type:'bool',                            common:true,
        desc:'Enable the transmitter. Disable only for receive-only monitoring or test nodes.' },
      { key:'bandwidth',            label:'Bandwidth',          type:'number', unit:'kHz',              common:false,
        desc:'Manual bandwidth in kHz. Only used when Use Modem Preset is off. Vestlandsnett uses 62 kHz.' },
      { key:'spreadFactor',         label:'Spread Factor',      type:'number', min:7, max:12,            common:false,
        desc:'Manual spreading factor (7–12). Higher = longer range, lower data rate. Vestlandsnett uses SF8.' },
      { key:'codingRate',           label:'Coding Rate',        type:'number', min:5, max:8,             common:false,
        desc:'Forward error correction rate (5=4/5 … 8=4/8). Higher = more redundancy, lower throughput.' },
      { key:'overrideFrequency',    label:'Override Frequency', type:'number', unit:'MHz',              common:false,
        desc:'Override the center frequency in MHz. Vestlandsnett uses 869.618 MHz.' },
      { key:'channelNum',           label:'Channel Number',     type:'number', min:0,                   common:false,
        desc:'Frequency offset channel within the region. Typically 0 when overrideFrequency is set manually.' },
      { key:'sx126xRxBoostedGain',  label:'SX126x Boosted Gain',type:'bool',                           common:false,
        desc:'Enable RX boost on SX126x chips (e.g. EBYTE E22). Slightly improves sensitivity at the cost of a few mA.' },
      { key:'ignoreMqtt',           label:'Ignore MQTT',        type:'bool',                            common:false,
        desc:'Ignore packets that arrived via MQTT bridge. Prevents double-delivery on mixed mesh/MQTT networks.' },
      { key:'overrideDutyCycle',    label:'Override Duty Cycle',type:'bool',                            common:false,
        desc:'⚠️ Bypass the regulatory 1% duty cycle limit. Illegal in EU without special permit.', warn:true },
    ],
  },
  position: {
    label:'Position', icon:'📍',
    fixedFields: [
      { key:'_lat', label:'Latitude',  type:'number', unit:'°', desc:'Decimal degrees. Example: 59.0735 for Stavanger.' },
      { key:'_lon', label:'Longitude', type:'number', unit:'°', desc:'Decimal degrees. Example: 5.7502 for Stavanger.' },
      { key:'_alt', label:'Altitude',  type:'number', unit:'m', desc:'Metres above sea level.' },
    ],
    fields: [
      { key:'gpsMode',                       label:'GPS Mode',             type:'select', optKey:'GPS_OPTIONS', common:true,
        desc:'ENABLED: use onboard GPS. DISABLED: no GPS in use. NOT_PRESENT: board has no GPS hardware.' },
      { key:'fixedPosition',                 label:'Fixed Position',       type:'bool',                        common:true,
        desc:'Use a manually configured fixed position instead of live GPS. Recommended for all permanent installations.' },
      { key:'positionBroadcastSecs',         label:'Broadcast Interval',   type:'number', unit:'s', min:0,     common:true,
        desc:'How often to broadcast position. 900s for mobile, 3600s for fixed. 0 = only broadcast on movement.' },
      { key:'positionBroadcastSmartEnabled', label:'Smart Broadcast',      type:'bool',                        common:false,
        desc:'Only broadcast position when the node has moved significantly. Saves airtime for mobile nodes.' },
      { key:'gpsUpdateInterval',             label:'GPS Update Interval',  type:'number', unit:'s',            common:false,
        desc:'How often to poll the GPS module internally. Does not directly affect broadcast frequency.' },
      { key:'positionFlags',                 label:'Position Flags',       type:'number',                      common:false,
        desc:'Bitmask controlling which fields are included in position broadcasts. 811 includes altitude, speed, and heading.' },
    ],
  },
  power: {
    label:'Power', icon:'🔋',
    fields: [
      { key:'isPowerSaving',               label:'Power Saving',            type:'bool',             common:true,
        desc:'Enable sleep-based power saving. The node will enter light or deep sleep between transmissions. Cannot be disabled for ROUTER role.' },
      { key:'onBatteryShutdownAfterSecs',  label:'Shutdown After (battery)', type:'number', unit:'s', common:true,
        desc:'Shut down after this many seconds on battery. 0 = never. Acts as a safety cutoff for unmonitored nodes.' },
      { key:'waitBluetoothSecs',           label:'Bluetooth Timeout',        type:'number', unit:'s', common:true,
        desc:'Turn off Bluetooth after this many seconds with no connection. Saves power. 60s is a reasonable default.' },
      { key:'sdsSecs',                     label:'Super Deep Sleep After',   type:'number', unit:'s', common:false,
        desc:'Enter super deep sleep (requires reset to wake) after this many seconds. 0 = never. 4294967295 = never (firmware default).' },
      { key:'lsSecs',                      label:'Light Sleep After',        type:'number', unit:'s', common:false,
        desc:'Enter light sleep after this many seconds of inactivity. Node wakes on timer or incoming packets.' },
      { key:'minWakeSecs',                 label:'Min Wake Time',            type:'number', unit:'s', common:false,
        desc:'Minimum time to remain awake after waking. Prevents rapid sleep/wake cycling on solar-powered nodes.' },
    ],
  },
  display: {
    label:'Display', icon:'🖥️',
    fields: [
      { key:'screenOnSecs',      label:'Screen Timeout',      type:'number', unit:'s', common:true,
        desc:'Seconds before screen turns off. 0 = always on. Keep low on battery-powered nodes to save power.' },
      { key:'flipScreen',        label:'Flip Screen',          type:'bool',             common:true,
        desc:'Rotate display 180°. Use when the device is mounted upside-down.' },
      { key:'wakeOnTapOrMotion', label:'Wake on Tap / Motion', type:'bool',             common:false,
        desc:'Wake the screen when the device is tapped or moved. Requires an accelerometer (e.g. T-Beam).' },
      { key:'compassNorthTop',   label:'Compass North Up',     type:'bool',             common:false,
        desc:'Always show North at the top of the compass rather than heading-up.' },
      { key:'headingBold',       label:'Bold Heading Text',    type:'bool',             common:false,
        desc:'Display the heading/channel name in bold on the device screen.' },
    ],
  },
  bluetooth: {
    label:'Bluetooth', icon:'🔵',
    fields: [
      { key:'enabled',  label:'Enabled',       type:'bool',                              common:true,
        desc:'Enable Bluetooth. Required for configuration via the Meshtastic mobile app. Disable on nodes that never need app access.' },
      { key:'mode',     label:'Pairing Mode',  type:'select', optKey:'BT_MODE_OPTIONS',  common:true,
        desc:'Random PIN: new PIN each pairing (inconvenient for fixed nodes). Fixed PIN: use the PIN below. No PIN: less secure but convenient.' },
      { key:'fixedPin', label:'Fixed PIN',     type:'number', min:0, max:999999,          common:true,
        desc:'6-digit PIN for Fixed PIN pairing mode. Default is 123456 — change this for better security.' },
    ],
  },
  network: {
    label:'Network', icon:'🌐',
    fields: [
      { key:'wifiEnabled',   label:'WiFi Enabled',    type:'bool',     common:true,
        desc:'Enable WiFi. ESP32-based devices only. Enables the HTTP API and MQTT without a connected phone.' },
      { key:'wifiSsid',      label:'WiFi SSID',        type:'text',     common:true,  desc:'Name of the WiFi network to connect to.' },
      { key:'wifiPsk',       label:'WiFi Password',    type:'password', common:true,  desc:'WiFi password.' },
      { key:'ntpServer',     label:'NTP Server',       type:'text',     common:false,
        desc:'Time server for synchronisation. meshtastic.pool.ntp.org is the project default.' },
      { key:'ethEnabled',    label:'Ethernet',         type:'bool',     common:false,
        desc:'Enable wired Ethernet. Only supported on specific hardware (e.g. RAK with ETH module).' },
      { key:'rsyslogServer', label:'Syslog Server',    type:'text',     common:false,
        desc:'Send debug log output to a remote syslog server. Useful for monitoring fixed infrastructure nodes.' },
    ],
  },
  security: {
    label:'Security', icon:'🔒',
    fields: [
      { key:'publicKey',           label:'Public Key',              type:'readonly', common:true,
        desc:'The node\'s public identity key. Safe to share. Other nodes use this to verify the node\'s identity when using PKI-encrypted admin.' },
      { key:'privateKey',          label:'Private Key',             type:'private',  common:true,
        desc:'Secret key. Never share this. Only reveal here if you need to back it up or restore it to a replacement device.' },
      { key:'serialEnabled',       label:'Serial API Enabled',      type:'bool',     common:true,
        desc:'Allow configuration via the USB serial port. Must be enabled for MeshConfig to communicate with the node.' },
      { key:'adminChannelEnabled', label:'Admin via Mesh Channel',  type:'bool',     common:false,
        desc:'⚠️ Allow admin commands over the mesh channel. Only enable if you need remote admin via mesh and understand the security implications.', warn:true },
      { key:'isManaged',           label:'Managed Mode',            type:'bool',     common:false,
        desc:'⚠️ Locks the device to remote admin commands only. Extremely difficult to undo without physical access.', warn:true },
    ],
  },
};

// ─── Module section definitions ───────────────────────────────────────────────

const MODULE_SECTIONS = {
  telemetry: {
    label:'Telemetry', icon:'📊',
    fields: [
      { key:'deviceUpdateInterval',          label:'Device Metrics Interval',     type:'number', unit:'s', common:true,
        desc:'How often to broadcast device metrics (battery, uptime, channel utilization) to the mesh. 3600s (1h) is typical for fixed nodes.' },
      { key:'environmentUpdateInterval',     label:'Environment Interval',        type:'number', unit:'s', common:true,
        desc:'How often to broadcast environment sensor data (temperature, humidity, etc.). 0 = disabled.' },
      { key:'environmentMeasurementEnabled', label:'Environment Sensor',          type:'bool',             common:true,
        desc:'Enable environment sensor readings (requires supported sensor hardware: BME280, SHT31, etc.).' },
      { key:'environmentDisplayFahrenheit',  label:'Fahrenheit',                  type:'bool',             common:false,
        desc:'Display temperature in Fahrenheit instead of Celsius on the device screen.' },
      { key:'airQualityEnabled',             label:'Air Quality Sensor',          type:'bool',             common:false,
        desc:'Enable air quality (CO2/PM) sensor readings. Requires supported hardware.' },
      { key:'airQualityInterval',            label:'Air Quality Interval',        type:'number', unit:'s', common:false,
        desc:'How often to broadcast air quality readings.' },
      { key:'powerMeasurementEnabled',       label:'Power Sensor',                type:'bool',             common:false,
        desc:'Enable power sensor readings (voltage, current, via INA219 or similar).' },
      { key:'powerUpdateInterval',           label:'Power Sensor Interval',       type:'number', unit:'s', common:false,
        desc:'How often to broadcast power sensor readings.' },
    ],
  },
  mqtt: {
    label:'MQTT', icon:'☁️',
    fields: [
      { key:'enabled',              label:'Enabled',                 type:'bool',     common:true,
        desc:'Enable MQTT gateway. The node will forward mesh packets to/from the MQTT broker when connected to WiFi.' },
      { key:'address',              label:'Broker Address',          type:'text',     common:true,
        desc:'MQTT broker hostname or IP. Default: mqtt.meshtastic.org (public broker).' },
      { key:'username',             label:'Username',                type:'text',     common:true,  desc:'MQTT login username. meshdev for the public broker.' },
      { key:'password',             label:'Password',                type:'password', common:true,  desc:'MQTT login password. large4cats for the public broker.' },
      { key:'root',                 label:'Root Topic',              type:'text',     common:true,
        desc:'MQTT topic root. Example: msh/EU_868. All messages will be published under this prefix.' },
      { key:'encryptionEnabled',    label:'Encryption',              type:'bool',     common:true,
        desc:'Encrypt packets before publishing to MQTT. Required if the mesh uses encrypted channels.' },
      { key:'jsonEnabled',          label:'JSON Format',             type:'bool',     common:false,
        desc:'Also publish decoded packets as JSON (in addition to binary). Useful for integrations.' },
      { key:'tlsEnabled',           label:'TLS/SSL',                 type:'bool',     common:false,
        desc:'Use TLS encryption for the MQTT connection. Required by some brokers.' },
      { key:'proxyToClientEnabled', label:'Proxy via Phone',         type:'bool',     common:false,
        desc:'Route MQTT traffic through the connected phone app instead of direct WiFi. For nodes without WiFi.' },
    ],
  },
  detectionSensor: {
    label:'Detection Sensor', icon:'🚨',
    fields: [
      { key:'enabled',                label:'Enabled',               type:'bool',                                  common:true,
        desc:'Enable the Detection Sensor module. Monitors a GPIO pin and sends alerts when its state changes.' },
      { key:'monitorPin',             label:'Monitor Pin',           type:'number',                                common:true,
        desc:'GPIO pin number to monitor. Check your hardware schematic for available pins.' },
      { key:'name',                   label:'Sensor Name',           type:'text',                                  common:true,
        desc:'Name broadcast in alert messages. Example: "Door sensor" or "PIR motion".' },
      { key:'minimumBroadcastSecs',   label:'Min Broadcast Interval',type:'number', unit:'s',                     common:true,
        desc:'Minimum seconds between alerts on repeated state changes. Prevents flooding the mesh.' },
      { key:'stateBroadcastSecs',     label:'Status Heartbeat',      type:'number', unit:'s',                     common:false,
        desc:'How often to broadcast current state even without changes. 0 = only on change.' },
      { key:'detectionTriggeredHigh', label:'Triggered on HIGH',     type:'bool',                                  common:false,
        desc:'Send alert when pin goes HIGH. Uncheck for LOW-triggered sensors (e.g. normally-closed reed switch).' },
      { key:'usePullup',              label:'Use Pull-up',           type:'bool',                                  common:false,
        desc:'Enable internal pull-up resistor on the monitor pin.' },
      { key:'sendBell',               label:'Send Bell',             type:'bool',                                  common:false,
        desc:'Include a bell character in alert messages to trigger audio notification on receiving devices.' },
    ],
  },
  cannedMessage: {
    label:'Canned Messages', icon:'💬',
    fields: [
      { key:'enabled',          label:'Enabled',           type:'bool',   common:true,
        desc:'Enable the Canned Messages module. Allows sending predefined messages using hardware buttons or a rotary encoder.' },
      { key:'allowInputSource', label:'Input Source',      type:'text',   common:true,
        desc:'Name of the input source to use. Leave empty to accept any input device.' },
      { key:'sendBell',         label:'Send Bell',         type:'bool',   common:false,
        desc:'Append a bell character to sent canned messages.' },
    ],
  },
  externalNotification: {
    label:'Ext. Notification', icon:'🔔',
    fields: [
      { key:'enabled',      label:'Enabled',            type:'bool',             common:true,
        desc:'Enable the External Notification module. Drives a GPIO pin (buzzer, LED, relay) when messages or alerts arrive.' },
      { key:'output',       label:'Output GPIO Pin',    type:'number',            common:true,
        desc:'GPIO pin to drive for notifications. Check your hardware schematic.' },
      { key:'active',       label:'Active HIGH',        type:'bool',             common:true,
        desc:'Output is HIGH when active. Uncheck for active-LOW circuits (e.g. some relay modules).' },
      { key:'alertMessage', label:'Alert on Message',   type:'bool',             common:true,
        desc:'Trigger notification when a text message is received.' },
      { key:'alertBell',    label:'Alert on Bell',      type:'bool',             common:true,
        desc:'Trigger notification when a message with a bell character is received.' },
      { key:'outputMs',     label:'Output Duration',    type:'number', unit:'ms', common:false,
        desc:'How long to activate the output for each notification, in milliseconds.' },
      { key:'usePwm',       label:'Use PWM',            type:'bool',             common:false,
        desc:'Drive the output pin with PWM (for buzzers that require an AC signal).' },
    ],
  },
  storeForward: {
    label:'Store & Forward', icon:'📦',
    fields: [
      { key:'enabled',             label:'Enabled',          type:'bool',   common:true,
        desc:'Enable Store & Forward. This node will cache messages and replay them to nodes that re-enter range. Requires significant RAM — primarily for router/repeater nodes.' },
      { key:'heartbeat',           label:'Heartbeat',        type:'bool',   common:false,
        desc:'Periodically announce that Store & Forward is available on this node.' },
      { key:'records',             label:'Max Records',      type:'number', common:false,
        desc:'Maximum number of messages to cache. Higher values use more RAM.' },
      { key:'historyReturnMax',    label:'History Return Max',type:'number', common:false,
        desc:'Maximum number of cached messages to send when a node requests history.' },
      { key:'historyReturnWindow', label:'History Window',   type:'number', unit:'s', common:false,
        desc:'How far back in time to include when replaying cached messages.' },
    ],
  },
  rangeTest: {
    label:'Range Test', icon:'📏',
    fields: [
      { key:'enabled', label:'Enabled',       type:'bool',   common:true,
        desc:'Enable Range Test module. Used for measuring radio coverage by sending periodic test packets.' },
      { key:'sender',  label:'Send Interval', type:'number', unit:'s', common:true,
        desc:'How often to broadcast a range test packet. 0 = receiver only (do not transmit test packets).' },
      { key:'save',    label:'Save to CSV',   type:'bool',   common:false,
        desc:'Save received range test results to a CSV file on the device (ESP32 only, requires filesystem).' },
    ],
  },
  serial: {
    label:'Serial Module', icon:'🔌',
    fields: [
      { key:'enabled', label:'Enabled',    type:'bool',   common:true,
        desc:'Enable the Serial module. Allows another device (Arduino, RPi) to send/receive messages via UART.' },
      { key:'echo',    label:'Echo',       type:'bool',   common:false,
        desc:'Echo all received serial data back out the serial port.' },
      { key:'baud',    label:'Baud Rate',  type:'number', common:false,
        desc:'Serial baud rate for the UART connection. Must match the connected device.' },
      { key:'mode',    label:'Mode',       type:'number', common:false,
        desc:'0=DEFAULT/SIMPLE, 1=TEXTMSG, 2=PROTO. PROTO exposes the full protobuf API on the serial port.' },
      { key:'timeout', label:'Timeout',    type:'number', unit:'ms', common:false,
        desc:'Milliseconds to wait before treating incoming serial data as a complete packet.' },
    ],
  },
  ambientLighting: {
    label:'Ambient Lighting', icon:'💡',
    fields: [
      { key:'ledState', label:'LED On',   type:'bool',   common:true,  desc:'Enable the ambient LED.' },
      { key:'current',  label:'Current',  type:'number', common:true,  desc:'LED drive current (0–31). Higher = brighter.' },
      { key:'red',      label:'Red',      type:'number', min:0, max:255, common:true,  desc:'Red channel (0–255).' },
      { key:'green',    label:'Green',    type:'number', min:0, max:255, common:true,  desc:'Green channel (0–255).' },
      { key:'blue',     label:'Blue',     type:'number', min:0, max:255, common:true,  desc:'Blue channel (0–255).' },
    ],
  },
};

// ─── Template library (localStorage) ─────────────────────────────────────────

function tplLoad()         { try { return JSON.parse(localStorage.getItem(LS_TEMPLATES)||'[]'); } catch{return[];} }
function tplSave(list)     { localStorage.setItem(LS_TEMPLATES, JSON.stringify(list)); }
function tplGet(id)        { return tplLoad().find(t=>t.id===id)||null; }
function tplDelete(id)     { tplSave(tplLoad().filter(t=>t.id!==id)); renderTemplateList(); }

function tplCreate(name, desc, cfg, mod) {
  const t = { id: Date.now().toString(36)+Math.random().toString(36).slice(2,6),
    name, desc, created: new Date().toISOString(), modified: new Date().toISOString(),
    config: JSON.parse(JSON.stringify(cfg)), moduleConfig: JSON.parse(JSON.stringify(mod)) };
  const list = tplLoad(); list.push(t); tplSave(list); return t;
}

function tplUpdate(id, name, desc, cfg, mod) {
  const list = tplLoad();
  const i = list.findIndex(t=>t.id===id);
  if (i<0) return;
  list[i] = { ...list[i], name, desc, modified: new Date().toISOString(),
    config: JSON.parse(JSON.stringify(cfg)), moduleConfig: JSON.parse(JSON.stringify(mod)) };
  tplSave(list);
}

// ─── DOM ──────────────────────────────────────────────────────────────────────

const btnConnect       = document.getElementById('btn-connect');
const statusEl         = document.getElementById('connection-status');
const protoStatusEl    = document.getElementById('proto-status');
const sectionNodeInfo  = document.getElementById('section-nodeinfo');
const sectionEditor    = document.getElementById('section-editor');
const sectionTemplates = document.getElementById('section-templates');
const sectionBackup    = document.getElementById('section-backup');
const btnBackup        = document.getElementById('btn-backup');
const inputRestore     = document.getElementById('input-restore');
const btnRestore       = document.getElementById('btn-restore');

// ─── Proto loading ────────────────────────────────────────────────────────────

async function loadProto() {
  try {
    const resp = await fetch('meshtastic.proto.json');
    if (!resp.ok) throw new Error('HTTP '+resp.status);
    Root = protobuf.Root.fromJSON(await resp.json());
    Types.ToRadio      = Root.lookupType('meshtastic.ToRadio');
    Types.FromRadio    = Root.lookupType('meshtastic.FromRadio');
    Types.AdminMessage = Root.lookupType('meshtastic.AdminMessage');
    Types.Config       = Root.lookupType('meshtastic.Config');
    Types.ModuleConfig = Root.lookupType('meshtastic.ModuleConfig');
    Types.Position     = Root.lookupType('meshtastic.Position');

    const mk = (e,d) => Object.entries(e.values).map(([k,v])=>({value:v,label:k,desc:d?.[k]||''}));
    ROLE_OPTIONS = mk(Root.lookupEnum('meshtastic.Config.DeviceConfig.Role'),{
      CLIENT:'General purpose — sends, receives and rebroadcasts. Correct for almost all nodes.',
      CLIENT_MUTE:'Sends and receives but never rebroadcasts. Use near a stronger node to reduce airtime.',
      ROUTER:'Always rebroadcasts with priority. Only for high, well-positioned infrastructure sites.',
      ROUTER_CLIENT:'Deprecated since 2.3.15.',
      REPEATER:'Rebroadcasts everything blindly. Rarely the right choice — can cause congestion.',
      TRACKER:'GPS tracker — sends position only, with special sleep behaviour.',
      SENSOR:'Telemetry sensor — sends environment data only, with special sleep behaviour.',
      TAK:'TAK/ATAK compatible mode for tactical applications.',
      CLIENT_HIDDEN:'Like CLIENT but hidden from the node list (stealth mode).',
      LOST_AND_FOUND:'Lost-and-found beacon mode.',
      TAK_TRACKER:'TAK tracker combined mode.',
    });
    REGION_OPTIONS    = mk(Root.lookupEnum('meshtastic.Config.LoRaConfig.RegionCode'), null);
    MODEM_OPTIONS     = mk(Root.lookupEnum('meshtastic.Config.LoRaConfig.ModemPreset'),{
      LONG_FAST:'Range ~1km urban, ~10km LOS. Best balance — Meshtastic default. ~1.07 kbps.',
      LONG_SLOW:'Longer range, slower. ~0.18 kbps.',
      VERY_LONG_SLOW:'Maximum range, very slow. Use sparingly — heavy airtime use.',
      MEDIUM_SLOW:'Medium range, slower.',
      MEDIUM_FAST:'Medium range, faster.',
      SHORT_SLOW:'Short range, slower.',
      SHORT_FAST:'Short range, fastest. ~10.94 kbps.',
      LONG_MODERATE:'Long range, moderate speed.',
    });
    GPS_OPTIONS       = mk(Root.lookupEnum('meshtastic.Config.PositionConfig.GpsMode'),{
      DISABLED:'GPS disabled. No position data.',
      ENABLED:'GPS enabled. Use onboard GPS receiver.',
      NOT_PRESENT:'No GPS hardware on this board.',
    });
    BT_MODE_OPTIONS   = mk(Root.lookupEnum('meshtastic.Config.BluetoothConfig.PairingMode'),{
      RANDOM_PIN:'New random PIN each time the device is paired.',
      FIXED_PIN:'Use the fixed PIN defined below. Recommended for permanent installs.',
      NO_PIN:'No PIN required. Convenient but less secure.',
    });
    REBROADCAST_OPTIONS = mk(Root.lookupEnum('meshtastic.Config.DeviceConfig.RebroadcastMode'),{
      ALL:'Repeat all packets (default).',
      ALL_SKIP_DECODING:'Repeat without decoding. Slightly faster, no SNR-based filtering.',
      LOCAL_ONLY:'Only repeat packets from directly heard nodes.',
      KNOWN_ONLY:'Only repeat packets from nodes in this node\'s database.',
      NONE:'Do not repeat any packets.',
    });

    protoStatusEl.textContent = 'Proto: loaded';
    protoStatusEl.className   = 'status status--connected';
    renderTemplateList();
  } catch(err) {
    protoStatusEl.textContent = 'Proto: FAILED';
    protoStatusEl.className   = 'status status--disconnected';
    console.error('Proto load failed:', err);
  }
}

// ─── Connection ───────────────────────────────────────────────────────────────

btnConnect.addEventListener('click', async () => { state.connected ? await disconnect() : await connect(); });

async function connect() {
  if (!('serial' in navigator)) { alert('WebSerial requires Chrome or Edge.'); return; }
  if (!Root) { alert('Proto not loaded — reload the page.'); return; }
  setStatus('connecting');
  try {
    state.port = await navigator.serial.requestPort();
    await state.port.open({ baudRate: BAUD_RATE });
    state.writer = state.port.writable.getWriter();
    state.connected = true;
    setStatus('connected');
    btnConnect.textContent = 'Disconnect';
    sectionNodeInfo.classList.remove('hidden');
    sectionEditor.classList.remove('hidden');
    sectionBackup.classList.remove('hidden');
    updateEditorBanner('Reading configuration from node…');
    renderEditorTabs();
    await sendWantConfig();
    readLoop().catch(err => { console.warn('Read loop ended:', err.message); if (state.connected) disconnect(); });
    // Fallback: load editor after 8s even if configCompleteId never arrives
    setTimeout(() => {
      if (state.connected && !state.configDone && Object.keys(state.config).length > 0) {
        console.log('configComplete not received — loading editor with available data');
        state.configDone = true;
        loadNodeIntoEditor();
      }
    }, 8000);
  } catch(err) {
    console.error('Connection failed:', err);
    setStatus('disconnected');
    try { if (state.port) await state.port.close(); } catch(_) {}
    state.port = null;
    alert('Could not connect: '+err.message);
  }
}

async function disconnect() {
  state.connected = false;
  try { if (state.reader) await state.reader.cancel(); } catch(_) {}
  try { if (state.writer) await state.writer.close(); } catch(_) {}
  try { if (state.port)   await state.port.close();   } catch(_) {}
  state.reader = state.writer = state.port = null;
  state.myInfo = state.nodeInfo = state.metadata = null;
  state.config = {}; state.moduleConfig = {}; state.channels = [];
  state.nodeInfos = {}; state.configDone = false;
  adminSessionKey = null;
  setStatus('disconnected');
  btnConnect.textContent = 'Connect via USB';
  sectionNodeInfo.classList.add('hidden');
  sectionEditor.classList.add('hidden');
  sectionBackup.classList.add('hidden');
  ['info-name','info-shortname','info-hw','info-fw','info-id','info-role','info-region']
    .forEach(id => document.getElementById(id).textContent = '—');
  const banner = document.getElementById('editor-banner');
  if (banner) { banner.textContent = 'Connect a node to edit its configuration.'; banner.className = 'editor-banner editor-banner--info'; }
}

// ─── Serial write ─────────────────────────────────────────────────────────────

async function writePacket(msg) {
  if (!state.writer) { console.error('writePacket: no writer!'); return; }
  const payload = Types.ToRadio.encode(msg).finish();
  console.log('writePacket:', payload.length, 'bytes, payload[0..3]:', Array.from(payload.slice(0,4)).map(b=>b.toString(16)).join(' '));
  if (payload.length > MAX_PACKET) { console.error('Packet too large'); return; }
  const frame = new Uint8Array(4 + payload.length);
  frame[0]=START1; frame[1]=START2;
  frame[2]=(payload.length>>8)&0xff; frame[3]=payload.length&0xff;
  frame.set(payload, 4);
  await state.writer.write(frame);
}

// ADMIN_APP portnum = 68
// Admin messages must be sent as MeshPackets with portNum=68,
// NOT via ToRadio.admin (field 4) which is ignored in firmware 2.7+
// Request a session key from the node (required by firmware 2.7+ for admin)
async function ensureSessionKey() {
  if (adminSessionKey) return true;
  console.log('Requesting session key from node...');
  const CT = Root.lookupEnum('meshtastic.AdminMessage.ConfigType');
  const req = Types.AdminMessage.create({ getConfigRequest: CT.values.SESSIONKEY_CONFIG });
  await sendAdminRaw(req, true);
  // Wait up to 3s for node to respond
  for (let i = 0; i < 30; i++) {
    await sleep(100);
    if (adminSessionKey) { console.log('Session key received'); return true; }
  }
  console.warn('Session key not received — proceeding without it');
  return false;
}

async function sendAdmin(adminMsg) {
  // Include session key if we have one
  if (adminSessionKey) {
    adminMsg.sessionPasskey = adminSessionKey;
  }
  await sendAdminRaw(adminMsg);
}

async function sendAdminRaw(adminMsg, wantResponse=false) {
  const adminBytes = Types.AdminMessage.encode(adminMsg).finish();
  const Data    = Root.lookupType('meshtastic.Data');
  const MeshPkt = Root.lookupType('meshtastic.MeshPacket');
  const nodeNum = state.myInfo?.myNodeNum || 0xffffffff;
  const packet  = MeshPkt.create({
    to:      nodeNum,
    from:    nodeNum,    // must match myNodeNum — firmware uses this for local auth
    decoded: Data.create({ portnum: 6, payload: adminBytes, wantResponse }),
    id:      (Math.floor(Math.random() * 0x7fffffff) + 1) >>> 0,
    wantAck: false,
    channel: 0,
  });
  console.log('sendAdmin to:', nodeNum.toString(16), 'variant:', Object.keys(adminMsg).filter(k=>adminMsg[k]!==undefined&&k!=='payloadVariant'&&k!=='sessionPasskey'));
  await writePacket(Types.ToRadio.create({ packet }));
}

async function sendWantConfig() {
  await writePacket(Types.ToRadio.create({ wantConfigId: WANT_CONFIG_ID }));
}

// ─── Read loop — sliding window ───────────────────────────────────────────────

async function readLoop() {
  state.reader = state.port.readable.getReader();
  let rxBuf=new Uint8Array(8192), rxLen=0;
  const append  = b => { if(rxLen+b.length>rxBuf.length){const n=new Uint8Array(Math.max(rxBuf.length*2,rxLen+b.length+1024));n.set(rxBuf.subarray(0,rxLen));rxBuf=n;} rxBuf.set(b,rxLen); rxLen+=b.length; };
  const consume = n => { rxBuf.copyWithin(0,n); rxLen-=n; };
  try {
    while (state.connected) {
      const {value,done} = await state.reader.read();
      if (done) break;
      if (!value?.length) continue;
      append(value);
      let progress=true;
      while (progress) {
        progress=false;
        let sp=-1;
        for(let i=0;i<rxLen-1;i++){if(rxBuf[i]===START1&&rxBuf[i+1]===START2){sp=i;break;}}
        if(sp<0){if(rxLen>1)consume(rxLen-1);break;}
        if(sp>0){consume(sp);progress=true;continue;}
        if(rxLen<4)break;
        const pLen=(rxBuf[2]<<8)|rxBuf[3];
        if(pLen===0||pLen>MAX_PACKET){consume(1);progress=true;continue;}
        if(rxLen<4+pLen)break;
        const payload=rxBuf.slice(4,4+pLen);
        let ok=false;
        try{dispatchFromRadio(Types.FromRadio.decode(payload));ok=true;}
        catch(e){console.debug('Skip sync:',e.message.substring(0,60));}
        consume(ok?4+pLen:1); progress=true;
      }
    }
  } finally { try{state.reader.releaseLock();}catch(_){} state.reader=null; }
}

// ─── FromRadio dispatch ───────────────────────────────────────────────────────

function dispatchFromRadio(msg) {
  const v=msg.payloadVariant;
  if(!v){console.debug('FromRadio no variant num='+msg.num);return;}
  console.log('FromRadio:',v);
  switch(v){
    case 'myInfo':           handleMyInfo(msg.myInfo);                  break;
    case 'nodeInfo':         handleNodeInfo(msg.nodeInfo);              break;
    case 'config':           handleConfig(msg.config);                  break;
    case 'moduleConfig':     handleModuleConfig(msg.moduleConfig);      break;
    case 'channel':          handleChannel(msg.channel);                break;
    case 'deviceMetadata':   handleDeviceMetadata(msg.deviceMetadata);  break;
    case 'configCompleteId': handleConfigComplete();                    break;
    case 'deviceUiConfig':   break;
    case 'packet':           handleIncomingPacket(msg.packet);              break;
    case 'logRecord':        console.debug('[Node]',msg.logRecord?.message); break;
    default:                 console.debug('FromRadio unhandled:',v);   break;
  }
}

// ─── Config handlers ──────────────────────────────────────────────────────────

function handleMyInfo(m) {
  state.myInfo=m;
  document.getElementById('info-id').textContent=m.myNodeNum?'!'+m.myNodeNum.toString(16).padStart(8,'0'):'—';
  updateOwnNodeDisplay();
}
function handleNodeInfo(n) { state.nodeInfos[n.num]=n; updateOwnNodeDisplay(); }
function updateOwnNodeDisplay() {
  if(!state.myInfo||!state.nodeInfos)return;
  const own=state.nodeInfos[state.myInfo.myNodeNum];
  if(!own)return;
  state.nodeInfo=own;
  const u=own.user||{};
  document.getElementById('info-name').textContent      = u.longName  ||'—';
  document.getElementById('info-shortname').textContent = u.shortName ||'—';
  document.getElementById('info-hw').textContent        = u.hwModel!==undefined?String(u.hwModel):'—';
  document.getElementById('info-role').textContent      = labelFor(ROLE_OPTIONS,u.role);
}
// Handle incoming MeshPackets (admin responses, session key etc.)
function handleIncomingPacket(packet) {
  if (!packet?.decoded) return;
  if (packet.decoded.portnum !== 6) return;   // ADMIN_APP = 6
  try {
    const adminResp = Types.AdminMessage.decode(packet.decoded.payload);
    console.log('Admin response received, keys:', Object.keys(adminResp).filter(k => adminResp[k]));
    if (adminResp.sessionPasskey && adminResp.sessionPasskey.length > 0) {
      adminSessionKey = adminResp.sessionPasskey;
      console.log('Session key obtained:', adminSessionKey.length, 'bytes');
    }
  } catch(e) {
    console.debug('Admin response decode error:', e.message);
  }
}

function handleConfig(config) {
  const t=config.payloadVariant;
  // Normalize enum strings to numbers so select fields match correctly
  state.config[t] = normalizeEnums(config[t]);
  if(t==='lora'&&config.lora)
    document.getElementById('info-region').textContent=labelFor(REGION_OPTIONS,config.lora.region);
  if (!state.configDone) {
    const n = Object.keys(state.config).length + Object.keys(state.moduleConfig).length;
    const banner = document.getElementById('editor-banner');
    if (banner && (banner.classList.contains('editor-banner--info') || banner.textContent.startsWith('Reading')))
      updateEditorBanner(`Reading configuration… (${n} sections received)`);
  }
}

// Convert any enum string values ("EU_868", "LONG_SLOW" etc.) to their numeric equivalents
// protobufjs sometimes decodes enums as strings depending on config
function normalizeEnums(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const result = {};
  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === 'string' && Root) {
      // Try to find a matching enum value across all known enums
      const num = resolveEnumString(val);
      result[key] = (num !== null) ? num : val;
    } else if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      result[key] = normalizeEnums(val);
    } else {
      result[key] = val;
    }
  }
  return result;
}

function resolveEnumString(str) {
  // Check all option lists
  const allOpts = [...ROLE_OPTIONS,...REGION_OPTIONS,...MODEM_OPTIONS,...GPS_OPTIONS,...BT_MODE_OPTIONS,...REBROADCAST_OPTIONS];
  const match = allOpts.find(o => o.label === str);
  return match ? match.value : null;
}
function handleModuleConfig(mc) { const t=mc.payloadVariant; state.moduleConfig[t]=mc[t]; }
function handleChannel(ch)      { state.channels[ch.index]=ch; }
function handleDeviceMetadata(md) {
  state.metadata=md;
  document.getElementById('info-fw').textContent=md.firmwareVersion||'—';
}
function handleConfigComplete() {
  state.configDone=true;
  console.log('Config complete');
  // Load into editor if in node mode
  if (editorMode==='node') { loadNodeIntoEditor(); }
}
function labelFor(opts,val) { const o=opts.find(o=>o.value===val); return o?o.label:(val!==undefined?String(val):'—'); }

// ─── Editor — load data ───────────────────────────────────────────────────────

function loadNodeIntoEditor() {
  editorConfig  = JSON.parse(JSON.stringify(state.config));
  editorModule  = JSON.parse(JSON.stringify(state.moduleConfig));
  // Pre-fill fixed position from nodeInfo
  if (!editorConfig.position) editorConfig.position={};
  const pos=state.nodeInfo?.position;
  editorConfig.position._lat = pos?.latitudeI  ? (pos.latitudeI /1e7).toFixed(6) : '';
  editorConfig.position._lon = pos?.longitudeI ? (pos.longitudeI/1e7).toFixed(6) : '';
  editorConfig.position._alt = pos?.altitude ?? '';

  // Pre-fill node name fields from user info
  if (!editorConfig.device) editorConfig.device = {};
  const user = state.nodeInfo?.user || {};
  editorConfig.device._longName  = user.longName  || '';
  editorConfig.device._shortName = user.shortName || '';

  editorMode='node';
  editorSection='device';
  updateEditorBanner();
  renderEditor();
}

function loadTemplateIntoEditor(id) {
  const t=tplGet(id);
  if(!t){alert('Template not found.');return;}
  editorConfig   = JSON.parse(JSON.stringify(t.config||{}));
  editorModule   = JSON.parse(JSON.stringify(t.moduleConfig||{}));
  editorMode     = 'template';
  editorTplId    = id;
  editorSection  = 'device';
  document.getElementById('tpl-edit-name').value = t.name;
  document.getElementById('tpl-edit-desc').value = t.desc||'';
  sectionEditor.classList.remove('hidden');
  updateEditorBanner();
  renderEditor();
  sectionEditor.scrollIntoView({behavior:'smooth'});
}

function loadTemplateOntoNode() {
  if (!state.configDone) { alert('Node config not fully loaded yet.'); return; }
  const sel = document.getElementById('tpl-load-select')?.value;
  if (!sel) { alert('Select a template first.'); return; }
  const t = tplGet(sel);
  if (!t) return;
  // Overlay template values onto current node config
  editorConfig = JSON.parse(JSON.stringify(state.config));
  editorModule = JSON.parse(JSON.stringify(state.moduleConfig));
  for (const [sec,vals] of Object.entries(t.config||{})) {
    if(!editorConfig[sec]) editorConfig[sec]={};
    Object.assign(editorConfig[sec], vals);
  }
  for (const [sec,vals] of Object.entries(t.moduleConfig||{})) {
    if(!editorModule[sec]) editorModule[sec]={};
    Object.assign(editorModule[sec], vals);
  }
  editorMode='node'; editorSection='device';
  updateEditorBanner('Template loaded — review changes before applying.');
  renderEditor();
}

function updateEditorBanner(msg) {
  const el=document.getElementById('editor-banner');
  if(!el)return;
  if (editorMode==='template') {
    const t=tplGet(editorTplId);
    el.textContent = editorTplId ? `Editing template: ${t?.name||''}` : 'New template';
    el.className='editor-banner editor-banner--template';
  } else if (!state.connected) {
    el.textContent='Connect a node to edit its configuration.';
    el.className='editor-banner editor-banner--info';
  } else if (msg) {
    el.textContent=msg;
    el.className='editor-banner editor-banner--ok';
  } else {
    el.textContent='Editing: '+( state.nodeInfo?.user?.longName || state.myInfo?.myNodeNum?.toString(16) || 'connected node' );
    el.className='editor-banner editor-banner--node';
  }
}

// ─── Editor — render ─────────────────────────────────────────────────────────

function renderEditor() {
  renderEditorTabs();
  renderEditorPanel(editorSection);
  updateApplyButtons();
}

function renderEditorTabs() {
  const el=document.getElementById('editor-tabs');
  if(!el)return;
  const makeTab=(key,sec,group)=>
    `<button class="tab-btn${key===editorSection?' active':''} tab-${group}" data-sec="${key}" data-group="${group}">${sec.icon} ${sec.label}</button>`;
  el.innerHTML =
    `<span class="tab-group-label">Radio</span>`+
    Object.entries(RADIO_SECTIONS).map(([k,s])=>makeTab(k,s,'radio')).join('')+
    `<span class="tab-group-label" style="margin-left:0.5rem;">Modules</span>`+
    Object.entries(MODULE_SECTIONS).map(([k,s])=>makeTab(k,s,'module')).join('');
  el.querySelectorAll('.tab-btn').forEach(btn=>btn.addEventListener('click',()=>{
    saveCurrentPanel();
    editorSection=btn.dataset.sec;
    el.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active',b===btn));
    renderEditorPanel(editorSection);
  }));
}

function renderEditorPanel(sectionKey) {
  const isModule = sectionKey in MODULE_SECTIONS;
  const section  = isModule ? MODULE_SECTIONS[sectionKey] : RADIO_SECTIONS[sectionKey];
  const dataObj  = isModule ? (editorModule[sectionKey]||{}) : (editorConfig[sectionKey]||{});
  const panel    = document.getElementById('editor-panel');
  if(!panel||!section)return;

  const common   = section.fields.filter(f=>f.common);
  const advanced = section.fields.filter(f=>!f.common);

  let html=`<div class="field-group">${common.map(f=>renderField(f,dataObj[f.key])).join('')}</div>`;
  if(advanced.length)
    html+=`<details class="advanced-section"><summary>▶ Advanced</summary>
      <div class="field-group advanced-fields">${advanced.map(f=>renderField(f,dataObj[f.key])).join('')}</div>
    </details>`;

  if (!isModule && sectionKey==='position' && section.fixedFields) {
    const show=dataObj.fixedPosition?'':'display:none';
    html+=`<div id="fixed-coords-wrap" style="${show}">
      <div class="fixed-coords-header">📍 Fixed position coordinates</div>
      <div class="field-group">${section.fixedFields.map(f=>renderField(f,dataObj[f.key])).join('')}</div>
    </div>`;
  }

  html+=`<div id="field-help" class="field-help"></div>`;
  panel.innerHTML=html;

  // Fixed position toggle
  panel.querySelector('[data-key="fixedPosition"]')?.addEventListener('change',e=>{
    const wrap=document.getElementById('fixed-coords-wrap');
    if(wrap) wrap.style.display=e.target.checked?'':'none';
  });
  // Private key toggle
  panel.querySelector('.pk-toggle')?.addEventListener('change',e=>{
    panel.querySelector('.pk-value').style.display=e.target.checked?'':'none';
  });
  // Help text on focus
  panel.querySelectorAll('.field-input').forEach(el=>{
    el.addEventListener('focus',()=>{
      const helpEl=document.getElementById('field-help');
      if(helpEl) helpEl.textContent=el.dataset.desc||'';
    });
    el.addEventListener('blur',()=>{
      const helpEl=document.getElementById('field-help');
      if(helpEl) helpEl.textContent='';
    });
  });
  // Select description live update
  panel.querySelectorAll('select.field-input').forEach(sel=>{
    const update=()=>{
      const descEl=sel.parentElement?.querySelector('.select-desc');
      if(!descEl)return;
      const key=sel.dataset.key;
      const allSecs=[...Object.values(RADIO_SECTIONS),...Object.values(MODULE_SECTIONS)];
      for(const sec of allSecs){
        const fd=sec.fields.find(f=>f.key===key);
        if(fd){ const o=getOptions(fd.optKey).find(o=>String(o.value)===sel.value); descEl.textContent=o?.desc||''; break; }
      }
    };
    sel.addEventListener('change',update);
    update();
  });
}

function renderField(f,value) {
  const v=(value!==undefined&&value!==null)?value:'';
  const wCls=f.warn?' field-warn':'';
  const isNever=(v===4294967295||v==='4294967295');
  const desc=f.desc||'';

  let input='';
  switch(f.type){
    case 'select':{
      const opts=getOptions(f.optKey);
      const selOpt=opts.find(o=>o.value===v);
      input=`<div class="select-wrap">
        <select class="field-input" data-key="${f.key}" data-desc="${desc.replace(/"/g,'&quot;')}">
          ${opts.map(o=>`<option value="${o.value}"${o.value===v?' selected':''}>${o.label}</option>`).join('')}
        </select>
        <div class="select-desc">${selOpt?.desc||''}</div>
      </div>`;break;}
    case 'bool':
      input=`<label class="toggle">
        <input type="checkbox" class="field-input" data-key="${f.key}" data-desc="${desc.replace(/"/g,'&quot;')}"${v?' checked':''}>
        <span class="toggle-slider"></span>
      </label>`;break;
    case 'number':{
      const dv=isNever?'':v;
      const ph=isNever?'never (0xFFFFFFFF)':(f.unit||'');
      input=`<div class="num-wrap">
        <input type="number" class="field-input" data-key="${f.key}" data-desc="${desc.replace(/"/g,'&quot;')}"
          value="${dv}" placeholder="${ph}" step="any"
          ${f.min!==undefined?`min="${f.min}"`:''}
          ${f.max!==undefined?`max="${f.max}"`:''}
        >
        ${f.unit?`<span class="unit">${f.unit}</span>`:''}
      </div>`;break;}
    case 'password':
      input=`<input type="password" class="field-input" data-key="${f.key}" data-desc="${desc.replace(/"/g,'&quot;')}" value="${v}" autocomplete="off">`;break;
    case 'readonly':{
      const disp=v instanceof Uint8Array?btoa(String.fromCharCode(...v)):(v?String(v):'—');
      input=`<input type="text" class="field-input readonly" readonly value="${disp}" title="Read-only">`;break;}
    case 'private':{
      const disp=v instanceof Uint8Array?btoa(String.fromCharCode(...v)):(v?String(v):'');
      input=`<div class="private-wrap">
        <label class="pk-label"><input type="checkbox" class="pk-toggle"> Show private key</label>
        <input type="text" class="field-input pk-value" data-key="${f.key}" value="${disp}" style="display:none" readonly>
      </div>`;break;}
    default:
      input=`<input type="text" class="field-input" data-key="${f.key}" data-desc="${desc.replace(/"/g,'&quot;')}" value="${v}">`;
  }
  return `<div class="field-row${wCls}"><label class="field-label">${f.label}</label><div class="field-input-wrap">${input}</div></div>`;
}

function getOptions(optKey) {
  return ({ROLE_OPTIONS,REGION_OPTIONS,MODEM_OPTIONS,GPS_OPTIONS,BT_MODE_OPTIONS,REBROADCAST_OPTIONS})[optKey]||[];
}

function saveCurrentPanel() {
  const panel=document.getElementById('editor-panel');
  if(!panel||!editorSection)return;
  const isModule=editorSection in MODULE_SECTIONS;
  const target=isModule?editorModule:editorConfig;
  if(!target[editorSection])target[editorSection]={};
  panel.querySelectorAll('.field-input:not(.readonly):not(.pk-value)').forEach(el=>{
    const key=el.dataset.key; if(!key)return;
    if(el.type==='checkbox')    target[editorSection][key]=el.checked;
    else if(el.type==='number'){
      if(el.value==='') target[editorSection][key]=el.placeholder.startsWith('never')?4294967295:undefined;
      else              target[editorSection][key]=Number(el.value);
    } else target[editorSection][key]=el.value;
  });
}

function updateApplyButtons() {
  const nodeBtn = document.getElementById('btn-apply-node');
  const tplBtn  = document.getElementById('btn-save-template');
  if (nodeBtn) nodeBtn.style.display = editorMode==='node' ? '' : 'none';
  if (tplBtn)  tplBtn.style.display  = editorMode==='template' ? '' : 'none';
}

// ─── Apply to node (with transaction) ────────────────────────────────────────

// Test function: send a reboot via ToRadio.admin to confirm basic comms work
async function rebootNode() {
  if (!state.connected) { alert('Not connected.'); return; }
  if (!confirm('Run write diagnostics?')) return;

  console.log('--- Write diagnostics ---');
  console.log('state.writer:', !!state.writer);
  console.log('state.reader:', !!state.reader);
  console.log('port.writable.locked:', state.port?.writable?.locked);
  console.log('port.readable.locked:', state.port?.readable?.locked);

  // Test 1: send another wantConfigId (known to work at startup)
  console.log('Test 1: sending wantConfigId while readLoop active...');
  const wantCfg = Types.ToRadio.create({ wantConfigId: 0x12345678 });
  try {
    await writePacket(wantCfg);
    console.log('Test 1 write: OK');
  } catch(e) { console.error('Test 1 write FAILED:', e); }

  await sleep(1000);

  // Test 2: send reboot via ToRadio.admin
  console.log('Test 2: sending reboot via ToRadio.admin...');
  const rebootMsg = Types.AdminMessage.create({ rebootSeconds: 5 });
  const tr = Types.ToRadio.create({ admin: rebootMsg });
  try {
    await writePacket(tr);
    console.log('Test 2 write: OK — watching for reboot response...');
  } catch(e) { console.error('Test 2 write FAILED:', e); }

  alert('Diagnostics complete — check F12 console.');
}

async function applyToNode() {
  console.log('applyToNode called. connected:', state.connected, 'configDone:', state.configDone, 'writer:', !!state.writer);
  if (!state.connected)   { alert('Not connected to a node.'); return; }
  if (!state.configDone)  { alert('Node config not fully loaded yet.'); return; }
  if (!state.writer)      { alert('Serial writer not available. Try disconnecting and reconnecting.'); return; }
  saveCurrentPanel();

  const changes = [];
  Object.keys(RADIO_SECTIONS).forEach(k=>{ if(editorConfig[k]) changes.push(k); });
  Object.keys(MODULE_SECTIONS).forEach(k=>{ if(editorModule[k]) changes.push('mod:'+k); });

  if (!confirm(`Apply configuration to node?\n\nRadio sections: ${Object.keys(RADIO_SECTIONS).filter(k=>editorConfig[k]).join(', ')}\n\nModule sections: ${Object.keys(MODULE_SECTIONS).filter(k=>editorModule[k]&&Object.keys(editorModule[k]).length>0).join(', ')||'none'}\n\nAll changes are sent in one transaction.`)) return;

  let sent=0;
  try {
    // Obtain session key (required by firmware 2.7+)
    await ensureSessionKey();
    await sleep(200);

    // Begin transaction
    await sendAdmin(Types.AdminMessage.create({ beginEditSettings: true }));
    await sleep(150);

    // Radio config
    for (const cfgType of Object.keys(RADIO_SECTIONS)) {
      if (!editorConfig[cfgType]) continue;
      const clean=Object.fromEntries(Object.entries(editorConfig[cfgType]).filter(([k,v])=>!k.startsWith('_')&&v!==undefined));
      await sendAdmin(Types.AdminMessage.create({ setConfig: Types.Config.create({ [cfgType]: clean }) }));
      sent++; await sleep(100);
    }

    // Module config
    for (const modType of Object.keys(MODULE_SECTIONS)) {
      if (!editorModule[modType]) continue;
      const clean=Object.fromEntries(Object.entries(editorModule[modType]).filter(([,v])=>v!==undefined));
      if (Object.keys(clean).length===0) continue;
      await sendAdmin(Types.AdminMessage.create({ setModuleConfig: Types.ModuleConfig.create({ [modType]: clean }) }));
      sent++; await sleep(100);
    }

    // Fixed position
    const pos=editorConfig.position||{};
    if (pos.fixedPosition && pos._lat!==''&&pos._lat!==undefined&&pos._lon!==''&&pos._lon!==undefined) {
      const posMsg=Types.Position.create({
        latitudeI:  Math.round(Number(pos._lat)*1e7),
        longitudeI: Math.round(Number(pos._lon)*1e7),
        altitude:   pos._alt!==''&&pos._alt!==undefined ? Number(pos._alt) : 0,
      });
      await sendAdmin(Types.AdminMessage.create({ setFixedPosition: posMsg }));
      sent++; await sleep(100);
    }

    // Node name (setOwner — outside transaction)
    const devCfg = editorConfig.device || {};
    const newLong  = devCfg._longName?.trim();
    const newShort = devCfg._shortName?.trim();
    const curLong  = state.nodeInfo?.user?.longName  || '';
    const curShort = state.nodeInfo?.user?.shortName || '';
    if ((newLong && newLong !== curLong) || (newShort && newShort !== curShort)) {
      const UserType = Root.lookupType('meshtastic.User');
      const userMsg  = UserType.create({
        id:        state.nodeInfo?.user?.id || '',
        longName:  newLong  || curLong,
        shortName: (newShort || curShort).substring(0, 4),
      });
      await sendAdmin(Types.AdminMessage.create({ setOwner: userMsg }));
      sent++; await sleep(150);
    }

    // Commit transaction
    await sendAdmin(Types.AdminMessage.create({ commitEditSettings: true }));
    await sleep(150);

    updateEditorBanner('Configuration applied — ' + sent + ' section(s) sent.');
    alert(`Done — ${sent} section(s) written to node.\n\nThe node will apply all settings. It may reboot if LoRa region or role was changed.`);
  } catch(e) {
    console.error('Apply failed:', e);
    alert('Error during apply: '+e.message);
  }
}

// ─── Templates ────────────────────────────────────────────────────────────────

function renderTemplateList() {
  const list=tplLoad();
  const el=document.getElementById('tpl-list');
  if(!el)return;
  if(list.length===0){
    el.innerHTML='<p class="tpl-empty">No templates saved yet. Create one below.</p>';
    // Also update load select
    const sel=document.getElementById('tpl-load-select');
    if(sel){sel.innerHTML='<option value="">— no templates —</option>'; sel.disabled=true;}
    return;
  }
  el.innerHTML=list.map(t=>`
    <div class="tpl-item" id="tplitem-${t.id}">
      <div class="tpl-item-info">
        <span class="tpl-item-name">${escHtml(t.name)}</span>
        <span class="tpl-item-desc">${escHtml(t.desc||'')}</span>
        <span class="tpl-item-date">Modified: ${new Date(t.modified).toLocaleDateString()}</span>
      </div>
      <div class="tpl-item-actions">
        <button onclick="loadTemplateIntoEditor('${t.id}')" title="Edit this template">✏️ Edit</button>
        <button onclick="exportTemplate('${t.id}')" title="Export as YAML">📥 Export</button>
        <button class="btn-danger" onclick="confirmDeleteTemplate('${t.id}')" title="Delete">🗑️</button>
      </div>
    </div>`).join('');

  const sel=document.getElementById('tpl-load-select');
  if(sel){
    sel.innerHTML='<option value="">Select template…</option>'+list.map(t=>`<option value="${t.id}">${escHtml(t.name)}</option>`).join('');
    sel.disabled=false;
  }
}

function confirmDeleteTemplate(id) {
  const t=tplGet(id);
  if(!t)return;
  if(confirm(`Delete template "${t.name}"?`)) tplDelete(id);
}

function newTemplate() {
  editorConfig  = {};
  editorModule  = {};
  editorMode    = 'template';
  editorTplId   = null;
  editorSection = 'device';
  document.getElementById('tpl-edit-name').value='';
  document.getElementById('tpl-edit-desc').value='';
  sectionEditor.classList.remove('hidden');
  updateEditorBanner();
  renderEditor();
  sectionEditor.scrollIntoView({behavior:'smooth'});
}

function newTemplateFromNode() {
  if(!state.configDone){alert('Node config not fully loaded yet.');return;}
  editorConfig  = JSON.parse(JSON.stringify(state.config));
  editorModule  = JSON.parse(JSON.stringify(state.moduleConfig));
  editorMode    = 'template';
  editorTplId   = null;
  const nodeName=state.nodeInfo?.user?.longName||'Node';
  document.getElementById('tpl-edit-name').value=nodeName+' template';
  document.getElementById('tpl-edit-desc').value='Created from '+nodeName;
  updateEditorBanner();
  renderEditor();
  sectionEditor.scrollIntoView({behavior:'smooth'});
}

function saveTemplate() {
  saveCurrentPanel();
  const name=document.getElementById('tpl-edit-name').value.trim();
  const desc=document.getElementById('tpl-edit-desc').value.trim();
  if(!name){alert('Template name is required.');return;}
  if(editorTplId) tplUpdate(editorTplId, name, desc, editorConfig, editorModule);
  else { const t=tplCreate(name,desc,editorConfig,editorModule); editorTplId=t.id; }
  renderTemplateList();
  // Switch back to node mode if connected
  if(state.connected&&state.configDone){ editorMode='node'; loadNodeIntoEditor(); }
  else { updateEditorBanner(); updateApplyButtons(); }
  alert(`Template "${name}" saved.`);
}

function cancelTemplateEdit() {
  if(state.connected&&state.configDone){ editorMode='node'; loadNodeIntoEditor(); }
  else { editorMode='node'; sectionEditor.classList.add('hidden'); updateEditorBanner(); }
}

function exportTemplate(id) {
  const t=tplGet(id);
  if(!t)return;
  const yaml=jsonToYaml({ _name:t.name, _desc:t.desc, config:t.config, moduleConfig:t.moduleConfig });
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([yaml],{type:'text/yaml'}));
  a.download=t.name.replace(/[^a-z0-9]/gi,'_').toLowerCase()+'.yaml';
  a.click();
}

function importTemplate() {
  const input=document.createElement('input');
  input.type='file'; input.accept='.yaml,.yml,.json';
  input.onchange=e=>{
    const file=e.target.files[0]; if(!file)return;
    const reader=new FileReader();
    reader.onload=ev=>{
      try {
        const doc=parseSimpleYaml(ev.target.result);
        const name=doc._name||file.name.replace(/\.\w+$/,'')||'Imported template';
        const desc=doc._desc||'';
        const t=tplCreate(name,desc,doc.config||{},doc.moduleConfig||doc.module_config||{});
        renderTemplateList();
        alert(`Template "${t.name}" imported.`);
      } catch(e){ alert('Failed to parse file: '+e.message); }
    };
    reader.readAsText(file);
  };
  input.click();
}

// ─── Backup ───────────────────────────────────────────────────────────────────

btnBackup.addEventListener('click',()=>{
  if(!state.configDone){alert('Config not fully loaded yet.');return;}
  const yaml=jsonToYaml({
    _comment:'MeshConfig backup — '+new Date().toISOString(),
    owner:       state.nodeInfo?.user||{},
    owner_short: state.nodeInfo?.user?.shortName||'',
    config:      state.config,
    module_config: state.moduleConfig,
  });
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([yaml],{type:'text/yaml'}));
  a.download='meshconfig-backup.yaml';
  a.click();
});

btnRestore.addEventListener('click',()=>{
  const file=inputRestore.files[0];
  if(!file)          {alert('Select a YAML file first.');return;}
  if(!state.connected){alert('Not connected.');return;}
  if(!state.configDone){alert('Config not fully loaded yet.');return;}
  const r=new FileReader();
  r.onload=e=>importConfig(e.target.result);
  r.readAsText(file);
});

async function importConfig(yamlText) {
  let doc;
  try{doc=parseSimpleYaml(yamlText);}catch(e){alert('Parse failed: '+e.message);return;}
  if(!doc.config){alert("No 'config' section found.");return;}
  if(!confirm('Apply backup config to the connected node?\n\nThis will overwrite the current configuration.'))return;
  editorConfig=JSON.parse(JSON.stringify(doc.config));
  editorModule=JSON.parse(JSON.stringify(doc.module_config||doc.moduleConfig||{}));
  editorMode='node';
  await applyToNode();
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function setStatus(s) {
  statusEl.textContent={disconnected:'Disconnected',connecting:'Connecting…',connected:'Connected'}[s]||s;
  statusEl.className='status status--'+s;
}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function escHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

// ─── YAML helpers ─────────────────────────────────────────────────────────────

function jsonToYaml(obj,i=0){
  const p='  '.repeat(i);
  if(obj===null||obj===undefined)return'null';
  if(typeof obj==='boolean')return obj?'true':'false';
  if(typeof obj==='number')return String(obj);
  if(typeof obj==='string'){
    if(/[:#\[\]{},&*?|<>=!%@`]/.test(obj)||obj===''||['true','false','null','yes','no'].includes(obj.toLowerCase()))
      return`"${obj.replace(/"/g,'\\"')}"`;
    return obj;
  }
  if(Array.isArray(obj)){if(!obj.length)return'[]';return obj.map(x=>`${p}- ${jsonToYaml(x,i+1)}`).join('\n');}
  if(typeof obj==='object'){
    const e=Object.entries(obj).filter(([,v])=>v!==undefined&&v!==null);
    if(!e.length)return'{}';
    return e.map(([k,v])=>{
      const s=jsonToYaml(v,i+1);
      return(typeof v==='object'&&v!==null&&!Array.isArray(v)&&Object.keys(v).length>0)?`${p}${k}:\n${s}`:`${p}${k}: ${s}`;
    }).join('\n');
  }
  return String(obj);
}
function parseSimpleYaml(text){
  try{return JSON.parse(text);}catch(_){}
  const result={},stack=[{obj:result,indent:-1}];
  for(const raw of text.split('\n')){
    if(raw.trimStart().startsWith('#')||raw.trim()==='')continue;
    const indent=raw.search(/\S/),line=raw.trim();
    const kv=line.match(/^([^:]+):\s*(.*)$/);
    if(!kv)continue;
    const key=kv[1].trim(),val=kv[2].trim();
    while(stack.length>1&&stack[stack.length-1].indent>=indent)stack.pop();
    const parent=stack[stack.length-1].obj;
    if(val===''||val==='{}'){const c={};parent[key]=c;stack.push({obj:c,indent});}
    else parent[key]=parseYamlValue(val);
  }
  return result;
}
function parseYamlValue(v){
  if(v==='true')return true;if(v==='false')return false;
  if(v==='null'||v==='~')return null;
  if(/^".*"$/.test(v))return v.slice(1,-1).replace(/\\"/g,'"');
  if(/^-?\d+$/.test(v))return parseInt(v,10);
  if(/^-?\d+\.\d+$/.test(v))return parseFloat(v);
  return v;
}

// ─── Init ─────────────────────────────────────────────────────────────────────
loadProto();
