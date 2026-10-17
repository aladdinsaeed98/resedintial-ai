// Bench node: two DS18B20 probes, publish only.
//
// Wiring (3.3 V data, not 5 V):
//   ESP32 3V3 ----+---- DS18B20 VDD (both probes)
//                 |
//                4.7k
//                 |
//   GPIO4 --------+---- DS18B20 DQ (both probes)
//   GND --------------- DS18B20 GND (both probes)
//
// This sketch does not subscribe and has no equipment outputs.
// Power the board from USB. Do not tie it to the furnace transformer.

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

constexpr int kOneWirePin = 4;
constexpr unsigned long kPublishIntervalMs = 10000;
constexpr time_t kMinValidTime = 1704067200;

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
  Serial.begin(115200);
  dallas.begin();
  WiFi.mode(WIFI_STA);
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setBufferSize(512);
}

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

bool clockSynced() {
  if (!ntpStarted) {
    configTime(0, 0, "pool.ntp.org", "time.nist.gov");
    ntpStarted = true;
  }
  return time(nullptr) >= kMinValidTime;
}

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
  if (!wifiUp() || !mqttUp()) {
    delay(200);
    return;
  }
  mqtt.loop();
  unsigned long nowMs = millis();
  if (!hasPublished || nowMs - lastPublishMs >= kPublishIntervalMs) {
    publishTemperatures();
    lastPublishMs = nowMs;
    hasPublished = true;
  }
}
