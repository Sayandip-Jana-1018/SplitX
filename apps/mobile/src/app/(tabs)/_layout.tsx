/** The four main places, under one floating bar of glass. */
import { TabList, Tabs, TabSlot, TabTrigger } from 'expo-router/ui';
import { ArrowLeftRight, History, House, Users } from 'lucide-react-native';
import { AddButton, GlassTabBar, TabButton } from '~/nav/GlassTabBar';

export default function TabsLayout() {
    return (
        <Tabs>
            <TabSlot />
            <TabList asChild>
                <GlassTabBar>
                    <TabTrigger name="home" href="/home" asChild>
                        <TabButton icon={House} label="Home" />
                    </TabTrigger>
                    <TabTrigger name="groups" href="/groups" asChild>
                        <TabButton icon={Users} label="Groups" />
                    </TabTrigger>
                    <AddButton />
                    <TabTrigger name="activity" href="/activity" asChild>
                        <TabButton icon={History} label="Activity" />
                    </TabTrigger>
                    <TabTrigger name="settle" href="/settle" asChild>
                        <TabButton icon={ArrowLeftRight} label="Settle" />
                    </TabTrigger>
                </GlassTabBar>
            </TabList>
        </Tabs>
    );
}
