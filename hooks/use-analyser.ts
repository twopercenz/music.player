"use client";

import { useEffect, useRef } from "react";

/**
 * Wires the shared <audio> element into a Web Audio AnalyserNode, for the
 * visualizer. A MediaElementSourceNode can only ever be created once per
 * <audio> element, so this sets the graph up once (on first play) and reuses
 * it for every subsequent track — only `audio.src` changes between tracks.
 */
export function useAnalyser(audioRef: React.RefObject<HTMLAudioElement>) {
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const setupDone = useRef(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const setup = () => {
      if (setupDone.current) return;
      setupDone.current = true;

      const AudioContextCtor = window.AudioContext ?? (window as any).webkitAudioContext;
      const audioContext = new AudioContextCtor();
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaElementSource(audio);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;

      source.connect(analyser);
      analyser.connect(audioContext.destination);
      analyserRef.current = analyser;
    };

    // Needs a user gesture to start the AudioContext in most browsers — `play`
    // always follows a user action here (search result click, control button).
    // createMediaElementSource can only ever be called once per <audio>
    // element (setup() guards that with setupDone), but the context itself
    // can go back to "suspended" later on its own — iOS Safari does this a
    // lot after backgrounding the tab — which leaves audio playing with no
    // sound at all, since connecting a MediaElementSource routes the
    // element's output through the (now-suspended) context. So resume() runs
    // on every play, not just the first.
    const onPlay = () => {
      setup();
      void audioContextRef.current?.resume();
    };
    audio.addEventListener("play", onPlay);
    return () => audio.removeEventListener("play", onPlay);
  }, [audioRef]);

  return analyserRef;
}
