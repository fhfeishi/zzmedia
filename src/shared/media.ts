export type MediaStreamKind = 'audio' | 'video' | 'subtitle' | 'data' | 'attachment' | 'unknown'

export type MediaStreamInfo = {
  index: number
  kind: MediaStreamKind
  codecName: string
  codecLongName: string
  durationSeconds: number | null
  bitRate: number | null
  width?: number
  height?: number
  fps?: number | null
  channels?: number
  sampleRate?: number
  language?: string
  title?: string
}

export type ProbeResult = {
  filePath: string
  fileName: string
  formatName: string
  durationSeconds: number | null
  sizeBytes: number | null
  bitRate: number | null
  streams: MediaStreamInfo[]
}

export type ToolStatus = {
  ffmpeg: string | null
  ffprobe: string | null
}

export type ExtractionTarget = 'audio' | 'video' | 'both'
export type AudioFormat = 'wav' | 'mp3' | 'm4a' | 'flac' | 'opus'
export type AudioChannels = 'source' | 'mono' | 'stereo'
export type MuxAudioMode = 'copy' | 'aac'
export type FilePickerKind = 'media' | 'audio' | 'video'
export type RepairStrategy = 'remux' | 'reencode'
export type VideoCodec = 'h264' | 'h265'
export type VideoPreset = 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium' | 'slow'
export type VideoAudioMode = 'copy' | 'aac' | 'none'
export type TrimTarget = 'media' | 'video' | 'audio'
export type TrimMode = 'copy' | 'reencode'

export type ExtractRequest = {
  inputPath: string
  outputDir: string
  target: ExtractionTarget
  overwrite: boolean
}

export type ExtractedOutput = {
  kind:
    | 'audio'
    | 'video'
    | 'converted-audio'
    | 'muxed-video'
    | 'edited-audio'
    | 'repaired-media'
    | 'transcoded-video'
    | 'trimmed-media'
    | 'trimmed-video'
    | 'trimmed-audio'
  path: string
}

export type ExtractResult = {
  outputs: ExtractedOutput[]
  log: string
}

export type AudioConvertRequest = {
  inputPath: string
  outputDir: string
  format: AudioFormat
  sampleRate: number | 'source'
  channels: AudioChannels
  bitrateKbps: number | 'auto'
  overwrite: boolean
}

export type MuxRequest = {
  videoPath: string
  audioPath: string
  outputDir: string
  audioMode: MuxAudioMode
  shortest: boolean
  overwrite: boolean
}

export type ReplaceAudioSegmentRequest = {
  sourceAudioPath: string
  replacementAudioPath: string
  outputDir: string
  startSeconds: number
  endSeconds: number
  format: AudioFormat
  sampleRate: number
  channels: Exclude<AudioChannels, 'source'>
  overwrite: boolean
}

export type RepairMediaRequest = {
  inputPath: string
  outputDir: string
  strategy: RepairStrategy
  overwrite: boolean
}

export type VideoTranscodeRequest = {
  inputPath: string
  outputDir: string
  codec: VideoCodec
  width: number | 'source'
  height: number | 'source'
  crf: number
  preset: VideoPreset
  audioMode: VideoAudioMode
  overwrite: boolean
}

export type TrimMediaRequest = {
  inputPath: string
  outputDir: string
  target: TrimTarget
  mode: TrimMode
  startSeconds: number
  endSeconds: number
  overwrite: boolean
}
