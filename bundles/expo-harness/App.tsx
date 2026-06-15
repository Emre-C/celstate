/**
 * Expo harness entry. Wraps the app in GestureHandlerRootView (required by the
 * living slider) and renders the 2AFC aliveness screen.
 *
 * Scaffold + run: see README.md.
 */
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { LivingVsStaticScreen } from './LivingVsStaticScreen';

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <LivingVsStaticScreen />
    </GestureHandlerRootView>
  );
}
