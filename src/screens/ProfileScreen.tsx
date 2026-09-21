import React, { useState } from 'react';
import { FlatList, Modal, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import CreateProfileForm from '../components/CreateProfileForm';
import type { Profile } from '../profile/types';

interface ProfileScreenProps {
  visible: boolean;
  profiles: Profile[];
  activeProfileId: string | null;
  onSelectProfile: (profileId: string) => void;
  onCreateProfile: (name: string) => void;
  onClose: () => void;
}

/** Switch between existing profiles, or create a new one. */
export default function ProfileScreen({
  visible,
  profiles,
  activeProfileId,
  onSelectProfile,
  onCreateProfile,
  onClose,
}: ProfileScreenProps) {
  const [mode, setMode] = useState<'list' | 'create'>('list');

  const handleClose = () => {
    setMode('list');
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={handleClose}
    >
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{mode === 'list' ? 'Profiles' : 'New Profile'}</Text>
          <Pressable onPress={mode === 'list' ? handleClose : () => setMode('list')} hitSlop={8}>
            <Text style={styles.closeLabel}>{mode === 'list' ? 'Close' : 'Cancel'}</Text>
          </Pressable>
        </View>

        {mode === 'create' ? (
          <View style={styles.createContainer}>
            <CreateProfileForm
              onCreate={name => {
                onCreateProfile(name);
                setMode('list');
              }}
            />
          </View>
        ) : (
          <FlatList
            data={profiles}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => {
              const isActive = item.id === activeProfileId;
              return (
                <Pressable
                  style={[styles.profileRow, isActive && styles.profileRowActive]}
                  onPress={() => onSelectProfile(item.id)}
                >
                  <Text style={styles.profileName}>{item.name}</Text>
                  {isActive && <Text style={styles.activeLabel}>Active</Text>}
                </Pressable>
              );
            }}
            ListFooterComponent={
              <Pressable style={styles.newButton} onPress={() => setMode('create')}>
                <Text style={styles.newButtonLabel}>+ New Profile</Text>
              </Pressable>
            }
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#111318',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: {
    color: '#E6E8EB',
    fontSize: 18,
    fontWeight: '800',
  },
  closeLabel: {
    color: '#2F6FED',
    fontSize: 15,
    fontWeight: '700',
  },
  createContainer: {
    padding: 16,
  },
  listContent: {
    padding: 16,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1C1F26',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  profileRowActive: {
    borderWidth: 1,
    borderColor: '#2F6FED',
  },
  profileName: {
    color: '#E6E8EB',
    fontSize: 15,
    fontWeight: '700',
  },
  activeLabel: {
    color: '#2F6FED',
    fontSize: 12,
    fontWeight: '700',
  },
  newButton: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#3A3F4B',
    borderStyle: 'dashed',
    marginTop: 4,
  },
  newButtonLabel: {
    color: '#8A8F98',
    fontSize: 14,
    fontWeight: '700',
  },
});
