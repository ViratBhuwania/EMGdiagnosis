import RNFS from 'react-native-fs';
import type { Profile, ProfileState } from './types';

const STORE_PATH = `${RNFS.DocumentDirectoryPath}/profiles.json`;
const EMPTY_STATE: ProfileState = { profiles: [], activeProfileId: null };

export async function loadProfileState(): Promise<ProfileState> {
  try {
    const exists = await RNFS.exists(STORE_PATH);
    if (!exists) {
      return EMPTY_STATE;
    }
    const raw = await RNFS.readFile(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.profiles)) {
      return {
        profiles: parsed.profiles,
        activeProfileId: typeof parsed.activeProfileId === 'string' ? parsed.activeProfileId : null,
      };
    }
    return EMPTY_STATE;
  } catch {
    // Corrupt or unreadable file -- treat as no profiles rather than crashing.
    return EMPTY_STATE;
  }
}

async function persist(state: ProfileState): Promise<void> {
  await RNFS.writeFile(STORE_PATH, JSON.stringify(state), 'utf8');
}

/** Creates a new profile and makes it the active one. */
export async function createProfile(name: string): Promise<ProfileState> {
  const state = await loadProfileState();
  const profile: Profile = {
    id: `${Date.now()}`,
    name: name.trim(),
    createdAt: Date.now(),
  };
  const updated: ProfileState = {
    profiles: [...state.profiles, profile],
    activeProfileId: profile.id,
  };
  await persist(updated);
  return updated;
}

export async function setActiveProfile(profileId: string): Promise<ProfileState> {
  const state = await loadProfileState();
  const updated: ProfileState = { ...state, activeProfileId: profileId };
  await persist(updated);
  return updated;
}
