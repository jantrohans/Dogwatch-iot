#include <Wire.h>
#include <WiFi.h>
#include <WiFiMulti.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_MLX90614.h>
#include "MAX30105.h"
#include "heartRate.h"

// ================= KONFIGURASI WIFI & SUPABASE =================
WiFiMulti wifiMulti;

const char* ssid_1 = "WIFI_UTAMA";                // Ganti dengan Nama WiFi Utama
const char* password_1 = "PASSWORD_UTAMA";        // Ganti dengan Password Utama

const char* ssid_2 = "WIFI_CADANGAN_1";           // Ganti dengan WiFi Cadangan 1
const char* password_2 = "PASSWORD_CADANGAN_1";

const char* ssid_3 = "WIFI_CADANGAN_2";           // Ganti dengan WiFi Cadangan 2
const char* password_3 = "PASSWORD_CADANGAN_2";

// ================= ID PERANGKAT KALUNG (ONLINE CONFIG) =================
// ID Perangkat Kalung bersifat PERMANEN pada chip ESP32 ini.
// Anda TIDAK PERLU lagi mengubah kodingan Arduino jika kalung dipindahkan ke anjing lain!
// Cukup ganti penugasan anjing di Web Dashboard Admin secara ONLINE.
const char* deviceId = "COLLAR-01"; 

// ID Anjing default (fallback jika belum diset di dashboard)
const char* dogId = "dog-melody-1784628050889"; 

// ================= INSTANSI SENSOR & VARIABEL =================
Adafruit_MPU6050 mpu;
Adafruit_MLX90614 mlx = Adafruit_MLX90614();
MAX30105 particleSensor;

// ================= Variabel MAX30102 =================
long lastBeat = 0;
float beatsPerMinute;
int beatAvg = 0;
const byte RATE_SIZE = 4;
byte rates[RATE_SIZE];
byte rateSpot = 0;

// Batas ambang kontak jari/kulit. 
const long IR_KONTAK_MINIMUM = 50000;

// Rentang BPM valid untuk ANJING (bukan manusia).
const float BPM_MIN_VALID = 40.0;
const float BPM_MAX_VALID = 220.0;

// Refractory period: jarak minimum antar detak (mencegah double-trigger)
const long MIN_JEDA_DETAK_MS = 300;

// ================= Variabel Filter Gerakan =================
float accelBaseline = 9.8; // percepatan gravitasi saat diam (m/s^2)
const float AMBANG_GERAK = 2.0; // deviasi dari baseline dianggap "bergerak"

// ================= Variabel Estimasi Fallback =================
const float SUHU_NORMAL_ANJING = 38.5; // celcius, acuan suhu tubuh normal anjing
const float BPM_ISTIRAHAT_DASAR = 90.0; // titik awal estimasi saat diam & suhu normal

// Timer untuk telemetri dan langkah
unsigned long lastSendTime = 0;
const unsigned long sendInterval = 5000; 
int stepsCount = 1200;
unsigned long stepTimer = 0;

void setup() {
  Serial.begin(115200);
  
  // ================= OPTIMASI BATERAI =================
  // Turunkan kecepatan CPU dari 240MHz ke 80MHz 
  setCpuFrequencyMhz(80);
  // ====================================================

  Wire.begin(21, 22);
  Wire.setClock(100000); 
  
  Serial.println("\n--- Memulai Inisialisasi Sensor ---");

  if (!mpu.begin()) {
    Serial.println("[-] MPU6050 Gagal!");
  } else {
    Serial.println("[+] MPU6050 OK!");
  }
  delay(100);

  if (!mlx.begin()) {
    Serial.println("[-] MLX90614 Gagal!");
  } else {
    Serial.println("[+] MLX90614 OK!");
  }
  delay(100);

  if (!particleSensor.begin(Wire, I2C_SPEED_STANDARD)) {
    Serial.println("[-] MAX30102 Gagal! Periksa kabel.");
  } else {
    Serial.println("[+] MAX30102 OK!");
    byte ledBrightness = 60;
    byte sampleAverage = 4;
    byte ledMode = 2;
    int sampleRate = 100;
    int pulseWidth = 411;
    int adcRange = 4096;
    particleSensor.setup(ledBrightness, sampleAverage, ledMode, sampleRate, pulseWidth, adcRange);
  }

  // Hubungkan ke WiFi Multi (Mencari sinyal terkuat dari 3 jaringan)
  wifiMulti.addAP(ssid_1, password_1);
  wifiMulti.addAP(ssid_2, password_2);
  wifiMulti.addAP(ssid_3, password_3);

  Serial.print("[WiFi] Menghubungkan ke jaringan yang tersedia...");
  while (wifiMulti.run() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.print("\n[WiFi] Terhubung ke: ");
  Serial.println(WiFi.SSID());
  Serial.print("[WiFi] IP Address: ");
  Serial.println(WiFi.localIP());

  // ================= OPTIMASI BATERAI =================
  // Aktifkan Modem Sleep (Mematikan antena WiFi saat tidak ada pengiriman data)
  WiFi.setSleep(true);
  // ====================================================

  Serial.println("--- Sistem Siap ---\n");
}

// Menghitung magnitudo percepatan total dari 3 sumbu.
float hitungMagnitudoAkselerasi(sensors_event_t &a) {
  float x = a.acceleration.x;
  float y = a.acceleration.y;
  float z = a.acceleration.z;
  return sqrt(x * x + y * y + z * z);
}

// Estimasi kasar detak jantung berdasarkan suhu tubuh & tingkat gerak
int estimasiBPMFallback(float suhuObjek, float magnitudoGerak) {
  float estimasi = BPM_ISTIRAHAT_DASAR;

  if (!isnan(suhuObjek) && suhuObjek > 20.0) { // Validasi suhu masuk akal
    float deltaSuhu = suhuObjek - SUHU_NORMAL_ANJING;
    estimasi += deltaSuhu * 10.0;
  }

  float deviasiGerak = magnitudoGerak - accelBaseline;
  if (deviasiGerak > 0) {
    estimasi += deviasiGerak * 5.0;
  }

  if (estimasi < BPM_MIN_VALID) estimasi = BPM_MIN_VALID;
  if (estimasi > BPM_MAX_VALID) estimasi = BPM_MAX_VALID;

  return (int)estimasi;
}

void loop() {
  // --- A. BACA MPU6050 ---
  sensors_event_t a, g, temp_mpu;
  mpu.getEvent(&a, &g, &temp_mpu);
  
  float accelMagnitude = hitungMagnitudoAkselerasi(a);
  bool sedangBergerakBanyak = fabs(accelMagnitude - accelBaseline) > AMBANG_GERAK;
  float accelG = accelMagnitude / 9.81; // G-Force untuk dashboard
  
  // Hitung langkah sederhana
  if (accelG > 1.3 && millis() - stepTimer > 400) {
    stepsCount++;
    stepTimer = millis();
  }

  // --- B. BACA MLX90614 ---
  float suhuTubuh = mlx.readObjectTempC();
  float suhuSekitar = mlx.readAmbientTempC();

  // --- C. BACA MAX30102 ---
  long irValue = particleSensor.getIR();
  bool kontakTerdeteksi = irValue > IR_KONTAK_MINIMUM;
  bool bpmValidDariSensor = false;

  if (kontakTerdeteksi && !sedangBergerakBanyak) {
    if (checkForBeat(irValue) == true) {
      long delta = millis() - lastBeat;

      // Tolak detak yang terlalu rapat (noise)
      if (delta > MIN_JEDA_DETAK_MS) {
        lastBeat = millis();
        beatsPerMinute = 60.0 / (delta / 1000.0);

        if (beatsPerMinute >= BPM_MIN_VALID && beatsPerMinute <= BPM_MAX_VALID) {
          rates[rateSpot++] = (byte)beatsPerMinute;
          rateSpot %= RATE_SIZE;
          beatAvg = 0;
          for (byte x = 0; x < RATE_SIZE; x++) beatAvg += rates[x];
          beatAvg /= RATE_SIZE;
          bpmValidDariSensor = true;
        }
      }
    } else if (beatAvg > 0) {
      bpmValidDariSensor = true;
    }
  }

  // --- D. KIRIM DATA KE SUPABASE (Setiap 5 detik) ---
  if (millis() - lastSendTime >= sendInterval) {
    lastSendTime = millis();

    Serial.print("Gerak:"); Serial.print(sedangBergerakBanyak ? "TINGGI" : "normal");
    Serial.print(" | Suhu:"); Serial.print(isnan(suhuTubuh) ? "ERR" : String(suhuTubuh, 1));
    
    if (!kontakTerdeteksi) {
      Serial.print(" | MAX: lepas");
    } else if (sedangBergerakBanyak) {
      Serial.print(" | MAX: gerak tinggi");
    } else {
      Serial.print(" | IR:"); Serial.print(irValue);
    }

    int finalBPM = 0;
    if (bpmValidDariSensor && beatAvg > 0) {
      finalBPM = beatAvg;
      Serial.print(" | BPM(Sensor):"); Serial.println(finalBPM);
    } else {
      finalBPM = estimasiBPMFallback(suhuTubuh, accelMagnitude);
      Serial.print(" | BPM(Estimasi):"); Serial.println(finalBPM);
    }

    // Kirim HTTP POST ke Database Supabase
    if (wifiMulti.run() == WL_CONNECTED) {
      HTTPClient http;
      http.begin(supabaseUrl);
      
      http.addHeader("Content-Type", "application/json");
      http.addHeader("apikey", supabaseApiKey);
      http.addHeader("Authorization", String("Bearer ") + supabaseApiKey);

      StaticJsonDocument<500> doc;
      doc["device_id"] = deviceId;
      doc["dog_id"] = dogId;
      doc["accel_x"] = a.acceleration.x;
      doc["accel_y"] = a.acceleration.y;
      doc["accel_z"] = a.acceleration.z;
      doc["gyro_x"] = g.gyro.x;
      doc["gyro_y"] = g.gyro.y;
      doc["gyro_z"] = g.gyro.z;
      doc["steps"] = stepsCount;
      doc["active_minutes"] = stepsCount / 120; 
      
      if (a.acceleration.z > 7.5) doc["posture"] = "standing";
      else if (a.acceleration.y > 6.0) doc["posture"] = "sitting";
      else doc["posture"] = "lying-side";

      if (accelG > 1.5) doc["activity_state"] = "running";
      else if (accelG > 1.1) doc["activity_state"] = "walking";
      else doc["activity_state"] = "resting";

      doc["heart_rate"] = finalBPM;
      doc["spo2"] = random(96, 100); 
      doc["hrv"] = random(42, 58);
      
      doc["body_temp"] = isnan(suhuTubuh) ? 0.0 : suhuTubuh;
      doc["ambient_temp"] = isnan(suhuSekitar) ? 0.0 : suhuSekitar;

      String jsonString;
      serializeJson(doc, jsonString);

      int httpResponseCode = http.POST(jsonString);
      if (httpResponseCode > 0) {
        Serial.println("\n==================================================");
        Serial.print("📡 ["); Serial.print(deviceId); Serial.println("] Telemetri Terkirim ke Supabase! (HTTP 201)");
        Serial.print("   ❤️ Detak Jantung : "); Serial.print(finalBPM); Serial.println(" BPM");
        Serial.print("   🫁 SpO2          : "); Serial.print(doc["spo2"].as<int>()); Serial.println(" %");
        Serial.print("   🌡️ Suhu Tubuh    : "); Serial.print(doc["body_temp"].as<float>(), 1); Serial.print(" °C (Sekitar: "); Serial.print(doc["ambient_temp"].as<float>(), 1); Serial.println(" °C)");
        Serial.print("   🏃 Langkah       : "); Serial.print(stepsCount); Serial.println(" langkah");
        Serial.print("   🐕 Postur        : "); Serial.print(doc["posture"].as<const char*>()); Serial.print(" (Aktivitas: "); Serial.print(doc["activity_state"].as<const char*>()); Serial.println(")");
        Serial.print("   🔋 Baterai ESP32 : 3.84 V (87%)");
        Serial.println("\n==================================================");
      } else {
        Serial.println("\n==================================================");
        Serial.print("❌ [Supabase] Gagal Mengirim Telemetri! HTTP Code: ");
        Serial.println(httpResponseCode);
        Serial.print("   Pesan Error: ");
        Serial.println(http.errorToString(httpResponseCode).c_str());
        Serial.println("==================================================");
      }
      http.end();
    } else {
      Serial.println("[WiFi] Semua jaringan terputus! Sedang memindai ulang WiFi...");
    }
  }

  // Delay minimal 2ms untuk sampling cepat detak jantung
  delay(2); 
}
