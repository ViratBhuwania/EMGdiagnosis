import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { BleConnectionState } from '../types';

interface ConnectionStatusBadgeProps {
  connectionState: BleConnectionState;
  deviceName: string | null;
  onDisconnect: () => void;
}

const STATE_LABEL: Record<BleConnectionState, string> = {
  idle: 'Idle',
  scanning: 'Scanning…',
  connecting: 'Connecting…',
  connected: 'Connected',
  disconnected: 'Disconnected',
  reconnecting: 'Reconnecting…',
};

const STATE_COLOR: Record<BleConnectionState, string> = {
  idle: '#8A8F98',
  scanning: '#F5A623',
  connecting: '#F5A623',
  connected: '#2E7D32',
  disconnected: '#C62828',
  reconnecting: '#F5A623',
};

/** Small connection status pill with an inline Disconnect action. */
export default function ConnectionStatusBadge({
  connectionState,
  deviceName,
  onDisconnect,
}: ConnectionStatusBadgeProps) {
  const canDisconnect = connectionState === 'connected' || connectionState === 'reconnecting';

  return (
    <View style={styles.container}>
      <View style={styles.statusGroup}>
        <View style={[styles.dot, { backgroundColor: STATE_COLOR[connectionState] }]} />
        <Text style={styles.label}>
          {STATE_LABEL[connectionState]}
          {deviceName ? ` · ${deviceName}` : ''}
        </Text>
      </View>
      {canDisconnect && (
        <Pressable accessibilityRole="button" onPress={onDisconnect} hitSlop={8}>
          <Text style={styles.disconnect}>Disconnect</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  statusGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  label: {
    color: '#E6E8EB',
    fontSize: 13,
    fontWeight: '600',
  },
  disconnect: {
    color: '#C62828',
    fontSize: 13,
    fontWeight: '600',
  },
});
