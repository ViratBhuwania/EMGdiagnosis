import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

interface SessionControlsProps {
  isRecording: boolean;
  canExport: boolean;
  onStart: () => void;
  onStop: () => void;
  onExport: () => void;
}

/** Start/Stop session controls, plus the post-Stop Export action. */
export default function SessionControls({
  isRecording,
  canExport,
  onStart,
  onStop,
  onExport,
}: SessionControlsProps) {
  return (
    <View style={styles.row}>
      {!isRecording ? (
        <Pressable
          accessibilityRole="button"
          onPress={onStart}
          style={[styles.button, styles.startButton]}
        >
          <Text style={styles.buttonLabel}>Start Session</Text>
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={onStop}
          style={[styles.button, styles.stopButton]}
        >
          <Text style={styles.buttonLabel}>Stop Session</Text>
        </Pressable>
      )}

      <Pressable
        accessibilityRole="button"
        disabled={!canExport}
        onPress={onExport}
        style={[styles.button, styles.exportButton, !canExport && styles.buttonDisabled]}
      >
        <Text style={[styles.buttonLabel, !canExport && styles.labelDisabled]}>
          Export Session
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  button: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startButton: {
    backgroundColor: '#2E7D32',
  },
  stopButton: {
    backgroundColor: '#C62828',
  },
  exportButton: {
    backgroundColor: '#2F6FED',
  },
  buttonDisabled: {
    backgroundColor: '#3A3F4B',
  },
  buttonLabel: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  labelDisabled: {
    color: '#8A8F98',
  },
});
