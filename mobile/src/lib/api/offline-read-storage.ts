import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { createMMKV } from 'react-native-mmkv';

const KEY = 'offline-read-key-v1';
const SNAPSHOT = 'snapshot';
const KEY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
let database: ReturnType<typeof createMMKV> | undefined;

function openDisk(create: boolean) {
  if (database || Platform.OS === 'web')
    return database;
  try {
    let key = SecureStore.getItem(KEY);
    if (!key && create) {
      const bytes = Crypto.getRandomBytes(16);
      key = Array.from(bytes, byte => KEY_ALPHABET[byte % KEY_ALPHABET.length]).join('');
      SecureStore.setItem(KEY, key, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
    }
    if (key)
      database = createMMKV({ id: 'offline-read-v1', encryptionKey: key });
  }
  catch {
    // Uden adgang til enhedens nøglelager er offline-læsning kun i hukommelsen.
  }
  return database;
}

export const offlineReadDisk = {
  read: () => openDisk(false)?.getString(SNAPSHOT),
  write: (value: string) => {
    try {
      openDisk(true)?.set(SNAPSHOT, value);
    }
    catch {
      // En fuld disk må ikke få et gennemført serverkald til at fejle.
    }
  },
  remove: () => {
    try {
      openDisk(false)?.remove(SNAPSHOT);
    }
    catch {
      // Invalidér filens nøgle, hvis selve snapshotværdien ikke kunne fjernes.
      database = undefined;
      void SecureStore.deleteItemAsync(KEY).catch(() => {});
    }
  },
};

export async function cookieProof(cookie: string) {
  // Session-data-cookien kan rotere ved almindelige reads. Session-tokenet
  // er identitetsbeviset. Kun fingeraftrykket gemmes i læsecachen.
  const tokens = cookie.split(';').map(part => part.trim()).filter(part => /^[\w.-]*session_token=.+$/.test(part));
  return tokens.length === 1 ? Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, tokens[0]!) : null;
}
