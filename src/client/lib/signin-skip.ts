// "Not now" on the sign-in screen for someone who was signed in but whose session is gone: don't bounce them back there again
// during this app load (they can keep using the app offline-first; their data stays on the device).
let skip = false;
export const skipSignInPrompt = () => { skip = true; };
export const signInPromptSkipped = () => skip;
