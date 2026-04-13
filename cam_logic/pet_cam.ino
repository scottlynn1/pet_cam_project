#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ESPAsyncWebServer.h>
#include "esp_camera.h"
#include <ArduinoJson.h>
#include <ESP32Servo.h>
#include <ESPmDNS.h>
#include "camera_pins.h"

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
  .frame_size = FRAMESIZE_QVGA,  // 320x240, low RAM for ESP32
  .jpeg_quality = 10,
  .fb_count = 1
};
void moveServos(float pan, float tilt);
void startStream();
void stopStream();


Servo panServo;
Servo tiltServo;

WebSocketsClient ws;
AsyncWebServer server(80);
volatile bool streaming = false;

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
        moveServos(pan, tilt);
      }
      
      if (request["type"] == "laser_cmd") {
        Serial.println(request["data"].as<const char*>());
        if (request["data"] == "on") {
          digitalWrite(13, HIGH);
          reply["type"] = "status_update";
          reply["role"] = "cam_1";
          reply["status"] = "on";
          reply["clientID"] = request["clientID"];
          shouldSend = true;
        }
        if (request["data"] == "off") {
          digitalWrite(13, LOW);
          reply["type"] = "status_update";
          reply["role"] = "cam_1";
          reply["status"] = "off";
          reply["clientID"] = request["clientID"];
          shouldSend = true;
        }
      }

      if (request["type"] == "init_conn") {
        Serial.println("init_conn received from Pi");
        reply["type"] = "init_conn";
        reply["role"] = "cam_1";
        reply["streamId"] = 1;
          shouldSend = true;
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
  ws.begin("scottberry.local", 5000);
  ws.onEvent(onWsEvent);
  ws.setReconnectInterval(3000);
}


void moveServos(float pan, float tilt) {
  panServo.write(pan);
  tiltServo.write(tilt);
}

void setupHttp() {
  server.on("/stream/1", HTTP_GET, [](AsyncWebServerRequest *request) {

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
          static String header;

          if (!streaming) return 0;

          if (!fb) {
            fb = esp_camera_fb_get();
            if (!fb) {
              Serial.println("frame capture failed, stream stoped");
              return 0;
            }

            header =
              "--frame\r\n"
              "Content-Type: image/jpeg\r\n"
              "Content-Length: " + String(fb->len) + "\r\n\r\n";

            sent = 0;
          }

          if (sent < header.length()) {
            size_t hlen = header.length() - sent;
            size_t toCopy = min(hlen, maxLen);
            memcpy(buffer, header.c_str() + sent, toCopy);
            sent += toCopy;
            return toCopy;
          }

          size_t imgOffset = sent - header.length();
          size_t remaining = fb->len - imgOffset;
          size_t toCopy = min(remaining, maxLen);

          memcpy(buffer, fb->buf + imgOffset, toCopy);
          sent += toCopy;

          if (sent >= header.length() + fb->len) {
            esp_camera_fb_return(fb);
            fb = nullptr;
            sent = 0;
          }

          return toCopy;
        }
      );
    response->addHeader("Access-Control-Allow-Origin", "*");
    request->send(response);
  });

  server.begin();
}


// void startStream() {
//   if (!streaming) {
//     streaming = true;
//   }
// }

// void stopStream() {
//   if (streaming) {
//     streaming = false;
//   }
// }

void setup() {
  Serial.begin(115200);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("WiFi connected");

  if (!MDNS.begin("esp32cam")) {
    Serial.println("mDNS failed");
  }
  panServo.attach(14); // example GPIO
  tiltServo.attach(15);
  pinMode(13, OUTPUT);
  if (esp_camera_init(&camera_config) != ESP_OK) {
    Serial.println("Camera init failed");
    return;
  }
  setupWebSocket();
  setupHttp();
}


void loop() {
  ws.loop();
}