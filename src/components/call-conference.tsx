"use client";

import {
  CarouselLayout,
  ConnectionStateToast,
  ControlBar,
  FocusLayout,
  FocusLayoutContainer,
  GridLayout,
  LayoutContextProvider,
  ParticipantTile,
  RoomAudioRenderer,
  isTrackReference,
  useCreateLayoutContext,
  usePinnedTracks,
  useTracks,
} from "@livekit/components-react";
import type { TrackReferenceOrPlaceholder, WidgetState } from "@livekit/components-react";
import { RoomEvent, Track } from "livekit-client";
import { useEffect, useRef, useState } from "react";

import { CallChat } from "./call-chat";

function sameTrack(a?: TrackReferenceOrPlaceholder, b?: TrackReferenceOrPlaceholder): boolean {
  if (!a || !b) return false;
  if (isTrackReference(a) && isTrackReference(b)) return a.publication.trackSid === b.publication.trackSid;
  return a.participant.identity === b.participant.identity && a.source === b.source;
}

/**
 * The consultation: LiveKit's standard conference layout (video grid, or a focused screen
 * share with the others alongside, the control bar, in-call notices) — built from its parts
 * as LiveKit's own <VideoConference> is — with our chat, which can also share documents.
 */
export function CallConference({ appointmentId }: { appointmentId: number }) {
  const [widget, setWidget] = useState<WidgetState>({ showChat: false, unreadMessages: 0, showSettings: false });
  const autoFocused = useRef<TrackReferenceOrPlaceholder | null>(null);
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { updateOnlyOn: [RoomEvent.ActiveSpeakersChanged], onlySubscribed: false },
  );
  const layout = useCreateLayoutContext();
  const screenShares = tracks.filter(isTrackReference).filter((t) => t.publication.source === Track.Source.ScreenShare);
  const focusTrack = usePinnedTracks(layout)?.[0];
  const others = tracks.filter((t) => !sameTrack(t, focusTrack));

  // A screen share takes the focus when it starts, and gives it back when it stops.
  const screenShareKey = screenShares.map((t) => `${t.publication.trackSid}_${t.publication.isSubscribed}`).join();
  useEffect(() => {
    if (screenShares.some((t) => t.publication.isSubscribed) && autoFocused.current === null) {
      layout.pin.dispatch?.({ msg: "set_pin", trackReference: screenShares[0] });
      autoFocused.current = screenShares[0];
    } else if (
      autoFocused.current &&
      !screenShares.some((t) => t.publication.trackSid === autoFocused.current?.publication?.trackSid)
    ) {
      layout.pin.dispatch?.({ msg: "clear_pin" });
      autoFocused.current = null;
    }
    if (focusTrack && !isTrackReference(focusTrack)) {
      const updated = tracks.find(
        (t) => t.participant.identity === focusTrack.participant.identity && t.source === focusTrack.source,
      );
      if (updated && updated !== focusTrack && isTrackReference(updated)) {
        layout.pin.dispatch?.({ msg: "set_pin", trackReference: updated });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the same triggers as LiveKit's own conference
  }, [screenShareKey, focusTrack?.publication?.trackSid, tracks]);

  return (
    <div className="lk-video-conference">
      <LayoutContextProvider value={layout} onWidgetChange={setWidget}>
        <div className="lk-video-conference-inner">
          {focusTrack ? (
            <div className="lk-focus-layout-wrapper">
              <FocusLayoutContainer>
                <CarouselLayout tracks={others}>
                  <ParticipantTile />
                </CarouselLayout>
                <FocusLayout trackRef={focusTrack} />
              </FocusLayoutContainer>
            </div>
          ) : (
            <div className="lk-grid-layout-wrapper">
              <GridLayout tracks={tracks}>
                <ParticipantTile />
              </GridLayout>
            </div>
          )}
          <ControlBar controls={{ chat: true, settings: false }} />
        </div>
        <CallChat appointmentId={appointmentId} style={{ display: widget.showChat ? "grid" : "none" }} />
      </LayoutContextProvider>
      <RoomAudioRenderer />
      <ConnectionStateToast />
    </div>
  );
}
