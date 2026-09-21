import React, { useEffect } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { UseBleDeviceResult } from '../hooks/useBleDevice';
import type { DiscoveredDevice } from '../types';
import { DEVICE_NAME } from '../ble/constants';

interface ScanScreenProps {
  ble: UseBleDeviceResult;
  onConnect: (deviceId: string) => void;
  activeProfileName: string;
  onSwitchProfile: () => void;
}

export default function ScanScreen({
  ble,
  onConnect,
  activeProfileName,
  onSwitchProfile,
}: ScanScreenProps) {
  const { powerState, connectionState, discoveredDevices, startScan, stopScan, lastError } = ble;

  const isScanning = connectionState === 'scanning';
  const isPoweredOn = powerState === 'poweredOn';

  useEffect(() => {
    return () => {
      stopScan();
    };
  }, [stopScan]);

  const renderItem = ({ item }: { item: DiscoveredDevice }) => (
    <Pressable style={styles.deviceRow} onPress={() => onConnect(item.id)}>
      <View>
        <Text style={styles.deviceName}>{item.name ?? 'Unknown device'}</Text>
        <Text style={styles.deviceId}>{item.id}</Text>
      </View>
      <Text style={styles.rssi}>{item.rssi !== null ? `${item.rssi} dBm` : '—'}</Text>
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <Pressable style={styles.profileRow} onPress={onSwitchProfile}>
        <Text style={styles.profileLabel}>Profile: {activeProfileName}</Text>
        <Text style={styles.profileSwitchLabel}>Switch</Text>
      </Pressable>

      <View style={styles.header}>
        <Text style={styles.title}>Find your device</Text>
        <Text style={styles.subtitle}>Looking for &quot;{DEVICE_NAME}&quot;</Text>
      </View>

      {!isPoweredOn && (
        <View style={styles.noticeBox}>
          <Text style={styles.noticeTitle}>
            {powerState === 'unauthorized'
              ? 'Bluetooth permission needed'
              : powerState === 'poweredOff'
                ? 'Bluetooth is off'
                : 'Bluetooth unavailable'}
          </Text>
          <Text style={styles.noticeBody}>
            {powerState === 'unauthorized'
              ? 'Enable Bluetooth access for this app in Settings > Privacy & Security > Bluetooth.'
              : powerState === 'poweredOff'
                ? 'Turn on Bluetooth in Control Center or Settings to scan for the device.'
                : 'This device does not support Bluetooth LE, or its state could not be determined.'}
          </Text>
        </View>
      )}

      {lastError && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{lastError}</Text>
        </View>
      )}

      <FlatList
        data={discoveredDevices}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            {isScanning ? (
              <>
                <ActivityIndicator color="#2F6FED" />
                <Text style={styles.emptyText}>Scanning…</Text>
              </>
            ) : (
              <Text style={styles.emptyText}>
                No devices found yet. Make sure the ESP32 is powered on and nearby.
              </Text>
            )}
          </View>
        }
      />

      <Pressable
        accessibilityRole="button"
        disabled={!isPoweredOn}
        onPress={isScanning ? stopScan : startScan}
        style={[styles.scanButton, !isPoweredOn && styles.scanButtonDisabled]}
      >
        <Text style={styles.scanButtonLabel}>
          {isScanning ? 'Stop Scanning' : 'Scan for Device'}
        </Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#111318',
    padding: 16,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1C1F26',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 16,
  },
  profileLabel: {
    color: '#E6E8EB',
    fontSize: 13,
    fontWeight: '600',
  },
  profileSwitchLabel: {
    color: '#2F6FED',
    fontSize: 13,
    fontWeight: '700',
  },
  header: {
    marginBottom: 16,
  },
  title: {
    color: '#E6E8EB',
    fontSize: 22,
    fontWeight: '800',
  },
  subtitle: {
    color: '#8A8F98',
    fontSize: 13,
    marginTop: 4,
  },
  noticeBox: {
    backgroundColor: '#2A1F14',
    borderColor: '#F5A623',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  noticeTitle: {
    color: '#F5A623',
    fontWeight: '700',
    fontSize: 14,
    marginBottom: 4,
  },
  noticeBody: {
    color: '#E6E8EB',
    fontSize: 13,
  },
  errorBox: {
    backgroundColor: '#2A1414',
    borderColor: '#C62828',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  errorText: {
    color: '#F28B82',
    fontSize: 13,
  },
  listContent: {
    flexGrow: 1,
  },
  deviceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1C1F26',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  deviceName: {
    color: '#E6E8EB',
    fontSize: 15,
    fontWeight: '700',
  },
  deviceId: {
    color: '#8A8F98',
    fontSize: 11,
    marginTop: 2,
  },
  rssi: {
    color: '#8A8F98',
    fontSize: 13,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    color: '#8A8F98',
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  scanButton: {
    backgroundColor: '#2F6FED',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 12,
  },
  scanButtonDisabled: {
    backgroundColor: '#3A3F4B',
  },
  scanButtonLabel: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
