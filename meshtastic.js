<!DOCTYPE html>
<html lang="no">
<head>
    <meta charset="UTF-8">
    <title>MeshConfig Lokalt</title>
    <!-- Vi bruker din lokale kopi av biblioteket -->
    <script src="meshtastic.js"></script>
</head>
<body style="font-family: sans-serif; text-align: center; background: #1a1a1a; color: white;">

    <h1>Secure Admin (Lokal v2.6.0)</h1>
    <button id="btn" style="padding: 20px; cursor: pointer;">KOBLE TIL & REBOOT</button>
    <div id="status" style="margin-top: 20px; color: #00ff00;">Klar.</div>

    <script>
        const btn = document.getElementById('btn');
        const status = document.getElementById('status');

        btn.onclick = async () => {
            // Sjekk om biblioteket faktisk er lastet
            if (typeof Meshtastic === 'undefined') {
                status.innerText = "FEIL: meshtastic.js ble ikke lastet!";
                return;
            }

            status.innerText = "Kobler til...";
            btn.disabled = true;

            try {
                const connection = new Meshtastic.SerialConnection();
                const device = new Meshtastic.MeshDevice(connection);

                await connection.connect();
                status.innerText = "Forhandler sikker sesjon (PKI)...";

                device.onDeviceStatus.subscribe(async (s) => {
                    console.log("Status endret til:", s);
                    // 2 betyr DeviceStatus.DeviceReady
                    if (s === 2) {
                        status.innerText = "Sikker sesjon OK! Sender reboot...";
                        await device.reboot(1);
                        status.innerText = "REBOOT SENDT!";
                        btn.disabled = false;
                    }
                });

            } catch (err) {
                status.innerText = "Feil: " + err.message;
                btn.disabled = false;
            }
        };
    </script>
</body>
</html>
