import { Tabs } from 'expo-router';
import { ColorValue, Text } from 'react-native';
import { C } from '../../components/ui';

const icon = (glyph: string) => ({ color }: { color: ColorValue }) => <Text style={{ color, fontSize: 18 }}>{glyph}</Text>;

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerStyle: { backgroundColor: C.primary }, headerTintColor: '#fff', tabBarActiveTintColor: C.primary }}>
      <Tabs.Screen name="index" options={{ title: 'Dashboard', tabBarIcon: icon('▦') }} />
      <Tabs.Screen name="patients" options={{ title: 'Patients', tabBarIcon: icon('☰') }} />
      <Tabs.Screen name="review" options={{ title: 'Review', tabBarIcon: icon('⚑') }} />
    </Tabs>
  );
}
