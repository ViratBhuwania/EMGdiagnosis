import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

interface CreateProfileFormProps {
  onCreate: (name: string) => void;
  submitLabel?: string;
}

export default function CreateProfileForm({
  onCreate,
  submitLabel = 'Create Profile',
}: CreateProfileFormProps) {
  const [name, setName] = useState('');
  const trimmed = name.trim();

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Name</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="e.g. Alex"
        placeholderTextColor="#5B6270"
        autoCapitalize="words"
        autoFocus
      />
      <Pressable
        style={[styles.button, !trimmed && styles.buttonDisabled]}
        disabled={!trimmed}
        onPress={() => onCreate(trimmed)}
      >
        <Text style={styles.buttonLabel}>{submitLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  label: {
    color: '#8A8F98',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#1C1F26',
    borderColor: '#3A3F4B',
    borderWidth: 1,
    borderRadius: 8,
    color: '#E6E8EB',
    fontSize: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  button: {
    backgroundColor: '#2F6FED',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonDisabled: {
    backgroundColor: '#3A3F4B',
  },
  buttonLabel: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
