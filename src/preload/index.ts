import { contextBridge, ipcRenderer } from 'electron'
import type {
  AudioConvertRequest,
  ExtractRequest,
  ExtractResult,
  FilePickerKind,
  MuxRequest,
  ProbeResult,
  ReplaceAudioSegmentRequest,
  RepairMediaRequest,
  TrimMediaRequest,
  ToolStatus,
  VideoTranscodeRequest
} from '../shared/media'

const api = {
  selectMediaFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:select-media-file'),
  selectFile: (kind: FilePickerKind): Promise<string | null> => ipcRenderer.invoke('dialog:select-file', kind),
  selectOutputDir: (defaultPath?: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:select-output-dir', defaultPath),
  probeMedia: (inputPath: string): Promise<ProbeResult> => ipcRenderer.invoke('media:probe', inputPath),
  extractMedia: (request: ExtractRequest): Promise<ExtractResult> =>
    ipcRenderer.invoke('media:extract', request),
  convertAudio: (request: AudioConvertRequest): Promise<ExtractResult> =>
    ipcRenderer.invoke('media:convert-audio', request),
  muxMedia: (request: MuxRequest): Promise<ExtractResult> => ipcRenderer.invoke('media:mux', request),
  replaceAudioSegment: (request: ReplaceAudioSegmentRequest): Promise<ExtractResult> =>
    ipcRenderer.invoke('media:replace-audio-segment', request),
  repairMedia: (request: RepairMediaRequest): Promise<ExtractResult> => ipcRenderer.invoke('media:repair', request),
  transcodeVideo: (request: VideoTranscodeRequest): Promise<ExtractResult> =>
    ipcRenderer.invoke('media:transcode-video', request),
  trimMedia: (request: TrimMediaRequest): Promise<ExtractResult> => ipcRenderer.invoke('media:trim', request),
  createMediaUrl: (inputPath: string): Promise<string> => ipcRenderer.invoke('media:create-url', inputPath),
  getToolStatus: (): Promise<ToolStatus> => ipcRenderer.invoke('media:tool-status'),
  showItem: (itemPath: string): Promise<void> => ipcRenderer.invoke('system:show-item', itemPath)
}

contextBridge.exposeInMainWorld('zzMedia', api)

export type ZzMediaApi = typeof api
