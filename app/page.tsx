import { PlayerProvider } from "@/components/player/player-context";
import PlayerShell from "@/components/player/player-shell";

export default function Home() {
  return (
    <PlayerProvider>
      <PlayerShell />
    </PlayerProvider>
  );
}
