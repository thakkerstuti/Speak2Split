import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { Audio } from "expo-av";
import { api } from "./api";

export type CaptureState = "idle" | "listening" | "transcribing" | "error";

/** Voice-activity tuning (dBFS from expo-av metering, -160..0). */
const SILENCE_TO_STOP_MS = 1500; // stop this long after the speaker goes quiet
const MIN_SPEECH_MS = 300; // need this much speech before silence can end the take
const NO_SPEECH_TIMEOUT_MS = 8000; // nothing heard at all -> give up politely
const MAX_DURATION_MS = 30000; // hard cap per take
const CALIBRATION_MS = 350; // ambient-noise sampling window at the start
const STATUS_INTERVAL_MS = 100;

interface VadState {
  lastDuration: number;
  floorSum: number;
  floorSamples: number;
  threshold: number;
  speechMs: number;
  silenceMs: number;
  heardSpeech: boolean;
  meteringSeen: boolean;
}

const freshVad = (): VadState => ({
  lastDuration: 0,
  floorSum: 0,
  floorSamples: 0,
  threshold: -40,
  speechMs: 0,
  silenceMs: 0,
  heardSpeech: false,
  meteringSeen: false,
});

/**
 * Tap-once voice capture: records, auto-stops when the speaker finishes
 * (simple energy-based voice-activity detection), uploads the audio to
 * /voice/transcribe and hands back the transcript. Falls back to manual
 * stop on devices that don't report metering.
 */
export function useVoiceCapture({ onTranscript }: { onTranscript: (text: string) => void }) {
  const [state, setState] = useState<CaptureState>("idle");
  const [level, setLevel] = useState(0); // 0..1, for the live animation
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [autoStop, setAutoStop] = useState(true);

  const recRef = useRef<Audio.Recording | null>(null);
  const vadRef = useRef<VadState>(freshVad());
  const finishingRef = useRef(false);
  const sessionRef = useRef(0); // invalidates in-flight work after cancel/restart
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const finish = useCallback(async (reason: "done" | "cancel" | "no-speech") => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    const session = sessionRef.current;
    const rec = recRef.current;
    recRef.current = null;
    setLevel(0);

    let uri: string | null = null;
    if (rec) {
      try {
        rec.setOnRecordingStatusUpdate(null);
        await rec.stopAndUnloadAsync();
      } catch {
        // already stopped / unloaded
      }
      uri = rec.getURI();
    }
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
    finishingRef.current = false;

    if (reason === "cancel") {
      setState("idle");
      return;
    }
    if (reason === "no-speech") {
      setError("I didn't hear anything. Tap the mic and try again — or type it below.");
      setState("error");
      return;
    }
    if (!uri) {
      setError("Recording failed. Please try again.");
      setState("error");
      return;
    }

    setState("transcribing");
    try {
      const filename = uri.split("/").pop() || "recording.m4a";
      const ext = /\.(\w+)$/.exec(filename)?.[1]?.toLowerCase() ?? "m4a";
      const type = ext === "mp4" ? "audio/mp4" : ext === "wav" ? "audio/wav" : ext === "caf" ? "audio/x-caf" : "audio/m4a";
      const formData = new FormData();
      formData.append("audio", {
        uri: Platform.OS === "android" ? uri : uri.replace("file://", ""),
        name: filename,
        type,
      } as unknown as Blob);

      const { data } = await api.post<{ transcript: string }>("/voice/transcribe", formData, {
        headers: { Accept: "application/json", "Content-Type": "multipart/form-data" },
        transformRequest: (d) => d,
        // Server-side STT may poll AssemblyAI and then fall back to Groq/Gemini.
        timeout: 120000,
      });
      if (session !== sessionRef.current) return; // cancelled meanwhile

      const text = (data?.transcript || "").trim();
      if (!text) {
        setError("I couldn't make out any words. Try again a little closer to the mic.");
        setState("error");
        return;
      }
      setState("idle");
      onTranscriptRef.current(text);
    } catch (err: any) {
      if (session !== sessionRef.current) return;
      const status = err?.response?.status;
      setError(
        status === 503
          ? "Voice input isn't set up on the server yet. You can type the expense below."
          : err?.code === "ECONNABORTED"
          ? "That took too long. Check your connection and try again."
          : "Couldn't transcribe that. Try again, or type it below."
      );
      setState("error");
    }
  }, []);

  const onStatus = useCallback(
    (status: Audio.RecordingStatus) => {
      if (!status.isRecording) return;
      const vad = vadRef.current;
      const duration = status.durationMillis ?? 0;
      const dt = Math.max(0, duration - vad.lastDuration);
      vad.lastDuration = duration;
      setElapsedMs(duration);

      const m = typeof status.metering === "number" ? status.metering : undefined;
      if (m === undefined) {
        if (duration > 1200 && !vad.meteringSeen) setAutoStop(false);
      } else {
        vad.meteringSeen = true;
        setLevel(Math.min(1, Math.max(0, (m + 55) / 45)));

        if (duration <= CALIBRATION_MS) {
          vad.floorSum += m;
          vad.floorSamples += 1;
          const floor = vad.floorSum / vad.floorSamples;
          vad.threshold = Math.min(-26, Math.max(floor + 10, -45));
        } else if (m > vad.threshold) {
          vad.speechMs += dt;
          vad.silenceMs = 0;
          if (vad.speechMs >= MIN_SPEECH_MS) vad.heardSpeech = true;
        } else {
          vad.silenceMs += dt;
        }

        if (vad.heardSpeech && vad.silenceMs >= SILENCE_TO_STOP_MS) {
          void finish("done");
          return;
        }
        if (!vad.heardSpeech && duration >= NO_SPEECH_TIMEOUT_MS) {
          void finish("no-speech");
          return;
        }
      }
      if (duration >= MAX_DURATION_MS) void finish("done");
    },
    [finish]
  );

  const start = useCallback(async () => {
    if (recRef.current || finishingRef.current) return;
    sessionRef.current += 1;
    setError(null);
    setElapsedMs(0);
    setLevel(0);
    setAutoStop(true);
    vadRef.current = freshVad();
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (perm.status !== "granted") {
        setError("Microphone access is off. Enable it in Settings to add expenses by voice.");
        setState("error");
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(
        { ...Audio.RecordingOptionsPresets.HIGH_QUALITY, isMeteringEnabled: true },
        onStatus,
        STATUS_INTERVAL_MS
      );
      recRef.current = recording;
      setState("listening");
    } catch (err: any) {
      setError("Couldn't start the microphone. Close other apps using it and try again.");
      setState("error");
    }
  }, [onStatus]);

  const stop = useCallback(() => finish("done"), [finish]);

  const cancel = useCallback(() => {
    sessionRef.current += 1;
    if (recRef.current) return finish("cancel");
    setState("idle");
    return Promise.resolve();
  }, [finish]);

  const reset = useCallback(() => {
    setError(null);
    setState((s) => (s === "error" ? "idle" : s));
  }, []);

  // Never leave the mic open if the screen unmounts mid-recording.
  useEffect(
    () => () => {
      sessionRef.current += 1;
      const rec = recRef.current;
      recRef.current = null;
      if (rec) {
        rec.setOnRecordingStatusUpdate(null);
        rec.stopAndUnloadAsync().catch(() => {});
      }
    },
    []
  );

  return { state, level, elapsedMs, error, autoStop, start, stop, cancel, reset };
}
