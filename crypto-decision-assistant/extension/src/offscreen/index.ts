const activeAudio = new Set<HTMLAudioElement>();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'PLAY_NOTIFICATION_SOUND') return false;
  const audio = new Audio(String(message.soundUrl));
  activeAudio.add(audio);
  const release = () => activeAudio.delete(audio);
  audio.addEventListener('ended', release, { once: true });
  void audio.play()
    .then(() => sendResponse({ ok: true }))
    .catch(error => { release(); sendResponse({ ok: false, error: String(error) }); });
  return true;
});
