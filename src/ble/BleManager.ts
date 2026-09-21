import { Platform, PermissionsAndroid } from 'react-native';
import {
  BleManager as BlePlxManager,
  Device,
  Subscription,
  BleError,
  State,
} from 'react-native-ble-plx';
import {
  SERVICE_UUID,
  TX_CHARACTERISTIC_UUID,
  DEVICE_NAME,
} from './constants';
import type { DiscoveredDevice, BluetoothPowerState } from '../types';

export type RowListener = (csv: string) => void;
export type ErrorListener = (error: Error) => void;
export type DisconnectListener = (error: BleError | null) => void;
export type PowerStateListener = (state: BluetoothPowerState) => void;

/**
 * react-native-ble-plx's `State` enum uses PascalCase string values (e.g.
 * 'PoweredOn', 'Unauthorized') — map them explicitly to this app's camelCase
 * BluetoothPowerState rather than casting, since the two do not line up.
 */
function mapPowerState(state: State): BluetoothPowerState {
  switch (state) {
    case State.PoweredOn:
      return 'poweredOn';
    case State.PoweredOff:
      return 'poweredOff';
    case State.Unauthorized:
      return 'unauthorized';
    case State.Unsupported:
      return 'unsupported';
    case State.Resetting:
      return 'resetting';
    case State.Unknown:
    default:
      return 'unknown';
  }
}

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Decode a base64 BLE characteristic value into the ASCII string the ESP32 sent.
 * react-native-ble-plx always hands characteristic values back base64-encoded.
 * Implemented by hand (no `atob`/Buffer dependency) since neither is guaranteed
 * to exist as a global across RN/Hermes versions.
 */
function base64ToAscii(base64: string): string {
  const clean = base64.replace(/=+$/, '');
  let bits = 0;
  let bitCount = 0;
  let out = '';

  for (let i = 0; i < clean.length; i++) {
    const value = BASE64_ALPHABET.indexOf(clean[i]);
    if (value === -1) {
      continue;
    }
    bits = (bits << 6) | value;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      out += String.fromCharCode((bits >> bitCount) & 0xff);
    }
  }

  return out;
}

/**
 * Thin wrapper around react-native-ble-plx scoped to this app's single-service,
 * single-characteristic use case: scan for the ESP32, connect, and subscribe to
 * its notify characteristic.
 */
class EmgBleManager {
  private manager = new BlePlxManager();
  private connectedDevice: Device | null = null;
  private notifySubscription: Subscription | null = null;
  private disconnectSubscription: Subscription | null = null;

  /** Subscribe to Bluetooth radio power state changes (poweredOn/poweredOff/etc). */
  onStateChange(listener: PowerStateListener, emitCurrent = true): Subscription {
    return this.manager.onStateChange(state => {
      listener(mapPowerState(state));
    }, emitCurrent);
  }

  /**
   * Request the runtime permissions BLE scanning needs on Android. iOS handles
   * this automatically via the NSBluetooth*UsageDescription Info.plist entries
   * and the system permission dialog, so this is a no-op there.
   */
  async requestPermissions(): Promise<boolean> {
    if (Platform.OS !== 'android') {
      return true;
    }

    if (Number(Platform.Version) >= 31) {
      const results = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ]);
      return (
        results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] ===
          PermissionsAndroid.RESULTS.GRANTED &&
        results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] ===
          PermissionsAndroid.RESULTS.GRANTED
      );
    }

    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  }

  /**
   * Start scanning for peripherals advertising the EMG/IMU service UUID.
   * Filters again on device name as a belt-and-braces check.
   */
  startScan(
    onDeviceFound: (device: DiscoveredDevice) => void,
    onError: ErrorListener,
  ): void {
    this.manager.startDeviceScan(
      [SERVICE_UUID],
      { allowDuplicates: true },
      (error, device) => {
        if (error) {
          onError(error);
          return;
        }
        if (!device) {
          return;
        }
        const name = device.name ?? device.localName ?? null;
        if (name !== DEVICE_NAME) {
          return;
        }
        onDeviceFound({ id: device.id, name, rssi: device.rssi });
      },
    );
  }

  stopScan(): void {
    this.manager.stopDeviceScan();
  }

  /** Connect to a device by id, discover services, and register a disconnect handler. */
  async connect(
    deviceId: string,
    onDisconnected: DisconnectListener,
  ): Promise<Device> {
    const device = await this.manager.connectToDevice(deviceId, {
      autoConnect: false,
    });
    await device.discoverAllServicesAndCharacteristics();
    this.connectedDevice = device;

    this.disconnectSubscription?.remove();
    this.disconnectSubscription = this.manager.onDeviceDisconnected(
      device.id,
      error => {
        onDisconnected(error);
      },
    );

    return device;
  }

  /** Subscribe to the TX characteristic; invokes onRow with each decoded CSV row. */
  subscribeToRows(onRow: RowListener, onError: ErrorListener): void {
    if (!this.connectedDevice) {
      throw new Error('subscribeToRows called with no connected device');
    }

    this.notifySubscription?.remove();
    this.notifySubscription = this.connectedDevice.monitorCharacteristicForService(
      SERVICE_UUID,
      TX_CHARACTERISTIC_UUID,
      (error, characteristic) => {
        if (error) {
          onError(error);
          return;
        }
        if (characteristic?.value) {
          onRow(base64ToAscii(characteristic.value));
        }
      },
    );
  }

  /** Reconnect to a previously-connected device id (used after an unexpected drop). */
  async reconnect(
    deviceId: string,
    onDisconnected: DisconnectListener,
  ): Promise<Device> {
    return this.connect(deviceId, onDisconnected);
  }

  async disconnect(): Promise<void> {
    this.notifySubscription?.remove();
    this.notifySubscription = null;
    this.disconnectSubscription?.remove();
    this.disconnectSubscription = null;

    const device = this.connectedDevice;
    this.connectedDevice = null;
    if (device) {
      try {
        const stillConnected = await this.manager.isDeviceConnected(device.id);
        if (stillConnected) {
          await this.manager.cancelDeviceConnection(device.id);
        }
      } catch {
        // Device was already disconnected; nothing further to clean up.
      }
    }
  }

  destroy(): void {
    this.manager.destroy();
  }
}

export const bleManager = new EmgBleManager();
export { State as BlePowerState };
