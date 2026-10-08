# BIN-001 Wokwi Simulation

This is a simulation, not a deployed physical bin. This Wokwi project uses one ESP32 and one HC-SR04 ultrasonic sensor and sends readings for `BIN-001` to the existing SmartBin API. It does not connect the other bins.

To simulate readings for every registered garbage bin, use the backend's multi-bin software simulator instead. With the backend running, open a second terminal in `BACK END` and run `npm run simulate`. Stop the Wokwi simulator first so both simulators do not send competing readings for `BIN-001`. The software simulator includes all records with `type: bin`; it does not simulate recycling or collection-point records.

## Configure the backend

1. In `BACK END/.env`, set `DEVICE_KEY` to a unique, high-entropy value. Do not use a real database password or an administrator credential.
2. From `BACK END`, run `npm run register:wokwi-bin`. This safely registers `BIN-001` against the existing Adama Central Bin record (or creates it if it does not exist); it does not clear or reseed the database.
3. Start the backend with `npm run dev`.

## Configure and run Wokwi

1. Open this `WOKWI` folder as a PlatformIO project and install the PlatformIO and Wokwi VS Code extensions.
2. Copy `include/secrets.example.h` to `include/secrets.h`. This file is excluded from Git. Set `DEVICE_KEY` to the same value as the backend, and set `API_BASE_URL`:
   - For a local backend, use `http://host.wokwi.internal:3000/api` and run the Wokwi **Private IoT Gateway**. Do not use plain HTTP through the public gateway.
   - For a remotely reachable backend, use its HTTPS URL ending in `/api` and set `API_ROOT_CA` to the public root CA certificate for that endpoint.
3. Keep `secrets.h` and any Wokwi project containing the key private. Never commit or share the key in a public project.
4. Build the PlatformIO project, then choose **Wokwi: Start Simulator** in VS Code.

The circuit starts with the HC-SR04 distance at 180 cm (empty). Click the sensor during simulation to change its distance: shorter distance means a higher measured fill percentage. The simulator also increases the fill level by 10 percentage points every 5 seconds so the complete fill/collection/reset lifecycle can be demonstrated without manually moving the slider.

## Lifecycle

- The ESP32 fetches `/api/bins/BIN-001/sensor-state` before transmitting and periodically checks it afterward.
- Readings are sent to `POST /api/bins/BIN-001/sensor` with the device key, server-issued cycle ID, increasing sequence number, fill level, and derived status.
- Status is `NORMAL` (0–49%), `ALMOST_FULL` (50–79%), `HIGH` (80–99%), or `FULL` (100%). The backend validates it independently.
- At 100%, sensor uploads stop. The simulator only polls for backend state; no timer empties the bin.
- Admin assigns collection using the existing bin task workflow. The assigned Driver starts and completes it using the existing Driver dashboard.
- On successful Driver completion, the backend resets the bin to 0%, rotates the cycle ID, and resets the sequence. The simulator observes that backend change and resumes. Delayed readings from the previous cycle are rejected.
- Once a bin reports 100%, its sensor uploads stop by design. That recorded full reading remains collection-needed until a Driver completes collection, even if the reading becomes older than the normal stale-reading window.

The Admin dashboard refreshes through its existing polling and shows sensor fill/status, last reading, and device communication state. Sensor state and collection-task state remain separate.
