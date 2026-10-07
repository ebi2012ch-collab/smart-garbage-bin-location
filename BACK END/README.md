# SmartBin Adama City — Backend API

Node.js / Express REST API for the Smart Garbage Bin Location System.

---

## Quick Start

### 1. Install dependencies
```bash
cd "BACK END"
npm install
```

### 2. Configure environment
Copy `.env.example` to `.env` and set `MONGO_URI`, a long random `JWT_SECRET`, `ADMIN_USERNAME`, and `ADMIN_PASSWORD` before starting the API. Set `DEVICE_KEY` to a unique high-entropy value before enabling physical devices. Optional thresholds are `BIN_FILLING_THRESHOLD=70`, `BIN_COLLECTION_THRESHOLD=90`, and `BIN_READING_STALE_MINUTES=120`.

### 3. Start the server
```bash
# Production
npm start

# Development (auto-restarts on file changes)
npm run dev
```

The API will be running at **http://localhost:3000** unless `PORT` is set.

Run the monitoring and assignment checks with `npm test`. The API integration test uses a separate `smartbin_workflow_test_*` database only when `MONGO_URI` points to local MongoDB; it skips rather than writing to a remote database.

---

## API Endpoints

Public visitor features do not use accounts or require authentication. The shared staff login issues JWTs for Admin and Driver roles; protected write and task-management routes enforce the required role.

### Auth
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/auth/login` | Admin or Driver login; pass `role: "admin"` or `"driver"` | Public |
| GET | `/api/auth/me` | Get current user info | JWT |
| POST | `/api/auth/logout` | Logout (client drops token) | JWT |

### Bins
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/bins` | List all bins | Public |
| GET | `/api/bins?status=full` | Filter by status | Public |
| GET | `/api/bins?type=recycle` | Filter by type | Public |
| GET | `/api/bins/:id` | Get single bin | Public |
| POST | `/api/bins` | Add new bin | JWT (admin) |
| PUT | `/api/bins/:id` | Update bin | JWT (admin) |
| PATCH | `/api/bins/:id/status` | Update fill level / status | JWT (admin) |
| GET | `/api/bins/:id/sensor-state` | Get device cycle, fill level, and permission to transmit | `x-device-key` |
| POST | `/api/bins/:id/sensor` | Submit a validated, sequenced device reading | `x-device-key` |
| DELETE | `/api/bins/:id` | Delete bin | JWT (admin) |

Fill state is derived from timestamped readings, not the legacy operational status. The separate sensor status is `NORMAL` (0–49%), `ALMOST_FULL` (50–79%), `HIGH` (80–99%), or `FULL` (100%). Device communication state is reported separately. `POST /api/bins/:id/simulated-reading` accepts `{ "fillLevel": 92 }` for an authenticated Admin and labels the stored reading `simulated`; it never represents a physical sensor.

The Wokwi ESP32 uses the stable `BIN-001` code and authenticates with `x-device-key` matching the required `DEVICE_KEY` environment setting (there is no default key). Device readings contain `binId`, `fillLevel`, `status`, `cycleId`, and a strictly increasing integer `sequence`; the backend timestamps each accepted reading as `lastUpdated`/`lastReadingAt`. The status must match the submitted fill level. Readings can only increase during a cycle. At 100%, the API rejects further readings until the existing Driver collection task is completed. Completion resets the fill level to 0 and rotates the cycle ID, so delayed readings from an earlier cycle cannot undo the reset. `GET /api/bins/BIN-001/sensor-state` lets the device detect that reset and resume.

To safely register the one demo bin without deleting existing data, configure `.env` and run `npm run register:wokwi-bin` from `BACK END`. The script reuses the existing Adama Central Bin record when available. See `WOKWI/README.md` for the simulator setup and full lifecycle.

### Reports
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/reports` | Submit citizen report | Public |
| GET | `/api/reports` | List all reports | JWT (admin) |
| GET | `/api/reports?status=pending` | Filter by status | JWT |
| GET | `/api/reports/:id` | Get single report | Public |
| PATCH | `/api/reports/:id/status` | Advance report status | JWT (admin) |
| DELETE | `/api/reports/:id` | Archive report (soft delete) | JWT (admin) |

The admin status update enforces `pending → in-progress → resolved` and accepts an optional `resolutionNote` (up to 1000 characters) when resolving. Resolving records `resolvedAt`; reopening is not supported by this endpoint. Archived reports are omitted from active report lists, public lookups, and dashboard counts. The admin list also accepts `status`, `priority`, and `q` query filters; `q` searches reference, reporter, phone, location, and description.

### Collection Requests
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/collection-requests` | Submit a public collection request | Public |
| GET | `/api/collection-requests` | List requests; optional `?status=` filter | JWT (admin) |
| PATCH | `/api/collection-requests/:id/status` | Accept or reject a pending request | JWT (admin) |
| PATCH | `/api/collection-requests/:id/assign` | Assign a driver to an accepted request | JWT (admin) |

Collection requests are stored separately from garbage-problem reports. Admin transitions are `pending → accepted/rejected` and `accepted → assigned`. Drivers can advance only their own tasks through `assigned → in-progress → completed`.

Admins can create a bin-linked task with `POST /api/collection-requests/from-bin` using `{ "binId": "...", "driverId": "..." }`. It requires an operational bin and a fresh Collection Needed reading. An active unique-bin constraint prevents duplicate tasks. Driver task responses include the bin ID, fill level and reading source captured at assignment. Completion records its time and sets the bin collection state to `completed-awaiting-reading`; it deliberately keeps the previous fill reading until a new reading arrives.

### Drivers and tasks
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/drivers` | List driver accounts (safe fields only) | JWT (admin) |
| POST | `/api/drivers` | Create a Driver login (password minimum 8 characters) | JWT (admin) |
| GET | `/api/driver/tasks` | List the authenticated Driver's assigned, in-progress, and completed tasks | JWT (driver) |
| PATCH | `/api/driver/tasks/:id/status` | Start or complete an owned task | JWT (driver) |
| GET | `/api/driver/tasks/reports` | List only the authenticated Driver's assigned open citizen reports | JWT (driver) |
| PATCH | `/api/driver/tasks/reports/:id/start` | Start work on an owned report | JWT (driver) |
| POST | `/api/driver/tasks/reports/:id/work` | Submit required work notes and optional `evidence` image for Admin verification | JWT (driver) |

### Citizen report workflow
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/reports` | Submit a report; optional latitude/longitude and `photo` | Public |
| GET | `/api/reports` | List and filter reports by `status`, `priority`, `problemType`, and `q` | JWT (admin) |
| GET | `/api/reports?refId=...` | Look up safe tracking status without reporter contact/details | Public |
| GET | `/api/reports/:id` | Read full report details | JWT (admin); public `refId` lookup is sanitized |
| PATCH | `/api/reports/:id/assign` | Assign or reassign an eligible Driver before work submission | JWT (admin) |
| PATCH | `/api/reports/:id/status` | Verify submitted work as `resolved`, or reject a pending report as `dismissed` with a reason | JWT (admin) |

Report status stays `pending`, `in-progress`, `resolved`, or `dismissed`. Driver work submission records `workSubmittedAt` and is displayed as **Awaiting verification** while retaining the compatible `in-progress` status. Assignment history is stored on the report. The Admin can resolve only after work submission and must enter a verification note; Drivers can only start and submit work for reports currently assigned to their account. Citizen reports remain separate from collection requests because a report may require investigation, cleanup, or maintenance rather than waste pickup.

### Stats
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/stats` | Database-backed dashboard statistics | Public |

The public bin-reading, report-submission, and collection-request creation routes remain available without a visitor account.

Dashboard bin totals and availability count only records with `type: bin`; `Need Service` counts those bins whose status is `full` or `out-of-service` (almost-full remains a separate status). Recycling Points counts `type: recycle`, while City Zones counts distinct named zones across location records and excludes blank/Unknown zones. Collection metrics are based on collection-request records: Pending counts `pending`, Unassigned counts accepted requests without a driver, In Progress counts `in-progress`, and Completed Today uses the server's local calendar day and `completedAt`.

---

## Default Admin Credentials
```
Username: admin
Password: Admin@1234
```
Change these in your `.env` file before deploying.

---

## Project Structure
```
BACK END/
├── server.js           # Express app entry point
├── package.json
├── .env.example        # Environment variable template
├── db/
│   ├── registerWokwiBin.js # Safely register BIN-001 for the Wokwi demo
│   └── data.js         # In-memory data store (seeded)
├── middleware/
│   └── auth.js         # JWT verification and role guards
├── models/
│   ├── CollectionRequest.js # Collection request and assignment schema
│   └── User.js         # Admin and Driver account schema
├── routes/
│   ├── auth.js         # Role-selecting login / logout
│   ├── bins.js         # Public bin reads and Admin bin management
│   ├── reports.js      # Public reports and Admin management
│   ├── collectionRequests.js # Public requests, Admin review and assignment
│   ├── drivers.js      # Admin driver account management
│   ├── driverTasks.js  # Driver task status workflow
│   └── stats.js        # Dashboard statistics
└── uploads/            # Uploaded report photos (auto-created)
```

---

## Notes

- Collection requests, accounts, and assignments are persisted through MongoDB/Mongoose.
- **Photo uploads** are stored in the `uploads/` folder and served at `/uploads/<filename>`.
- **CORS** is configured via `CORS_ORIGINS` in `.env`. Add your frontend URL there.
- **Staff login** is at `FRONT END/login.html`; it routes Admins to `FRONT END/pages/admin.html` and Drivers to `FRONT END/driver.html`.
