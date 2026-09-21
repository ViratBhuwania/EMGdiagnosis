/**
 * EMG/IMU BLE companion app.
 *
 * @format
 */

import React, { useCallback, useEffect, useState } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import RNFS from 'react-native-fs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useBleDevice } from './src/hooks/useBleDevice';
import ScanScreen from './src/screens/ScanScreen';
import LiveSessionScreen from './src/screens/LiveSessionScreen';
import CalibrationScreen from './src/screens/CalibrationScreen';
import ProfileGateScreen from './src/screens/ProfileGateScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import { createProfile, loadProfileState, setActiveProfile } from './src/profile/profileStore';
import type { ProfileState } from './src/profile/types';

/**
 * Calibration/session history used to live in one shared file per kind,
 * before per-profile storage existed. Rather than orphaning whatever was
 * already recorded during earlier testing, fold it into the very first
 * profile ever created -- a one-time, best-effort move; if it fails for any
 * reason, the new profile just starts fresh instead of blocking creation.
 */
async function migrateLegacyDataIfNeeded(newProfileId: string): Promise<void> {
  const legacyPaths: [string, string][] = [
    [
      `${RNFS.DocumentDirectoryPath}/calibration_history.json`,
      `${RNFS.DocumentDirectoryPath}/calibration_history_${newProfileId}.json`,
    ],
    [
      `${RNFS.DocumentDirectoryPath}/session_history.json`,
      `${RNFS.DocumentDirectoryPath}/session_history_${newProfileId}.json`,
    ],
  ];
  for (const [legacyPath, newPath] of legacyPaths) {
    try {
      if (await RNFS.exists(legacyPath)) {
        await RNFS.moveFile(legacyPath, newPath);
      }
    } catch {
      // Best-effort -- leave the legacy file in place rather than lose it.
    }
  }
}

function App() {
  const ble = useBleDevice();
  const [calibrating, setCalibrating] = useState(false);
  const [profileState, setProfileState] = useState<ProfileState | null>(null);
  const [showProfileSwitcher, setShowProfileSwitcher] = useState(false);

  useEffect(() => {
    loadProfileState().then(setProfileState);
  }, []);

  const handleCreateProfile = useCallback(
    (name: string) => {
      const isFirstEverProfile = profileState !== null && profileState.profiles.length === 0;
      createProfile(name).then(async updated => {
        if (isFirstEverProfile && updated.activeProfileId) {
          await migrateLegacyDataIfNeeded(updated.activeProfileId);
        }
        setProfileState(updated);
      });
    },
    [profileState],
  );

  const handleSelectProfile = useCallback((profileId: string) => {
    setActiveProfile(profileId).then(updated => {
      setProfileState(updated);
      setShowProfileSwitcher(false);
    });
  }, []);

  const handleConnect = useCallback(
    (deviceId: string) => {
      void ble.connect(deviceId);
    },
    [ble],
  );

  const handleLeave = useCallback(() => {
    setCalibrating(false);
    void ble.disconnect();
  }, [ble]);

  // The scan screen owns 'idle' and 'scanning'; every other state (a connect
  // attempt is underway, succeeded, dropped, or is retrying) belongs to the
  // live session screen so an in-progress recording is never torn down.
  const showLiveSession =
    ble.connectionState !== 'idle' && ble.connectionState !== 'scanning';

  // Still loading profile state from disk -- render nothing rather than
  // flashing the gate screen for a moment on every launch.
  if (profileState === null) {
    return (
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" />
        <View style={styles.container} />
      </SafeAreaProvider>
    );
  }

  const activeProfile =
    profileState.profiles.find(p => p.id === profileState.activeProfileId) ?? null;

  if (!activeProfile) {
    return (
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" />
        <View style={styles.container}>
          <ProfileGateScreen onCreate={handleCreateProfile} />
        </View>
      </SafeAreaProvider>
    );
  }

  let content;
  if (showLiveSession && calibrating) {
    content = (
      <CalibrationScreen
        ble={ble}
        profileId={activeProfile.id}
        onDone={() => setCalibrating(false)}
      />
    );
  } else if (showLiveSession) {
    content = (
      <LiveSessionScreen
        ble={ble}
        profileId={activeProfile.id}
        onLeave={handleLeave}
        onStartCalibration={() => setCalibrating(true)}
      />
    );
  } else {
    content = (
      <ScanScreen
        ble={ble}
        onConnect={handleConnect}
        activeProfileName={activeProfile.name}
        onSwitchProfile={() => setShowProfileSwitcher(true)}
      />
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      <View style={styles.container}>{content}</View>
      <ProfileScreen
        visible={showProfileSwitcher}
        profiles={profileState.profiles}
        activeProfileId={profileState.activeProfileId}
        onSelectProfile={handleSelectProfile}
        onCreateProfile={handleCreateProfile}
        onClose={() => setShowProfileSwitcher(false)}
      />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111318',
  },
});

export default App;
