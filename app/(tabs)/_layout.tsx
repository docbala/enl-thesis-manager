import { Tabs } from 'expo-router';
import { ColorValue } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { C } from '../../components/ui';
import { useSession } from '../../lib/session';
import { LoginPill } from '../../components/Guest';

const icon = (name: keyof typeof MaterialCommunityIcons.glyphMap) =>
  ({ color, size }: { color: ColorValue; size: number }) => <MaterialCommunityIcons name={name} size={size} color={color as string} />;

export default function TabsLayout() {
  const { guest } = useSession();
  return (
    <Tabs screenOptions={{
      headerStyle: { backgroundColor: C.primary }, headerTintColor: '#fff', headerTitleStyle: { fontWeight: '800' },
      tabBarActiveTintColor: C.primary, tabBarInactiveTintColor: C.quiet, tabBarLabelStyle: { fontWeight: '700' },
      sceneStyle: { backgroundColor: C.bg },
      headerRight: guest ? () => <LoginPill /> : undefined,
    }}>
      <Tabs.Screen name="index" options={{ title: 'Dashboard', headerTitle: 'Thesis Manager', tabBarIcon: icon('view-dashboard') }} />
      <Tabs.Screen name="patients" options={{ title: 'Patients', tabBarIcon: icon('account-group') }} />
      <Tabs.Screen name="analysis" options={{ title: 'Analysis', tabBarIcon: icon('chart-line') }} />
      <Tabs.Screen name="review" options={{ title: 'Review', tabBarIcon: icon('flag') }} />
    </Tabs>
  );
}
