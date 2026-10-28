import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import {
  EQUIPMENT_OPTIONS,
  EXERCISE_OPTIONS,
  parsePositiveNumber,
  type SessionMeta,
} from '../sessionHistory/sessionMeta';
import type { CustomTagOptions } from '../sessionHistory/sessionMetaStore';

interface Props {
  meta: SessionMeta;
  onChange: (next: SessionMeta) => void;
  custom: CustomTagOptions;
  /** Called when the user confirms a typed "Other" name, so it can be remembered. */
  onAddCustom: (kind: 'exercises' | 'equipment', name: string) => void;
  /** Warm-up can only be changed before saving: it decides whether the recording feeds the effort reference. */
  warmupLocked?: boolean;
}

function ChipRow({
  options,
  selected,
  onSelect,
  onOther,
}: {
  options: readonly string[];
  selected: string | null;
  onSelect: (value: string | null) => void;
  onOther: () => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
      {options.map(opt => (
        <Pressable
          key={opt}
          style={[styles.chip, selected === opt && styles.chipOn]}
          onPress={() => onSelect(selected === opt ? null : opt)}
        >
          <Text style={[styles.chipText, selected === opt && styles.chipTextOn]}>{opt}</Text>
        </Pressable>
      ))}
      <Pressable style={styles.chip} onPress={onOther}>
        <Text style={styles.chipText}>Other…</Text>
      </Pressable>
    </ScrollView>
  );
}

export default function SessionTagPicker({ meta, onChange, custom, onAddCustom, warmupLocked }: Props) {
  const [otherFor, setOtherFor] = useState<'exercises' | 'equipment' | null>(null);
  const [otherText, setOtherText] = useState('');
  const [weightText, setWeightText] = useState(meta.weightKg !== null ? String(meta.weightKg) : '');
  const [repsText, setRepsText] = useState(meta.trueReps !== null ? String(meta.trueReps) : '');

  const confirmOther = () => {
    const name = otherText.trim();
    if (name && otherFor) {
      onAddCustom(otherFor, name);
      onChange({ ...meta, [otherFor === 'exercises' ? 'exercise' : 'equipment']: name });
    }
    setOtherFor(null);
    setOtherText('');
  };

  return (
    <View style={styles.box}>
      <Text style={styles.heading}>What was this recording?</Text>

      <Text style={styles.label}>Exercise</Text>
      <ChipRow
        options={[...EXERCISE_OPTIONS, ...custom.exercises]}
        selected={meta.exercise}
        onSelect={v => onChange({ ...meta, exercise: v })}
        onOther={() => setOtherFor('exercises')}
      />

      <Text style={styles.label}>Equipment</Text>
      <ChipRow
        options={[...EQUIPMENT_OPTIONS, ...custom.equipment]}
        selected={meta.equipment}
        onSelect={v => onChange({ ...meta, equipment: v })}
        onOther={() => setOtherFor('equipment')}
      />

      {otherFor && (
        <View style={styles.otherRow}>
          <TextInput
            style={[styles.input, styles.otherInput]}
            value={otherText}
            onChangeText={setOtherText}
            placeholder={otherFor === 'exercises' ? 'Exercise name' : 'Equipment name'}
            placeholderTextColor="#5B6270"
            autoFocus
            onSubmitEditing={confirmOther}
          />
          <Pressable style={styles.otherButton} onPress={confirmOther}>
            <Text style={styles.otherButtonText}>Add</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.numbersRow}>
        <View style={styles.numberField}>
          <Text style={styles.label}>Weight (kg)</Text>
          <TextInput
            style={styles.input}
            value={weightText}
            onChangeText={t => {
              setWeightText(t);
              onChange({ ...meta, weightKg: parsePositiveNumber(t) });
            }}
            keyboardType="decimal-pad"
            placeholder="e.g. 12.5"
            placeholderTextColor="#5B6270"
          />
        </View>
        <View style={styles.numberField}>
          <Text style={styles.label}>Reps you counted</Text>
          <TextInput
            style={styles.input}
            value={repsText}
            onChangeText={t => {
              setRepsText(t);
              const n = parsePositiveNumber(t);
              onChange({ ...meta, trueReps: n !== null ? Math.round(n) : null });
            }}
            keyboardType="number-pad"
            placeholder="optional"
            placeholderTextColor="#5B6270"
          />
        </View>
      </View>

      <View style={styles.warmupRow}>
        <View style={styles.warmupText}>
          <Text style={styles.warmupTitle}>Warm-up</Text>
          <Text style={styles.warmupHint}>
            {warmupLocked
              ? 'Already saved — warm-up can only be set before saving.'
              : 'Saved, but kept out of your effort reference.'}
          </Text>
        </View>
        <Switch
          value={meta.isWarmup}
          disabled={warmupLocked}
          onValueChange={v => onChange({ ...meta, isWarmup: v })}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: '#14171D', borderRadius: 10, padding: 12, marginBottom: 12 },
  heading: { color: '#E6E8EB', fontSize: 13, fontWeight: '700', marginBottom: 6 },
  label: { color: '#8A8F98', fontSize: 11, fontWeight: '600', marginTop: 8, marginBottom: 4 },
  chipScroll: { flexGrow: 0 },
  chip: {
    borderColor: '#3A3F4B',
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 5,
    paddingHorizontal: 11,
    marginRight: 6,
  },
  chipOn: { backgroundColor: '#2F6FED', borderColor: '#2F6FED' },
  chipText: { color: '#B4B9C2', fontSize: 12 },
  chipTextOn: { color: '#FFFFFF', fontWeight: '700' },
  otherRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  otherInput: { flex: 1, marginRight: 8 },
  otherButton: { backgroundColor: '#2F6FED', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14 },
  otherButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  input: {
    backgroundColor: '#111318',
    borderColor: '#3A3F4B',
    borderWidth: 1,
    borderRadius: 8,
    color: '#E6E8EB',
    fontSize: 13,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  numbersRow: { flexDirection: 'row', gap: 10 },
  numberField: { flex: 1 },
  warmupRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  warmupText: { flex: 1, paddingRight: 10 },
  warmupTitle: { color: '#E6E8EB', fontSize: 13, fontWeight: '600' },
  warmupHint: { color: '#8A8F98', fontSize: 11, marginTop: 2 },
});
