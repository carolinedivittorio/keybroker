/// <reference types="vite/client" />
import type { KeybrokerApi } from '../../shared/api';

declare global {
  interface Window {
    keybroker: KeybrokerApi;
  }
}
