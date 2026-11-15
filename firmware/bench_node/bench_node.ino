// Bench node: two DS18B20 probes, publish only.
//
// This sketch is the ESP32 end of the data flow:
//   probes -> JSON {point, value, unit, timestamp, quality}
//          -> MQTT topic hvac/<NODE_ID>/reading
//          -> hub gateway -> store -> live page
//
// It never listens for inbound MQTT and has no equipment outputs.
// Power the board from USB. Do not tie it to the furnace transformer.
//
// If nothing shows on the page: Serial Monitor at 115200. "wifi down" means
// config.h SSID/password. "mqtt down" means MQTT_HOST is not the hub's LAN
// IP (127.0.0.1 is the board itself). "missing return_air_temp" means wiring.
//
// Wiring (3.3 V data, not 5 V):
//   ESP32 3V3 ----+---- DS18B20 VDD (both probes)
//                 |
//                4.7k
//                 |
//   GPIO4 --------+---- DS18B20 DQ (both probes)
//   GND --------------- DS18B20 GND (both probes)

#include <WiFi.h>
#include <PubSubClient.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <time.h>

#if __has_include("config.h")
#include "config.h"
#else
#error "Copy config.h.example to config.h and fill in Wi-Fi and the hub IP."
#endif

// GPIO4 is ADC1-safe later if we add a current clamp; keep 1-Wire here.
constexpr int kOneWirePin = 4;
// 10 seconds, same as the simulator and the Phase 1 pass.
constexpr unsigned long kPublishIntervalMs = 10000;
// Unix time for 2024-01-01. Below this, the board has no NTP yet.
constexpr time_t kMinValidTime = 1704067200;

// Index 0 is the first probe Dallas enumerates (return), 1 is supply.
const char *kPointIds[] = {"return_air_temp", "supply_air_temp"};

OneWire oneWire(kOneWirePin);
DallasTemperature dallas(&oneWire);
WiFiClient wifi;
PubSubClient mqtt(wifi);

unsigned long lastPublishMs = 0;
bool hasPublished = false;
bool ntpStarted = false;
unsigned long nextMqttRetryMs = 0;

void setup() {
  // USB serial is the first debug tool. 115200 matches the Arduino serial monitor.
  Serial.begin(115200);
  dallas.begin();
  WiFi.mode(WIFI_STA);
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  // Default PubSubClient buffer is too small for two JSON readings in a row.
  mqtt.setBufferSize(512);
}

// Join home Wi-Fi. Returns true when we have an IP.
// 8 s timeout so loop() can keep trying without blocking forever.
bool wifiUp() {
  if (WiFi.status() == WL_CONNECTED) return true;
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 8000) {
    delay(250);
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("wifi ");
    Serial.println(WiFi.localIP());
    return true;
  }
  Serial.println("wifi down");
  return false;
}

// Connect to Mosquitto as NODE_ID. No inbound topic is registered.
// 2 s backoff when the hub is not up yet (you started the board first).
bool mqttUp() {
  if (mqtt.connected()) return true;
  unsigned long nowMs = millis();
  if (nextMqttRetryMs != 0 && nowMs < nextMqttRetryMs) return false;
  if (mqtt.connect(NODE_ID)) {
    Serial.println("mqtt connected");
    return true;
  }
  Serial.println("mqtt down");
  nextMqttRetryMs = nowMs + 2000;
  return false;
}

// True once NTP has given a clock after 2024. False -> timestamp field is null
// and the hub fills received_at instead. Do not invent a date.
bool clockSynced() {
  if (!ntpStarted) {
    configTime(0, 0, "pool.ntp.org", "time.nist.gov");
    ntpStarted = true;
  }
  return time(nullptr) >= kMinValidTime;
}

// Publish one point. ok=false sends value:null quality:bad so a dead probe
// is visible as Bad reading, not as the last good number.
// retain is false: unplugging the board must not leave a zombie payload.
void publishOne(const char *pointId, bool ok, float valueF) {
  char timestampField[40];
  if (clockSynced()) {
    time_t now = time(nullptr);
    struct tm broken;
    gmtime_r(&now, &broken);
    char iso[24];
    strftime(iso, sizeof(iso), "%Y-%m-%dT%H:%M:%SZ", &broken);
    snprintf(timestampField, sizeof(timestampField), "\"%s\"", iso);
  } else {
    snprintf(timestampField, sizeof(timestampField), "null");
  }

  char payload[192];
  if (ok) {
    snprintf(payload, sizeof(payload),
             "{\"point\":\"%s\",\"value\":%.2f,\"unit\":\"F\",\"timestamp\":%s,\"quality\":\"good\"}",
             pointId, valueF, timestampField);
  } else {
    snprintf(payload, sizeof(payload),
             "{\"point\":\"%s\",\"value\":null,\"unit\":\"F\",\"timestamp\":%s,\"quality\":\"bad\"}",
             pointId, timestampField);
  }

  char topic[64];
  snprintf(topic, sizeof(topic), "hvac/%s/reading", NODE_ID);
  mqtt.publish(topic, payload, false);
  Serial.println(payload);
}

// Read both probes. Dallas index order is bus order, not "left vs right" on the desk.
// A missing index is skipped (no payload) so the hub will mark that point stale.
void publishTemperatures() {
  dallas.requestTemperatures();
  int count = dallas.getDeviceCount();
  Serial.printf("probes: %d\n", count);
  for (int i = 0; i < 2; i++) {
    if (i >= count) {
      Serial.printf("missing %s\n", kPointIds[i]);
      continue;
    }
    float celsius = dallas.getTempCByIndex(i);
    bool ok = celsius != DEVICE_DISCONNECTED_C;
    float fahrenheit = ok ? (celsius * 9.0f / 5.0f) + 32.0f : 0.0f;
    publishOne(kPointIds[i], ok, fahrenheit);
  }
}

void loop() {
  // No Wi-Fi or broker: wait and retry. Do not publish into the void.
  if (!wifiUp() || !mqttUp()) {
    delay(200);
    return;
  }
  mqtt.loop();
  unsigned long nowMs = millis();
  // First pass publishes immediately, then every 10 s.
  if (!hasPublished || nowMs - lastPublishMs >= kPublishIntervalMs) {
    publishTemperatures();
    lastPublishMs = nowMs;
    hasPublished = true;
  }
}
