/// <reference types="vite/client" />

import type { ZzMediaApi } from '../../preload'

declare global {
  interface Window {
    zzMedia: ZzMediaApi
  }
}
