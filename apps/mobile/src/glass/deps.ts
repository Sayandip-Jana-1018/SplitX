/**
 * Dependencies for Reanimated's hooks, on the web only. On a phone Reanimated follows what a
 * worklet captures by itself and warns when it is handed a list; the web build still needs one.
 */
import { Platform } from 'react-native';

export const webDeps = (deps: unknown[]): unknown[] | undefined => (Platform.OS === 'web' ? deps : undefined);
