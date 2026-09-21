import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

interface RepMarkerButtonProps {
  disabled: boolean;
  onPress: () => void;
}

/** Large, thumb-friendly button for marking a rep during an active session. */
export default function RepMarkerButton({ disabled, onPress }: RepMarkerButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Mark rep"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}
    >
      <Text style={[styles.label, disabled && styles.labelDisabled]}>MARK REP</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: '#F5A623',
    borderRadius: 16,
    paddingVertical: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    backgroundColor: '#D68F1C',
  },
  buttonDisabled: {
    backgroundColor: '#3A3F4B',
  },
  label: {
    color: '#14161A',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 1,
  },
  labelDisabled: {
    color: '#6B7280',
  },
});
