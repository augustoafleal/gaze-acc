export function speak(text: string): void {
  if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) return;

  try {
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  } catch {
    // Speech is optional feedback; selection state remains authoritative.
  }
}
