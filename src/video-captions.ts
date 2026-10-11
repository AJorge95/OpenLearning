export function selectVideoCaptionTrack(
  video: Pick<HTMLVideoElement, 'textTracks' | 'querySelectorAll'> | null,
  captionId: string,
) {
  if (!video) return;

  for (const textTrack of Array.from(video.textTracks)) textTrack.mode = 'disabled';
  if (!captionId) return;

  const selectedTrack = Array.from(video.querySelectorAll<HTMLTrackElement>('track[data-caption-id]'))
    .find((track) => track.dataset.captionId === captionId);
  if (selectedTrack) selectedTrack.track.mode = 'showing';
}
