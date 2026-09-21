import { useCallback, useEffect, useRef, useState } from 'react';
import type { BleError } from 'react-native-ble-plx';
import { bleManager } from '../ble/BleManager';
import { parseSensorRow } from '../ble/parser';
import { RECONNECT_TIMEOUT_MS, SCAN_TIMEOUT_MS } from '../ble/constants';
import type {
  BleConnectionState,
  BluetoothPowerState,
  DiscoveredDevice,
  ParsedSample,
} from '../types';

export type SampleListener = (sample: ParsedSample) => void;

export interface UseBleDeviceResult {
  connectionState: BleConnectionState;
  powerState: BluetoothPowerState;
  discoveredDevices: DiscoveredDevice[];
  connectedDeviceName: string | null;
  lastError: string | null;
  /** Begin scanning for the ESP32; resolves once scanning has started. */
  startScan: () => Promise<void>;
  stopScan: () => void;
  connect: (deviceId: string) => Promise<void>;
  disconnect: () => Promise<void>;
  /** Manually retry connecting to the last-connected device after a drop. */
  resumeAfterDrop: () => Promise<void>;
  /** Register a listener invoked with every freshly-parsed sample. Returns an unsubscribe fn. */
  subscribeToSamples: (listener: SampleListener) => () => void;
}

/**
 * Owns the BLE connection lifecycle for the EMG/IMU peripheral: scanning,
 * connecting, subscribing to notifications, and reconnecting after an
 * unexpected drop. Parsed samples are fanned out to subscribers rather than
 * stored in React state, so the ~50Hz notification stream never forces a
 * re-render of this hook's consumers.
 */
export function useBleDevice(): UseBleDeviceResult {
  const [connectionState, setConnectionState] =
    useState<BleConnectionState>('idle');
  const [powerState, setPowerState] = useState<BluetoothPowerState>('unknown');
  const [discoveredDevices, setDiscoveredDevices] = useState<
    DiscoveredDevice[]
  >([]);
  const [connectedDeviceName, setConnectedDeviceName] = useState<
    string | null
  >(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const listenersRef = useRef<Set<SampleListener>>(new Set());
  const lastDeviceIdRef = useRef<string | null>(null);
  const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    const sub = bleManager.onStateChange(state => setPowerState(state), true);
    return () => sub.remove();
  }, []);

  const beginNotifications = useCallback(() => {
    bleManager.subscribeToRows(
      csv => {
        const sample = parseSensorRow(csv);
        if (!sample) {
          return;
        }
        listenersRef.current.forEach(listener => listener(sample));
      },
      error => setLastError(error.message),
    );
  }, []);

  const handleDisconnected = useCallback(
    (error: BleError | null) => {
      setConnectedDeviceName(null);
      setLastError(error ? error.message : 'Device disconnected unexpectedly.');

      const deviceId = lastDeviceIdRef.current;
      if (!deviceId) {
        setConnectionState('disconnected');
        return;
      }

      setConnectionState('reconnecting');
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      reconnectTimeoutRef.current = setTimeout(() => {
        setConnectionState(prev =>
          prev === 'reconnecting' ? 'disconnected' : prev,
        );
      }, RECONNECT_TIMEOUT_MS);

      bleManager
        .reconnect(deviceId, handleDisconnected)
        .then(device => {
          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
          }
          setConnectedDeviceName(device.name);
          beginNotifications();
          setConnectionState('connected');
          setLastError(null);
        })
        .catch(() => {
          // The pending timeout above will flip state to 'disconnected';
          // the user can retry manually via resumeAfterDrop().
        });
    },
    [beginNotifications],
  );

  const stopScan = useCallback(() => {
    bleManager.stopScan();
    if (scanTimeoutRef.current) {
      clearTimeout(scanTimeoutRef.current);
      scanTimeoutRef.current = null;
    }
    setConnectionState(prev => (prev === 'scanning' ? 'idle' : prev));
  }, []);

  const startScan = useCallback(async () => {
    setLastError(null);
    const granted = await bleManager.requestPermissions();
    if (!granted) {
      setLastError('Bluetooth permission was not granted.');
      return;
    }

    setDiscoveredDevices([]);
    setConnectionState('scanning');
    bleManager.startScan(
      device => {
        setDiscoveredDevices(prev => {
          const idx = prev.findIndex(d => d.id === device.id);
          if (idx === -1) {
            return [...prev, device];
          }
          const next = [...prev];
          next[idx] = device;
          return next;
        });
      },
      error => setLastError(error.message),
    );

    if (scanTimeoutRef.current) {
      clearTimeout(scanTimeoutRef.current);
    }
    scanTimeoutRef.current = setTimeout(stopScan, SCAN_TIMEOUT_MS);
  }, [stopScan]);

  const connect = useCallback(
    async (deviceId: string) => {
      setLastError(null);
      stopScan();
      setConnectionState('connecting');
      lastDeviceIdRef.current = deviceId;
      try {
        const device = await bleManager.connect(deviceId, handleDisconnected);
        setConnectedDeviceName(device.name);
        beginNotifications();
        setConnectionState('connected');
      } catch (e) {
        setConnectionState('disconnected');
        setLastError(e instanceof Error ? e.message : String(e));
      }
    },
    [beginNotifications, handleDisconnected, stopScan],
  );

  const resumeAfterDrop = useCallback(async () => {
    const deviceId = lastDeviceIdRef.current;
    if (!deviceId) {
      return;
    }
    setLastError(null);
    setConnectionState('reconnecting');
    try {
      const device = await bleManager.reconnect(deviceId, handleDisconnected);
      setConnectedDeviceName(device.name);
      beginNotifications();
      setConnectionState('connected');
    } catch (e) {
      setConnectionState('disconnected');
      setLastError(e instanceof Error ? e.message : String(e));
    }
  }, [beginNotifications, handleDisconnected]);

  const disconnect = useCallback(async () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    await bleManager.disconnect();
    lastDeviceIdRef.current = null;
    setConnectedDeviceName(null);
    setConnectionState('idle');
  }, []);

  const subscribeToSamples = useCallback((listener: SampleListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  useEffect(() => {
    return () => {
      bleManager.stopScan();
      if (scanTimeoutRef.current) {
        clearTimeout(scanTimeoutRef.current);
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []);

  return {
    connectionState,
    powerState,
    discoveredDevices,
    connectedDeviceName,
    lastError,
    startScan,
    stopScan,
    connect,
    disconnect,
    resumeAfterDrop,
    subscribeToSamples,
  };
}
