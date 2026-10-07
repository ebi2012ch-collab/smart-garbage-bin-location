#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>

#include "secrets.h"

#ifndef API_BASE_URL
#error "Create secrets.h from secrets.example.h and configure API_BASE_URL."
#endif

#ifndef DEVICE_KEY
#error "Create secrets.h from secrets.example.h and configure DEVICE_KEY."
#endif

#ifndef API_ROOT_CA
#define API_ROOT_CA ""
#endif

namespace {
constexpr char BIN_ID[] = "BIN-001";
constexpr int TRIG_PIN = 5;
constexpr int ECHO_PIN = 18;
constexpr float EMPTY_DISTANCE_CM = 180.0f;
constexpr float FULL_DISTANCE_CM = 8.0f;
constexpr unsigned long SENSOR_INTERVAL_MS = 5000;
constexpr unsigned long STATE_POLL_INTERVAL_MS = 5000;
constexpr int AUTO_FILL_STEP = 10;

String apiRoot;
String cycleId;
int lastServerSequence = 0;
int currentFillLevel = 0;
bool canTransmit = false;
bool stateLoaded = false;
unsigned long lastStatePoll = 0;
unsigned long lastReading = 0;

template <typename ClientType>
int executeRequest(ClientType& client, const String& url, const char* method, const String& payload, String& responseBody) {
  HTTPClient http;
  if (!http.begin(client, url)) return -1;
  http.addHeader("x-device-key", DEVICE_KEY);
  if (payload.length()) http.addHeader("Content-Type", "application/json");

  const int statusCode = strcmp(method, "GET") == 0
    ? http.GET()
    : http.POST(payload);
  if (statusCode > 0) responseBody = http.getString();
  http.end();
  return statusCode;
}

int apiRequest(const String& path, const char* method, const String& payload, String& responseBody) {
  const String url = apiRoot + path;
  if (url.startsWith("https://")) {
    WiFiClientSecure client;
    if (strlen(API_ROOT_CA) == 0) {
      Serial.println("HTTPS requires API_ROOT_CA in the private secrets.h file.");
      return -1;
    }
    client.setCACert(API_ROOT_CA);
    return executeRequest(client, url, method, payload, responseBody);
  }

  WiFiClient client;
  return executeRequest(client, url, method, payload, responseBody);
}

bool pollBackendState() {
  String response;
  const int statusCode = apiRequest(
    String("/bins/") + BIN_ID + "/sensor-state", "GET", "", response
  );
  lastStatePoll = millis();
  if (statusCode < 200 || statusCode >= 300) {
    Serial.printf("State check failed (HTTP %d). Will retry.\n", statusCode);
    return false;
  }

  JsonDocument document;
  if (deserializeJson(document, response)) {
    Serial.println("Could not parse sensor-state response.");
    return false;
  }

  JsonObject data = document["data"];
  const String receivedCycle = data["cycleId"] | "";
  if (receivedCycle.isEmpty()) {
    Serial.println("Backend response is missing the sensor cycle.");
    return false;
  }

  if (receivedCycle != cycleId) {
    cycleId = receivedCycle;
    currentFillLevel = data["fillLevel"].is<int>() ? data["fillLevel"].as<int>() : 0;
    Serial.printf("Backend cycle changed; resuming at %d%%.\n", currentFillLevel);
  } else if (data["fillLevel"].is<int>()) {
    currentFillLevel = max(currentFillLevel, data["fillLevel"].as<int>());
  }
  lastServerSequence = data["lastSequence"] | 0;
  canTransmit = data["canTransmit"] | false;
  stateLoaded = true;
  Serial.printf("BIN-001: %d%%, %s, transmission %s.\n",
    currentFillLevel,
    (const char*)(data["status"] | "UNKNOWN"),
    canTransmit ? "enabled" : "stopped"
  );
  return true;
}

int readDistanceCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  const unsigned long duration = pulseIn(ECHO_PIN, HIGH, 30000UL);
  if (!duration) return -1;
  return static_cast<int>(duration / 58UL);
}

int statusFor(int fillLevel) {
  if (fillLevel >= 100) return 3;
  if (fillLevel >= 80) return 2;
  if (fillLevel >= 50) return 1;
  return 0;
}

const char* statusName(int status) {
  switch (status) {
    case 1: return "ALMOST_FULL";
    case 2: return "HIGH";
    case 3: return "FULL";
    default: return "NORMAL";
  }
}

bool sendReading() {
  const int distanceCm = readDistanceCm();
  if (distanceCm < 0) {
    Serial.println("Ultrasonic sensor did not return a valid distance; reading skipped.");
    return false;
  }

  const float boundedDistance = constrain(
    static_cast<float>(distanceCm), FULL_DISTANCE_CM, EMPTY_DISTANCE_CM
  );
  const int ultrasonicFill = static_cast<int>(round(
    (EMPTY_DISTANCE_CM - boundedDistance) * 100.0f /
    (EMPTY_DISTANCE_CM - FULL_DISTANCE_CM)
  ));
  const int simulatedFill = min(100, currentFillLevel + AUTO_FILL_STEP);
  const int nextFill = max(ultrasonicFill, simulatedFill);
  const int nextSequence = lastServerSequence + 1;
  const int status = statusFor(nextFill);

  JsonDocument document;
  document["binId"] = BIN_ID;
  document["fillLevel"] = nextFill;
  document["status"] = statusName(status);
  document["cycleId"] = cycleId;
  document["sequence"] = nextSequence;
  String payload;
  serializeJson(document, payload);

  String response;
  const int statusCode = apiRequest(
    String("/bins/") + BIN_ID + "/sensor", "POST", payload, response
  );
  if (statusCode < 200 || statusCode >= 300) {
    Serial.printf("Sensor upload failed (HTTP %d). Will refresh backend state.\n", statusCode);
    stateLoaded = false;
    return false;
  }

  currentFillLevel = nextFill;
  lastServerSequence = nextSequence;
  Serial.printf("Distance: %d cm; fill: %d%%; status: %s.\n",
    distanceCm, nextFill, statusName(status)
  );
  if (nextFill == 100) {
    canTransmit = false;
    Serial.println("FULL reached. Normal sensor uploads stopped; checking only for backend collection reset.");
  }
  return true;
}

void connectToWiFi() {
  Serial.print("Connecting to Wokwi-GUEST");
  WiFi.begin("Wokwi-GUEST", "", 6);
  while (WiFi.status() != WL_CONNECTED) {
    delay(250);
    Serial.print('.');
  }
  Serial.printf("\nWiFi connected: %s\n", WiFi.localIP().toString().c_str());
}
}

void setup() {
  Serial.begin(115200);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  apiRoot = API_BASE_URL;
  while (apiRoot.endsWith("/")) apiRoot.remove(apiRoot.length() - 1);
  connectToWiFi();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    canTransmit = false;
    stateLoaded = false;
    connectToWiFi();
  }

  const unsigned long now = millis();
  if (!stateLoaded || now - lastStatePoll >= STATE_POLL_INTERVAL_MS) {
    pollBackendState();
  }

  if (stateLoaded && canTransmit && now - lastReading >= SENSOR_INTERVAL_MS) {
    lastReading = now;
    sendReading();
  }
  delay(50);
}
