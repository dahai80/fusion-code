import { createShellSdk } from '@fusion/web-sdk';

// Shell SDK for theme/i18n/toast bridging. HTTP calls go direct same-origin
// (backend serves the SPA and the API behind one port; embedded mode rides
// the gateway /shell/fusion-code/ proxy — also same-origin). No keys in UI.
export const sdk = createShellSdk();
