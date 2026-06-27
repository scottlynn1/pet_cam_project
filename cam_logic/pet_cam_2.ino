#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ESPAsyncWebServer.h>
#include "esp_camera.h"
#include <ArduinoJson.h>
#include <Preferences.h>
#include <ESPmDNS.h>
#include "camera_2_pins.h"

#define PAN_PIN 5
#define TILT_PIN 6

#define PAN_CH 4
#define TILT_CH 5

unsigned long lastServoCommandTime = 0;
bool servosNeedFreeze = false;

const char* ssid = "CommunityFibre10Gb_225C5_2.4";
const char* password = "B@obean2026";
camera_config_t camera_config = {
  .pin_pwdn = PWDN_GPIO_NUM,
  .pin_reset = RESET_GPIO_NUM,
  .pin_xclk = XCLK_GPIO_NUM,
  .pin_sccb_sda = SIOD_GPIO_NUM,
  .pin_sccb_scl = SIOC_GPIO_NUM,
  .pin_d7 = Y9_GPIO_NUM,
  .pin_d6 = Y8_GPIO_NUM,
  .pin_d5 = Y7_GPIO_NUM,
  .pin_d4 = Y6_GPIO_NUM,
  .pin_d3 = Y5_GPIO_NUM,
  .pin_d2 = Y4_GPIO_NUM,
  .pin_d1 = Y3_GPIO_NUM,
  .pin_d0 = Y2_GPIO_NUM,
  .pin_vsync = VSYNC_GPIO_NUM,
  .pin_href = HREF_GPIO_NUM,
  .pin_pclk = PCLK_GPIO_NUM,
  .xclk_freq_hz = 20000000,
  .ledc_timer = LEDC_TIMER_0,
  .ledc_channel = LEDC_CHANNEL_0,
  .pixel_format = PIXFORMAT_JPEG,
  .frame_size = FRAMESIZE_VGA,
  .jpeg_quality = 8,
  .fb_count = 2,
  .fb_location = CAMERA_FB_IN_PSRAM,
  .grab_mode = CAMERA_GRAB_LATEST,
};



void setupServos() {
  // We link the GPIO (PAN_PIN) to a Channel (PAN_CH)
  ledcAttachChannel(PAN_PIN, 50, 12, PAN_CH);
  ledcAttachChannel(TILT_PIN, 50, 12, TILT_CH);
}
void writeServo(uint8_t pin, int angle) {
  angle = constrain(angle, 0, 180);
  int us = map(angle, 0, 180, 500, 2500);
  uint32_t duty = (uint32_t)((us / 20000.0) * 4095);

  ledcWrite(pin, duty); 

  lastServoCommandTime = millis(); 
  servosNeedFreeze = true; 
}

void freezeServo(uint8_t pin) {
  pinMode(pin, OUTPUT);
  digitalWrite(pin, HIGH);
}
void startStream();
void stopStream();


WebSocketsClient ws;
AsyncWebServer server(80);
volatile bool streaming = false;

Preferences prefs;

// 1. Get the last 2 bytes of the Mac Address to create a unique ID
uint64_t chipid = ESP.getEfuseMac();
uint16_t uniqueID = (uint16_t)(chipid >> 30);

// 2. Format a unique hostname string (e.g., esp32cam-a1b2)
String hostname = "esp32cam-" + String(uniqueID, HEX);
String camName;

void onWsEvent(WStype_t type, uint8_t *payload, size_t len) {
  switch(type) {
    case WStype_CONNECTED:
      Serial.println("WebSocket Connected to Pi!");
      break;
    case WStype_DISCONNECTED:
      Serial.println("WebSocket Disconnected!");
      break;
    case WStype_TEXT:
      StaticJsonDocument<256> request;
      StaticJsonDocument<256> reply;
      bool shouldSend = false;
      deserializeJson(request, payload, len);

      if (request["type"] == "servo_cmd") {
        float pan = request["data"]["x"].as<uint8_t>();
        float tilt = request["data"]["y"].as<uint8_t>();
        Serial.print("Pan: "); 
        Serial.print(pan);
        Serial.print(" | Tilt: "); 
        Serial.println(tilt);
        writeServo(PAN_PIN, pan);
        writeServo(TILT_PIN, tilt);
      }
      
      if (request["type"] == "laser_cmd") {
        Serial.println(request["data"].as<const char*>());
        if (request["data"] == "on") {
          digitalWrite(4, HIGH);
          reply["type"] = "status_update";
          reply["role"] = "cam_2";
          reply["status"] = "on";
          reply["clientID"] = request["clientID"];
          shouldSend = true;
        }
        if (request["data"] == "off") {
          digitalWrite(4, LOW);
          reply["type"] = "status_update";
          reply["role"] = "cam_2";
          reply["status"] = "off";
          reply["clientID"] = request["clientID"];
          shouldSend = true;
        }
      }

      if (request["type"] == "init_conn") {
        Serial.println("init_conn received from Pi");
        reply["type"] = "init_conn";
        reply["role"] = "cam_2";
        reply["streamId"] = String(uniqueID, HEX);
        reply["camName"] = camName;
        shouldSend = true;
      }

      if (request["type"] == "set_cam_name") {
        String newName = request["name"].as<String>();
        if (newName.length() > 0 && newName.length() <= 32) {
          camName = newName;
          prefs.begin("cam_cfg", false);
          prefs.putString("cam_name", camName);
          prefs.end();
          Serial.print("Camera name set to: ");
          Serial.println(camName);
        }
      }
      if (shouldSend) {
        String out;
        serializeJson(reply, out);
        ws.sendTXT(out);
      }
      break;
  }
}

void setupWebSocket() {
  ws.begin("192.168.1.101", 5000);
  ws.onEvent(onWsEvent);
  ws.setReconnectInterval(3000);
}


void setupHttp() {
  server.on("/stream", HTTP_GET, [](AsyncWebServerRequest *request) {

    streaming = true;
    Serial.println("video stream requested");
    request->onDisconnect([]() {
      streaming = false; 
      Serial.println("Video stream stopped: Client disconnected");
    });
    AsyncWebServerResponse *response =
      request->beginChunkedResponse(
        "multipart/x-mixed-replace; boundary=frame",
        [](uint8_t *buffer, size_t maxLen, size_t index) -> size_t {
          static camera_fb_t *fb = nullptr;
          static size_t sent = 0;
          static char header[128];
          static const char* footer = "\r\n";

          if (!streaming) {
            if (fb) esp_camera_fb_return(fb);
            fb = nullptr;
            return 0;
          }
          
          if (!fb) {
            fb = esp_camera_fb_get();
            if (!fb) {
              Serial.println("frame capture failed, stream stopped");
              return 0;
            }
            snprintf(header, sizeof(header),
              "--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n",
              fb->len
            );

            sent = 0;
          }

          size_t header_len = strlen(header);
          size_t footer_len = 2;
          size_t total_len = header_len + fb->len + footer_len;

          size_t remaining = total_len - sent;
          size_t canSend = min(remaining, maxLen);

          if (canSend > 0) {
            if (sent < header_len) {
              size_t toCopy = min(header_len - sent, canSend);
              memcpy(buffer, header + sent, toCopy);
              sent += toCopy;
              return toCopy;
            }
            else if (sent < header_len + fb->len) {
              size_t imgOffset = sent - header_len;
              size_t toCopy = min(fb->len - imgOffset, canSend);
              memcpy(buffer, fb->buf + imgOffset, toCopy);
              sent += toCopy;
              return toCopy;
            }
            else {
              size_t footerOffset = sent - (header_len + fb->len);
              size_t toCopy = min(footer_len - footerOffset, canSend);
              memcpy(buffer, footer + footerOffset, toCopy);
              sent += toCopy;

              if (sent >= total_len) {
                esp_camera_fb_return(fb);
                fb = nullptr;
                sent = 0;
              }
              return toCopy;
            }
        }
        return 0;
    });
    response->addHeader("Access-Control-Allow-Origin", "*");
    request->send(response);
  });

  server.begin();
}

void setup() {
  Serial.begin(115200);
  prefs.begin("cam_cfg", true);
  camName = prefs.getString("cam_name", String(uniqueID, HEX));
  prefs.end();
  Serial.println(psramFound());


  Serial.println("a");

  if (!psramFound()) {
    Serial.println("PSRAM NOT FOUND");
  } else {
    Serial.println("PSRAM OK");
  }

  if (esp_camera_init(&camera_config) != ESP_OK) {
    Serial.println("Camera init failed");
    return;
  }


  pinMode(4, OUTPUT);
  setupServos();
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("WiFi connected");
  WiFi.setSleep(false);
  if (!MDNS.begin(hostname)) {
    Serial.println("mDNS failed");
  }
  Serial.println(hostname);
  setupWebSocket();
  setupHttp();
}


void loop() {
  ws.loop();
  if (servosNeedFreeze && (millis() - lastServoCommandTime >= 1000)) {
    // Writing 4095 forces the PWM wave to become a solid, flat 5V HIGH line 
    // without disconnecting the internal hardware channels.
    ledcWrite(PAN_PIN, 4095);
    ledcWrite(TILT_PIN, 4095);

    servosNeedFreeze = false;
    Serial.println("Channels paused cleanly via max duty cycle.");
  }
  delay(1);
}