"use client";

import "@livekit/components-styles";

import {
  LiveKitRoom,
  TrackToggle,
  VideoTrack,
  isTrackReference,
  useConnectionState,
  useRemoteParticipants,
  useTracks,
} from "@livekit/components-react";
import { ConnectionState, DisconnectReason, Track } from "livekit-client";
import Link from "next/link";
import { useRef, useState } from "react";

import { CallConference } from "./call-conference";

/** Why the call ended (and whether rejoining makes sense), or null if we hung up ourselves. */
function ended(reason?: DisconnectReason): { text: string; canRejoin: boolean } | null {
  switch (reason) {
    case DisconnectReason.CLIENT_INITIATED:
      return null;
    case DisconnectReason.DUPLICATE_IDENTITY:
      return { text: "You joined this call in another tab or on another device, so it ended here.", canRejoin: true };
    case DisconnectReason.ROOM_DELETED:
      // The server closes the room when the appointment is completed, cancelled or expires.
      return { text: "The consultation has ended, so its video call was closed.", canRejoin: false };
    case DisconnectReason.PARTICIPANT_REMOVED:
      return { text: "You were removed from the video call.", canRejoin: false };
    default:
      return { text: "The connection to the video call was lost.", canRejoin: true };
  }
}

/** The small window shown on other pages: the other person's video and the basic controls. */
function MiniCall({ appointmentId, onLeaveRequest }: { appointmentId: number; onLeaveRequest: () => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const state = useConnectionState();
  const remotes = useRemoteParticipants();
  const tracks = useTracks(
    [
      { source: Track.Source.ScreenShare, withPlaceholder: false },
      { source: Track.Source.Camera, withPlaceholder: true },
    ],
    { onlySubscribed: false },
  ).filter((t) => !t.participant.isLocal);
  const shown = tracks.find((t) => t.source === Track.Source.ScreenShare && isTrackReference(t)) ?? tracks[0];
  const other = remotes[0]?.name || remotes[0]?.identity || null;
  const reconnecting = state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting;

  return (
    <div className="text-white">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <p className="min-w-0 truncate text-xs font-semibold">
          <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${reconnecting ? "bg-amber-400" : "bg-emerald-400"}`} />
          {reconnecting ? "Reconnecting…" : other ? `In call with ${other}` : "In your video call"}
        </p>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          className="shrink-0 rounded px-1.5 py-0.5 text-xs text-slate-300 hover:bg-white/10 hover:text-white"
        >
          {collapsed ? "Show video" : "Hide video"}
        </button>
      </div>
      {!collapsed && (
        <div className="relative aspect-video bg-slate-800">
          {shown && isTrackReference(shown) && !shown.publication.isMuted ? (
            <VideoTrack trackRef={shown} className="h-full w-full object-cover" />
          ) : (
            <p className="flex h-full items-center justify-center px-4 text-center text-xs text-slate-300">
              {other ? `${other}'s camera is off` : "Waiting for the other person to join…"}
            </p>
          )}
        </div>
      )}
      <div className="flex items-center gap-1.5 px-2 py-2">
        <TrackToggle source={Track.Source.Microphone} aria-label="Microphone" className="lk-button px-2! py-1.5!" />
        <TrackToggle source={Track.Source.Camera} aria-label="Camera" className="lk-button px-2! py-1.5!" />
        <Link
          href={`/appointments/${appointmentId}/call`}
          className="ml-auto rounded-md bg-white/10 px-2.5 py-1.5 text-xs font-semibold hover:bg-white/20"
        >
          Open call
        </Link>
        <button
          type="button"
          onClick={onLeaveRequest}
          className="rounded-md bg-red-600 px-2.5 py-1.5 text-xs font-semibold hover:bg-red-700"
        >
          Leave
        </button>
      </div>
    </div>
  );
}

/**
 * The live consultation (LiveKit). One instance for the whole call: on the call page it's
 * the full conference (video grid, controls, screen share, chat); anywhere else the same
 * connection is shown as a small window, so browsing never hangs up. A click on Leave asks
 * first (`onLeaveRequest`); `onEnded` reports a call that ended without the user leaving.
 */
export default function CallDock({
  appointmentId,
  token,
  serverUrl,
  full,
  onLeaveRequest,
  onEnded,
}: {
  appointmentId: number;
  token: string;
  serverUrl: string;
  full: boolean;
  onLeaveRequest: () => void;
  onEnded: (text: string, canRejoin: boolean) => void;
}) {
  const [deviceProblem, setDeviceProblem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const connected = useRef(false);

  return (
    <div
      data-call-dock={full ? "full" : "mini"}
      className={
        full
          ? "mx-auto w-full max-w-6xl space-y-3 px-4 pb-8 sm:px-6"
          : "fixed bottom-4 left-4 z-40 w-60 overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl sm:w-80"
      }
    >
      {full && deviceProblem && (
        <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          {deviceProblem}
        </p>
      )}
      {full && error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      <LiveKitRoom
        token={token}
        serverUrl={serverUrl}
        connect
        video
        audio
        data-lk-theme="default"
        onConnected={() => {
          connected.current = true;
        }}
        onDisconnected={(reason) => {
          const why = ended(reason);
          if (why) onEnded(why.text, why.canRejoin);
        }}
        onError={(e) => {
          // Before connecting, an error means there's no call; after, it's shown and the call goes on.
          if (!connected.current) onEnded(`Couldn't connect to the video call: ${e.message}`, true);
          else setError(`Connection problem: ${e.message}`);
        }}
        onMediaDeviceFailure={(_failure, kind) =>
          setDeviceProblem(
            `Your ${kind === "videoinput" ? "camera" : kind === "audioinput" ? "microphone" : "camera or microphone"} isn't available. Check your browser's permissions — you can still join and hear the other person.`,
          )
        }
        style={full ? { height: "auto", background: "transparent" } : { height: "auto" }}
      >
        {/* Kept mounted while minimised, so the chat and layout survive. It's moved off-screen
            at a normal size rather than display:none — a zero-size grid confuses LiveKit's layout. */}
        <div
          aria-hidden={!full}
          inert={!full}
          className={
            full
              ? "h-[calc(100vh-11rem)] min-h-[480px] overflow-hidden rounded-2xl border border-slate-200"
              : "pointer-events-none invisible fixed top-0 left-[-200vw] h-[540px] w-[960px]"
          }
          onClickCapture={(e) => {
            // Caught on the way down, before LiveKit's own handler hangs up.
            if (e.target instanceof Element && e.target.closest(".lk-disconnect-button")) {
              e.preventDefault();
              e.stopPropagation();
              onLeaveRequest();
            }
          }}
        >
          <CallConference appointmentId={appointmentId} />
        </div>
        {!full && <MiniCall appointmentId={appointmentId} onLeaveRequest={onLeaveRequest} />}
        {!full && deviceProblem && <p className="px-3 pb-2 text-xs text-amber-300">{deviceProblem}</p>}
      </LiveKitRoom>
    </div>
  );
}
