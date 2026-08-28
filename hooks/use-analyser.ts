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
  const setupDone = useRef(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const setup = () => {
      if (setupDone.current) return;
      setupDone.current = true;

      const AudioContextCtor = window.AudioContext ?? (window as any).webkitAudioContext;
      const audioContext = new AudioContextCtor();
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
    audio.addEventListener("play", setup, { once: true });
    return () => audio.removeEventListener("play", setup);
  }, [audioRef]);

  return analyserRef;
}
