"use client";

import "@livekit/components-styles";

import { LiveKitRoom, VideoConference } from "@livekit/components-react";
import { useState } from "react";

/**
 * The in-app consultation room (LiveKit's prebuilt conference UI: video grid, mic/camera
 * controls, screen share and in-call chat). Loaded client-side only — it needs WebRTC.
 * A click on LiveKit's Leave button goes to `onLeaveRequest` (to be confirmed) instead of
 * hanging up; `onLeave` runs once the call has actually ended.
 */
export default function VideoRoom({
  token,
  serverUrl,
  onLeave,
  onLeaveRequest,
}: {
  token: string;
  serverUrl: string;
  onLeave: () => void;
  onLeaveRequest: () => void;
}) {
  const [deviceProblem, setDeviceProblem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {deviceProblem && (
        <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          {deviceProblem}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      {/* Video stages are conventionally dark; the rest of the site stays light. */}
      <div
        data-lk-theme="default"
        className="h-[calc(100vh-11rem)] min-h-[480px] overflow-hidden rounded-2xl border border-slate-200"
        onClickCapture={(e) => {
          // Caught on the way down, before LiveKit's own handler disconnects.
          if (e.target instanceof Element && e.target.closest(".lk-disconnect-button")) {
            e.preventDefault();
            e.stopPropagation();
            onLeaveRequest();
          }
        }}
      >
        <LiveKitRoom
          token={token}
          serverUrl={serverUrl}
          connect
          video
          audio
          onDisconnected={onLeave}
          onError={(e) => setError(`Connection problem: ${e.message}`)}
          onMediaDeviceFailure={(_failure, kind) =>
            setDeviceProblem(
              `Your ${kind === "videoinput" ? "camera" : kind === "audioinput" ? "microphone" : "camera or microphone"} isn't available. Check your browser's permissions — you can still join and hear the other person.`,
            )
          }
          style={{ height: "100%" }}
        >
          <VideoConference />
        </LiveKitRoom>
      </div>
    </div>
  );
}
