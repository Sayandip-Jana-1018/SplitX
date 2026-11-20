/** The four main places, under one floating bar of glass. */
import { TabList, Tabs, TabSlot, TabTrigger } from 'expo-router/ui';
import { ArrowLeftRight, History, House, Users } from 'lucide-react-native';
import { AddButton, GlassTabBar, TabButton } from '~/nav/GlassTabBar';

export default function TabsLayout() {
    return (
        <Tabs>
            {/* Its own style lets it grow to fit the screen it shows (flexShrink 0): in a browser the
                screen then grew past the window, the page scrolled instead of the screen, and the tab
                bar rode up with it. flex: 1 holds it to the window, as on a phone. */}
            <TabSlot style={{ flex: 1 }} />
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
