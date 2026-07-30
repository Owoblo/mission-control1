import * as Keychain from 'react-native-keychain';

const SERVICE = 'com.saturnstar.phone.session';

export async function saveSession(token: string) {
  await Keychain.setGenericPassword('saturn-staff', token, {
    service: SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function readSession() {
  const value = await Keychain.getGenericPassword({service: SERVICE});
  return value ? value.password : null;
}

export async function clearSession() {
  await Keychain.resetGenericPassword({service: SERVICE});
}
