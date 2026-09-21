import React from 'react';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';
import CreateProfileForm from '../components/CreateProfileForm';

interface ProfileGateScreenProps {
  onCreate: (name: string) => void;
}

/** Mandatory, non-dismissible first-run screen: shown only when no profile exists yet. */
export default function ProfileGateScreen({ onCreate }: ProfileGateScreenProps) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <Text style={styles.title}>Who&apos;s using this device?</Text>
        <Text style={styles.body}>
          Create a profile so your calibration and session history stay separate from anyone
          else who uses this wearable.
        </Text>
        <CreateProfileForm onCreate={onCreate} submitLabel="Get Started" />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#111318',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    color: '#E6E8EB',
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 10,
  },
  body: {
    color: '#8A8F98',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 24,
  },
});
