const liveKitModuleUrl = 'https://esm.sh/livekit-client@2.9.6';

export async function connectAudioRoom({ serverUrl, token, audioRoot, onParticipantsChanged, onDisconnected }) {
  const { Room, RoomEvent } = await import(liveKitModuleUrl);
  const room = new Room();

  room.on(RoomEvent.TrackSubscribed, (track) => {
    if (track.kind !== 'audio') return;
    const audio = track.attach();
    audio.autoplay = true;
    audio.playsInline = true;
    audioRoot.replaceChildren(audio);
  });

  room.on(RoomEvent.TrackUnsubscribed, (track) => {
    for (const element of track.detach()) element.remove();
  });

  room.on(RoomEvent.ParticipantConnected, () => {
    onParticipantsChanged(room.remoteParticipants.size);
  });

  room.on(RoomEvent.ParticipantDisconnected, () => {
    onParticipantsChanged(room.remoteParticipants.size);
  });

  room.on(RoomEvent.Disconnected, onDisconnected);

  await room.connect(serverUrl, token);
  await room.localParticipant.setMicrophoneEnabled(true);
  onParticipantsChanged(room.remoteParticipants.size);
  return room;
}