# EMG Wearable App

An iOS companion app for an ESP32-based EMG (muscle sensor) + MPU-6050 (IMU) wearable. It
connects over Bluetooth LE, shows three live scrolling charts, lets you mark reps during a
workout, and exports the whole session as a two-sheet Excel workbook — replacing a
`pyserial` + `matplotlib` desktop tool that read the same data over USB serial.

This project targets **iOS on a physical iPhone**. BLE does not work in the iOS Simulator, so
there is no simulator flow here — see [Running on your iPhone](#running-on-your-iphone) below.
Android has not been configured or tested (see [Android](#android) at the bottom).

## What it does

1. **Scan screen** — scans for a BLE peripheral advertising the Nordic UART Service UUID used
   by the ESP32 firmware, filters by device name (`EMG-IMU-ESP32`), lists RSSI, and connects on tap.
2. **Live session screen** — once connected:
   - Three live, scrolling Skia-drawn charts sharing the same ~500-sample window:
     EMG envelope, upper-arm tilt/roll angle (`atan2(ay_g, az_g)` in degrees), and gyroscope
     X/Y/Z overlaid on one panel.
   - A stats bar: elapsed time, sample count, current envelope value, rep count.
   - **Start/Stop** controls recording; the charts run and samples are recorded only between
     Start and Stop (see [Charts only run during a recording](#charts-only-run-during-a-recording)).
   - A large **Mark Rep** button (active only while recording) drops a labeled vertical marker
     (R1, R2, R3…) onto all three charts at the current sample.
   - If the BLE connection drops mid-session, the app auto-retries briefly, then shows a
     reconnect banner with **Try Reconnect** and **Stop & Export** — nothing recorded so far is lost.
   - **Export Session** (enabled once you've stopped a recording with at least one sample) builds
     a single timestamped `.xlsx` file and opens the iOS share sheet (AirDrop, Save to Files, etc).

### Export format

One file per session, e.g. `emg_session_2026-09-12_14-30-05.xlsx`, with two sheets:

- **EMG_IMU** — `Sample, Time_s, Signal, Envelope, ax_g, ay_g, az_g, gx_dps, gy_dps, gz_dps, IMU_fresh`
  (`Time_s` rounded to 5 decimals, `Signal`/`Envelope` to 2, accel-g to 4, gyro-dps to 3)
- **RepAnnotations** — `Rep, ApproxSample, Time_s, Notes` (`Notes` left blank for you to fill in later)

### BLE protocol (firmware side, unchanged)

- Device name: `EMG-IMU-ESP32`, NUS service `6E400001-…`, notify characteristic `6E400003-…`.
- Each notification is one full ASCII CSV row: `signal,envelope,ax,ay,az,gx,gy,gz,imu_fresh`.
- Accel counts ÷ 16384.0 → g; gyro counts ÷ 131.0 → °/s. `imu_fresh` is logged as-is (not
  interpolated) — roughly every other row repeats the last IMU sample, by design.

## Assumptions worth knowing about

A couple of product decisions weren't fully specified in the original brief. Both are easy to
change (they're isolated to a few lines) but are called out here so nothing is a surprise:

#### Charts only run during a recording

The ESP32 streams continuously once connected, regardless of the phone's Start/Stop state. This
app only feeds that stream into the charts and the stats bar while a recording is active (i.e.
between Start and Stop), so the on-screen "sample" numbering always matches the numbering in the
exported spreadsheet. Before you hit Start, the charts sit empty; after Stop, they freeze on the
last window so you can review it before exporting. If you'd rather see live data as soon as you
connect (before Start), that's a small change to `LiveSessionScreen.tsx`'s sample subscription.

#### Rep markers can scroll out of view

Like the original desktop tool's scrolling window, once a rep marker's sample number falls
outside the last ~500 recorded samples, its vertical line scrolls off the chart (the full rep
list is still recorded correctly in `RepAnnotations` regardless).

## Tech stack

- React Native CLI (bare, TypeScript template) — **not Expo Go**, so the native BLE module works.
- `react-native-ble-plx` for scanning/connecting/notifications.
- `@shopify/react-native-skia` for the three real-time charts (custom, lightweight — points are
  pushed into each chart via an imperative ref handle instead of React state, so the ~50 Hz BLE
  stream never forces a re-render of the rest of the screen).
- `xlsx` (SheetJS) to build the workbook in pure JS, `react-native-fs` to write it to disk, and
  `react-native-share` to open the iOS share sheet.

## Project layout
 
```
App.tsx                          Screen switcher (Scan ⇄ Live Session) + BLE hook ownership
src/
  ble/
    constants.ts                 UUIDs, device name, scale constants, sample window size
    BleManager.ts                Thin wrapper around react-native-ble-plx
    parser.ts                    CSV row → typed, unit-converted ParsedSample + roll angle
  screens/
    ScanScreen.tsx
    LiveSessionScreen.tsx
  components/
    LiveChart.tsx                Reusable Skia real-time chart with rep-marker overlays
    RepMarkerButton.tsx
    SessionControls.tsx
    StatsBar.tsx
    ConnectionStatusBadge.tsx
  hooks/
    useBleDevice.ts              Connection lifecycle + sample subscription stream
    useSessionRecorder.ts        start/stop/recordRow/markRep/reset; holds rows[] + reps[]
  export/
    exportSession.ts             Builds the two-sheet workbook, writes it, shares it
  types/
    index.ts
```

## First-time setup

You'll need a Mac with Xcode installed, and CocoaPods (`brew install cocoapods` or via the
project's bundled Ruby gems — see below).

```sh
npm install
cd ios
bundle install        # first time only, installs CocoaPods via the project's Gemfile
bundle exec pod install
cd ..
```

> **Note on this repo's current state:** dependencies are already installed and the project
> type-checks cleanly, but `pod install` could not be run in the environment this was built in —
> the machine's `xcodebuild` is currently broken (a CoreDevice/library-loading error, unrelated to
> this project — likely an Xcode version mismatch with the OS). Run `xcodebuild -version` to check
> yours; if it errors the same way, reinstall Xcode's command line tools
> (`xcode-select --install`, or update Xcode from the App Store) before running `pod install`.

### Running on your iPhone

BLE doesn't work in the iOS Simulator, so you need a physical iPhone connected via USB (or on
the same network for wireless debugging):

1. Open `ios/EMGWearableApp.xcworkspace` in Xcode (not the `.xcodeproj`).
2. Select the `EMGWearableApp` target → **Signing & Capabilities**.
3. Under **Team**, choose your Apple ID (add one via Xcode → Settings → Accounts if needed). With
   a free personal team, Xcode will generate a development certificate automatically — you may
   need to change the **Bundle Identifier** to something unique if `org.reactjs.native.example.*`
   is taken.
4. Plug in your iPhone, select it as the run destination (top toolbar), and press Run — or from
   the terminal:
   ```sh
   npx react-native run-ios --device "Your iPhone's Name"
   ```
5. The first time you run a development-signed app on a physical device, iOS will block it until
   you trust the developer certificate: **Settings → General → VPN & Device Management →
   [your Apple ID] → Trust**.

Once installed, launch the app, grant the Bluetooth permission prompt when asked, power on the
ESP32, and tap **Scan for Device**.

## Troubleshooting

**Bluetooth permission denied / never prompted**
iOS only shows the permission dialog once. If you dismissed it or previously denied it, go to
**Settings → [App Name] → Bluetooth** and enable it, or **Settings → Privacy & Security →
Bluetooth** to check the app is listed and allowed. The Scan screen shows a specific banner when
`powerState` is `unauthorized`.

**Device not found while scanning**
- Make sure the ESP32 is powered on and within range — it can only be connected to one central
  at a time, so confirm nothing else (a phone, the old Python tool over BLE, etc.) is already
  connected to it.
- Double-check the advertised name matches `EMG-IMU-ESP32` exactly (case-sensitive) and that it's
  advertising the service UUID `6E400001-B5A3-F393-E0A9-E50E24DCCA9E` — the scan filters on both.
- The scan automatically stops after 15 seconds; tap **Scan for Device** again to retry.
- Bluetooth must be on (see the banner at the top of the Scan screen if it isn't).

**Connection drops during a session**
The app registers a disconnect handler as soon as it connects and will automatically try to
reconnect to the same device for a few seconds. If that fails, a banner appears with **Try
Reconnect** (retries the same device again) and, if you were mid-recording, **Stop & Export**
(stops recording and immediately shares whatever was captured before the drop — no data is lost
by a drop). Common causes: the iPhone went out of range, the ESP32 lost power, or another app/
device connected to the ESP32 first.

**Export button is disabled**
It's only enabled after you've pressed Stop and at least one sample was recorded during that
session — pressing Start again resets the in-memory row/rep list for a fresh recording.

## Android

The React Native CLI scaffold includes an `android/` project, and `useBleDevice`/`BleManager`
request the Android 12+ runtime Bluetooth permissions defensively, but the Android side has not
been configured (no manifest permissions added) or tested end-to-end — this was scoped as an iOS
companion app. Treat Android as a possible future addition, not a supported target today.

## Exact commands used to scaffold this project

For reference, this is how the project was created from scratch:

```sh
npx @react-native-community/cli@latest init EMGWearableApp --pm npm
cd EMGWearableApp

npm install react-native-ble-plx @shopify/react-native-skia xlsx react-native-fs react-native-share

cd ios
bundle install
bundle exec pod install
cd ..

npx react-native run-ios --device "Your iPhone's Name"
```
