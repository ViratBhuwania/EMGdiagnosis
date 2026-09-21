export interface Profile {
  id: string;
  name: string;
  createdAt: number;
}

export interface ProfileState {
  profiles: Profile[];
  activeProfileId: string | null;
}
