"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";

export interface AudioRecorderHandle {
  blob: Blob | null;
  durationSec: number;
}

export function AudioRecorder({ onChange }: { onChange: (h: AudioRecorderHandle) => void }) {
  const [recording, setRecording] = useState(false);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => stopStreamOnly(), []);

  function stopStreamOnly() {
    if (tickRef.current) clearInterval(tickRef.current);
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== "inactive") {
      mr.stop();
    }
    mr?.stream?.getTracks().forEach((t) => t.stop());
  }

  async function start() {
    setError(null);
    setBlob(null);
    setDuration(0);
    chunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      mediaRecorderRef.current = mr;
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        const b = new Blob(chunksRef.current, { type: mime || "audio/webm" });
        setBlob(b);
        const sec = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
        setDuration(sec);
        onChange({ blob: b, durationSec: sec });
        mr.stream.getTracks().forEach((t) => t.stop());
      };
      mr.start();
      setRecording(true);
      startedAtRef.current = Date.now();
      tickRef.current = setInterval(() => {
        setDuration(Math.round((Date.now() - startedAtRef.current) / 1000));
      }, 250);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Permiso de micrófono denegado");
    }
  }

  function stop() {
    if (tickRef.current) clearInterval(tickRef.current);
    setRecording(false);
    mediaRecorderRef.current?.stop();
  }

  function discard() {
    setBlob(null);
    setDuration(0);
    onChange({ blob: null, durationSec: 0 });
  }

  return (
    <div className="space-y-3 rounded-md border border-muted p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Grabación de audio</span>
        <span className="font-mono text-sm text-muted-foreground">
          {String(Math.floor(duration / 60)).padStart(2, "0")}:{String(duration % 60).padStart(2, "0")}
        </span>
      </div>

      {!recording && !blob && (
        <Button variant="primary" size="lg" className="w-full gap-2" onClick={start}>
          <Mic size={22} /> Grabar
        </Button>
      )}

      {recording && (
        <Button variant="destructive" size="lg" className="w-full gap-2" onClick={stop}>
          <Square size={22} /> Detener
        </Button>
      )}

      {!recording && blob && (
        <div className="space-y-2">
          <audio controls src={URL.createObjectURL(blob)} className="w-full" />
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={start}>
              Regrabar
            </Button>
            <Button variant="ghost" className="gap-2" onClick={discard}>
              <Trash2 size={18} /> Borrar
            </Button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
