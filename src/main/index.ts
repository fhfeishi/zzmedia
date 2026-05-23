import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access, constants } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron'
import type {
  AudioChannels,
  AudioConvertRequest,
  AudioFormat,
  ExtractRequest,
  ExtractResult,
  ExtractedOutput,
  FilePickerKind,
  MediaStreamInfo,
  MediaStreamKind,
  MuxRequest,
  ReplaceAudioSegmentRequest,
  ProbeResult,
  RepairMediaRequest,
  RepairStrategy,
  TrimMediaRequest,
  TrimMode,
  TrimTarget,
  ToolStatus,
  VideoAudioMode,
  VideoCodec,
  VideoTranscodeRequest
} from '../shared/media'

const execFileAsync = promisify(execFile)
const ffmpegPath = process.env.FFMPEG_PATH ?? 'ffmpeg'
const ffprobePath = process.env.FFPROBE_PATH ?? 'ffprobe'
const mediaUrlTokens = new Map<string, string>()

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'zzmedia',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true
    }
  }
])

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1160,
    height: 760,
    minWidth: 920,
    minHeight: 620,
    title: 'ZZ Media',
    backgroundColor: '#f4f6f8',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl) {
    mainWindow.loadURL(rendererUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function parseNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === 'N/A') {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parseOptionalNumber(value: unknown): number | undefined {
  const parsed = parseNumber(value)
  return parsed ?? undefined
}

function parseFrameRate(rate: unknown): number | null {
  if (typeof rate !== 'string' || rate === '0/0') {
    return null
  }

  const [numerator, denominator] = rate.split('/').map(Number)
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null
  }

  return numerator / denominator
}

function normalizeKind(codecType: unknown): MediaStreamKind {
  if (
    codecType === 'audio' ||
    codecType === 'video' ||
    codecType === 'subtitle' ||
    codecType === 'data' ||
    codecType === 'attachment'
  ) {
    return codecType
  }

  return 'unknown'
}

function normalizeProbe(filePath: string, payload: unknown): ProbeResult {
  const data = payload as {
    format?: {
      format_name?: string
      duration?: string
      size?: string
      bit_rate?: string
    }
    streams?: Array<Record<string, unknown>>
  }

  const streams: MediaStreamInfo[] = (data.streams ?? []).map((stream) => {
    const tags = (stream.tags ?? {}) as Record<string, string>
    return {
      index: Number(stream.index ?? 0),
      kind: normalizeKind(stream.codec_type),
      codecName: String(stream.codec_name ?? 'unknown'),
      codecLongName: String(stream.codec_long_name ?? ''),
      durationSeconds: parseNumber(stream.duration),
      bitRate: parseNumber(stream.bit_rate),
      width: parseOptionalNumber(stream.width),
      height: parseOptionalNumber(stream.height),
      fps: parseFrameRate(stream.avg_frame_rate),
      channels: parseOptionalNumber(stream.channels),
      sampleRate: parseOptionalNumber(stream.sample_rate),
      language: tags.language,
      title: tags.title
    }
  })

  return {
    filePath,
    fileName: basename(filePath),
    formatName: data.format?.format_name ?? 'unknown',
    durationSeconds: parseNumber(data.format?.duration),
    sizeBytes: parseNumber(data.format?.size),
    bitRate: parseNumber(data.format?.bit_rate),
    streams
  }
}

async function probeMedia(filePath: string): Promise<ProbeResult> {
  await access(filePath, constants.R_OK)
  const { stdout } = await execFileAsync(
    ffprobePath,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
    { windowsHide: true, maxBuffer: 32 * 1024 * 1024 }
  )

  return normalizeProbe(filePath, JSON.parse(stdout))
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} is required.`)
  }

  return value
}

function assertAudioFormat(value: unknown): AudioFormat {
  if (value === 'wav' || value === 'mp3' || value === 'm4a' || value === 'flac' || value === 'opus') {
    return value
  }

  throw new Error('Unsupported audio format.')
}

function assertAudioChannels(value: unknown): AudioChannels {
  if (value === 'source' || value === 'mono' || value === 'stereo') {
    return value
  }

  throw new Error('Unsupported channel option.')
}

function assertRepairStrategy(value: unknown): RepairStrategy {
  if (value === 'remux' || value === 'reencode') {
    return value
  }

  throw new Error('Unsupported repair strategy.')
}

function assertVideoCodec(value: unknown): VideoCodec {
  if (value === 'h264' || value === 'h265') {
    return value
  }

  throw new Error('Unsupported video codec.')
}

function assertVideoAudioMode(value: unknown): VideoAudioMode {
  if (value === 'copy' || value === 'aac' || value === 'none') {
    return value
  }

  throw new Error('Unsupported audio mode.')
}

function assertTrimTarget(value: unknown): TrimTarget {
  if (value === 'media' || value === 'video' || value === 'audio') {
    return value
  }

  throw new Error('Unsupported trim target.')
}

function assertTrimMode(value: unknown): TrimMode {
  if (value === 'copy' || value === 'reencode') {
    return value
  }

  throw new Error('Unsupported trim mode.')
}

async function getFirstLine(command: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(command, args, {
      windowsHide: true,
      maxBuffer: 1024 * 1024
    })
    return stdout.split(/\r?\n/)[0] || null
  } catch {
    return null
  }
}

function audioExtensionForCodec(codecName: string): string {
  switch (codecName) {
    case 'aac':
    case 'alac':
      return 'm4a'
    case 'mp3':
      return 'mp3'
    case 'flac':
      return 'flac'
    case 'opus':
      return 'opus'
    case 'vorbis':
      return 'ogg'
    default:
      return 'audio'
  }
}

function codecForAudioFormat(format: AudioFormat): string {
  switch (format) {
    case 'wav':
      return 'pcm_s16le'
    case 'mp3':
      return 'libmp3lame'
    case 'm4a':
      return 'aac'
    case 'flac':
      return 'flac'
    case 'opus':
      return 'libopus'
  }
}

function defaultBitrateForFormat(format: AudioFormat): number | null {
  switch (format) {
    case 'mp3':
    case 'm4a':
      return 192
    case 'opus':
      return 96
    case 'wav':
    case 'flac':
      return null
  }
}

function encoderForVideoCodec(codec: VideoCodec): string {
  return codec === 'h264' ? 'libx264' : 'libx265'
}

function videoCodecSuffix(codec: VideoCodec): string {
  return codec === 'h264' ? 'h264' : 'h265'
}

function channelCount(channels: AudioChannels): number | null {
  switch (channels) {
    case 'mono':
      return 1
    case 'stereo':
      return 2
    case 'source':
      return null
  }
}

function channelLayout(channels: Exclude<AudioChannels, 'source'>): string {
  return channels === 'mono' ? 'mono' : 'stereo'
}

function assertPositiveNumber(value: unknown, label: string): number {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    throw new Error(`${label} must be a positive number.`)
  }

  return numberValue
}

function assertNonNegativeNumber(value: unknown, label: string): number {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue) || numberValue < 0) {
    throw new Error(`${label} must be a non-negative number.`)
  }

  return numberValue
}

function outputFilters(kind: FilePickerKind): Electron.FileFilter[] {
  if (kind === 'audio') {
    return [
      { name: '音频文件', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'opus', 'ogg', 'mp4', 'mov'] },
      { name: '全部文件', extensions: ['*'] }
    ]
  }

  if (kind === 'video') {
    return [
      { name: '视频文件', extensions: ['mp4', 'm4v', 'mov', 'mkv', 'webm'] },
      { name: '全部文件', extensions: ['*'] }
    ]
  }

  return [
    { name: '媒体文件', extensions: ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'mp3', 'wav', 'm4a', 'aac', 'flac', 'opus', 'ogg'] },
    { name: '全部文件', extensions: ['*'] }
  ]
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function nextAvailablePath(path: string): Promise<string> {
  if (!(await pathExists(path))) {
    return path
  }

  const extension = extname(path)
  const stem = path.slice(0, -extension.length)
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${stem} (${index})${extension}`
    if (!(await pathExists(candidate))) {
      return candidate
    }
  }

  throw new Error('No available output file name could be found.')
}

function runFfmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let log = ''
    child.stdout.on('data', (chunk) => {
      log += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      log += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve(log)
      } else {
        reject(new Error(log.trim() || `FFmpeg exited with code ${code}.`))
      }
    })
  })
}

async function buildOutputPath(
  inputPath: string,
  outputDir: string,
  suffix: string,
  extension: string,
  overwrite: boolean
): Promise<string> {
  const stem = basename(inputPath, extname(inputPath))
  const targetPath = join(outputDir, `${stem}.${suffix}.${extension}`)
  return overwrite ? targetPath : nextAvailablePath(targetPath)
}

async function extractMedia(request: ExtractRequest): Promise<ExtractResult> {
  const inputPath = assertString(request.inputPath, 'inputPath')
  const outputDir = assertString(request.outputDir, 'outputDir')
  const overwrite = Boolean(request.overwrite)

  await access(inputPath, constants.R_OK)
  await access(outputDir, constants.W_OK)

  const probe = await probeMedia(inputPath)
  const outputs: ExtractedOutput[] = []
  const logs: string[] = []

  if (request.target === 'audio' || request.target === 'both') {
    const audioStream = probe.streams.find((stream) => stream.kind === 'audio')
    if (!audioStream) {
      throw new Error('No audio stream was found in this file.')
    }

    const outputPath = await buildOutputPath(
      inputPath,
      outputDir,
      'audio',
      audioExtensionForCodec(audioStream.codecName),
      overwrite
    )
    const log = await runFfmpeg([
      '-hide_banner',
      overwrite ? '-y' : '-n',
      '-i',
      inputPath,
      '-map',
      `0:${audioStream.index}`,
      '-vn',
      '-c:a',
      'copy',
      outputPath
    ])
    logs.push(log)
    outputs.push({ kind: 'audio', path: outputPath })
  }

  if (request.target === 'video' || request.target === 'both') {
    const videoStream = probe.streams.find((stream) => stream.kind === 'video')
    if (!videoStream) {
      throw new Error('No video stream was found in this file.')
    }

    const outputPath = await buildOutputPath(inputPath, outputDir, 'video', 'mp4', overwrite)
    const log = await runFfmpeg([
      '-hide_banner',
      overwrite ? '-y' : '-n',
      '-i',
      inputPath,
      '-map',
      `0:${videoStream.index}`,
      '-an',
      '-c:v',
      'copy',
      '-movflags',
      '+faststart',
      outputPath
    ])
    logs.push(log)
    outputs.push({ kind: 'video', path: outputPath })
  }

  return {
    outputs,
    log: logs.join('\n')
  }
}

async function convertAudio(request: AudioConvertRequest): Promise<ExtractResult> {
  const inputPath = assertString(request.inputPath, 'inputPath')
  const outputDir = assertString(request.outputDir, 'outputDir')
  const format = assertAudioFormat(request.format)
  const channels = assertAudioChannels(request.channels)
  const overwrite = Boolean(request.overwrite)

  await access(inputPath, constants.R_OK)
  await access(outputDir, constants.W_OK)

  const probe = await probeMedia(inputPath)
  if (!probe.streams.some((stream) => stream.kind === 'audio')) {
    throw new Error('No audio stream was found in this file.')
  }

  const outputPath = await buildOutputPath(inputPath, outputDir, 'converted', format, overwrite)
  const codec = codecForAudioFormat(format)
  const args = ['-hide_banner', overwrite ? '-y' : '-n', '-i', inputPath, '-map', '0:a:0', '-vn', '-c:a', codec]

  if (request.sampleRate !== 'source') {
    args.push('-ar', String(assertPositiveNumber(request.sampleRate, 'sampleRate')))
  }

  const outputChannelCount = channelCount(channels)
  if (outputChannelCount !== null) {
    args.push('-ac', String(outputChannelCount))
  }

  const bitrate =
    request.bitrateKbps === 'auto'
      ? defaultBitrateForFormat(format)
      : assertPositiveNumber(request.bitrateKbps, 'bitrateKbps')
  if (bitrate !== null && format !== 'wav' && format !== 'flac') {
    args.push('-b:a', `${bitrate}k`)
  }

  args.push(outputPath)
  const log = await runFfmpeg(args)

  return {
    outputs: [{ kind: 'converted-audio', path: outputPath }],
    log
  }
}

async function muxMedia(request: MuxRequest): Promise<ExtractResult> {
  const videoPath = assertString(request.videoPath, 'videoPath')
  const audioPath = assertString(request.audioPath, 'audioPath')
  const outputDir = assertString(request.outputDir, 'outputDir')
  const overwrite = Boolean(request.overwrite)

  await access(videoPath, constants.R_OK)
  await access(audioPath, constants.R_OK)
  await access(outputDir, constants.W_OK)

  const [videoProbe, audioProbe] = await Promise.all([probeMedia(videoPath), probeMedia(audioPath)])
  if (!videoProbe.streams.some((stream) => stream.kind === 'video')) {
    throw new Error('No video stream was found in the selected video file.')
  }
  if (!audioProbe.streams.some((stream) => stream.kind === 'audio')) {
    throw new Error('No audio stream was found in the selected audio file.')
  }

  const videoStem = basename(videoPath, extname(videoPath))
  const audioStem = basename(audioPath, extname(audioPath))
  const initialOutputPath = join(outputDir, `${videoStem}.with-${audioStem}.mp4`)
  const outputPath = overwrite ? initialOutputPath : await nextAvailablePath(initialOutputPath)
  const audioMode = request.audioMode === 'copy' ? 'copy' : 'aac'
  const args = [
    '-hide_banner',
    overwrite ? '-y' : '-n',
    '-i',
    videoPath,
    '-i',
    audioPath,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-c:v',
    'copy',
    '-c:a',
    audioMode === 'copy' ? 'copy' : 'aac'
  ]

  if (audioMode === 'aac') {
    args.push('-b:a', '192k')
  }
  if (request.shortest) {
    args.push('-shortest')
  }

  args.push('-movflags', '+faststart', outputPath)
  const log = await runFfmpeg(args)

  return {
    outputs: [{ kind: 'muxed-video', path: outputPath }],
    log
  }
}

async function replaceAudioSegment(request: ReplaceAudioSegmentRequest): Promise<ExtractResult> {
  const sourceAudioPath = assertString(request.sourceAudioPath, 'sourceAudioPath')
  const replacementAudioPath = assertString(request.replacementAudioPath, 'replacementAudioPath')
  const outputDir = assertString(request.outputDir, 'outputDir')
  const format = assertAudioFormat(request.format)
  const sampleRate = assertPositiveNumber(request.sampleRate, 'sampleRate')
  const channels = assertAudioChannels(request.channels)
  const startSeconds = assertNonNegativeNumber(request.startSeconds, 'startSeconds')
  const endSeconds = assertPositiveNumber(request.endSeconds, 'endSeconds')
  const overwrite = Boolean(request.overwrite)

  if (channels === 'source') {
    throw new Error('Replacement export requires mono or stereo channels.')
  }
  if (endSeconds <= startSeconds) {
    throw new Error('endSeconds must be greater than startSeconds.')
  }

  await access(sourceAudioPath, constants.R_OK)
  await access(replacementAudioPath, constants.R_OK)
  await access(outputDir, constants.W_OK)

  const [sourceProbe, replacementProbe] = await Promise.all([
    probeMedia(sourceAudioPath),
    probeMedia(replacementAudioPath)
  ])
  if (!sourceProbe.streams.some((stream) => stream.kind === 'audio')) {
    throw new Error('No audio stream was found in the source audio file.')
  }
  if (!replacementProbe.streams.some((stream) => stream.kind === 'audio')) {
    throw new Error('No audio stream was found in the replacement audio file.')
  }

  const outputPath = await buildOutputPath(sourceAudioPath, outputDir, 'replaced', format, overwrite)
  const codec = codecForAudioFormat(format)
  const layout = channelLayout(channels)
  const segmentFormat = `aformat=sample_fmts=fltp:sample_rates=${sampleRate}:channel_layouts=${layout}`
  const filter = [
    `[0:a]atrim=start=0:end=${startSeconds},asetpts=PTS-STARTPTS,${segmentFormat}[a0]`,
    `[1:a]atrim=start=0,asetpts=PTS-STARTPTS,${segmentFormat}[a1]`,
    `[0:a]atrim=start=${endSeconds},asetpts=PTS-STARTPTS,${segmentFormat}[a2]`,
    '[a0][a1][a2]concat=n=3:v=0:a=1[outa]'
  ].join(';')
  const args = [
    '-hide_banner',
    overwrite ? '-y' : '-n',
    '-i',
    sourceAudioPath,
    '-i',
    replacementAudioPath,
    '-filter_complex',
    filter,
    '-map',
    '[outa]',
    '-c:a',
    codec
  ]

  const bitrate = defaultBitrateForFormat(format)
  if (bitrate !== null && format !== 'wav' && format !== 'flac') {
    args.push('-b:a', `${bitrate}k`)
  }

  args.push(outputPath)
  const log = await runFfmpeg(args)

  return {
    outputs: [{ kind: 'edited-audio', path: outputPath }],
    log
  }
}

async function repairMedia(request: RepairMediaRequest): Promise<ExtractResult> {
  const inputPath = assertString(request.inputPath, 'inputPath')
  const outputDir = assertString(request.outputDir, 'outputDir')
  const strategy = assertRepairStrategy(request.strategy)
  const overwrite = Boolean(request.overwrite)

  await access(inputPath, constants.R_OK)
  await access(outputDir, constants.W_OK)

  const probe = await probeMedia(inputPath)
  if (!probe.streams.some((stream) => stream.kind === 'video' || stream.kind === 'audio')) {
    throw new Error('No audio or video stream was found in this file.')
  }

  const outputPath = await buildOutputPath(inputPath, outputDir, strategy === 'remux' ? 'repaired' : 'rebuilt', 'mp4', overwrite)
  const args = ['-hide_banner', overwrite ? '-y' : '-n', '-fflags', '+genpts+discardcorrupt', '-err_detect', 'ignore_err', '-i', inputPath]

  if (strategy === 'remux') {
    args.push(
      '-map',
      '0:v?',
      '-map',
      '0:a?',
      '-c',
      'copy',
      '-avoid_negative_ts',
      'make_zero',
      '-movflags',
      '+faststart',
      outputPath
    )
  } else {
    args.push(
      '-map',
      '0:v:0?',
      '-map',
      '0:a:0?',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart',
      outputPath
    )
  }

  const log = await runFfmpeg(args)

  return {
    outputs: [{ kind: 'repaired-media', path: outputPath }],
    log
  }
}

async function transcodeVideo(request: VideoTranscodeRequest): Promise<ExtractResult> {
  const inputPath = assertString(request.inputPath, 'inputPath')
  const outputDir = assertString(request.outputDir, 'outputDir')
  const codec = assertVideoCodec(request.codec)
  const audioMode = assertVideoAudioMode(request.audioMode)
  const crf = assertPositiveNumber(request.crf, 'crf')
  const overwrite = Boolean(request.overwrite)

  await access(inputPath, constants.R_OK)
  await access(outputDir, constants.W_OK)

  const probe = await probeMedia(inputPath)
  if (!probe.streams.some((stream) => stream.kind === 'video')) {
    throw new Error('No video stream was found in this file.')
  }

  const outputPath = await buildOutputPath(inputPath, outputDir, videoCodecSuffix(codec), 'mp4', overwrite)
  const args = [
    '-hide_banner',
    overwrite ? '-y' : '-n',
    '-i',
    inputPath,
    '-map',
    '0:v:0',
    '-c:v',
    encoderForVideoCodec(codec),
    '-preset',
    request.preset,
    '-crf',
    String(crf),
    '-pix_fmt',
    'yuv420p'
  ]

  if (request.width !== 'source' && request.height !== 'source') {
    const width = Math.round(assertPositiveNumber(request.width, 'width'))
    const height = Math.round(assertPositiveNumber(request.height, 'height'))
    args.push(
      '-vf',
      `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`
    )
  }

  if (codec === 'h265') {
    args.push('-tag:v', 'hvc1')
  }

  if (audioMode === 'none') {
    args.push('-an')
  } else {
    args.push('-map', '0:a:0?')
    if (audioMode === 'copy') {
      args.push('-c:a', 'copy')
    } else {
      args.push('-c:a', 'aac', '-b:a', '192k')
    }
  }

  args.push('-movflags', '+faststart', outputPath)
  const log = await runFfmpeg(args)

  return {
    outputs: [{ kind: 'transcoded-video', path: outputPath }],
    log
  }
}

async function trimMedia(request: TrimMediaRequest): Promise<ExtractResult> {
  const inputPath = assertString(request.inputPath, 'inputPath')
  const outputDir = assertString(request.outputDir, 'outputDir')
  const target = assertTrimTarget(request.target)
  const mode = assertTrimMode(request.mode)
  const startSeconds = assertNonNegativeNumber(request.startSeconds, 'startSeconds')
  const endSeconds = assertPositiveNumber(request.endSeconds, 'endSeconds')
  const overwrite = Boolean(request.overwrite)

  if (endSeconds <= startSeconds) {
    throw new Error('endSeconds must be greater than startSeconds.')
  }

  await access(inputPath, constants.R_OK)
  await access(outputDir, constants.W_OK)

  const probe = await probeMedia(inputPath)
  if (target !== 'audio' && !probe.streams.some((stream) => stream.kind === 'video')) {
    throw new Error('No video stream was found in this file.')
  }
  if (target !== 'video' && !probe.streams.some((stream) => stream.kind === 'audio')) {
    throw new Error('No audio stream was found in this file.')
  }

  const extension =
    target === 'audio'
      ? audioExtensionForCodec(probe.streams.find((stream) => stream.kind === 'audio')?.codecName ?? 'aac')
      : 'mp4'
  const outputKind =
    target === 'audio' ? 'trimmed-audio' : target === 'video' ? 'trimmed-video' : 'trimmed-media'
  const outputPath = await buildOutputPath(inputPath, outputDir, `trim-${target}`, extension, overwrite)
  const duration = endSeconds - startSeconds
  const args = [
    '-hide_banner',
    overwrite ? '-y' : '-n',
    '-ss',
    String(startSeconds),
    '-i',
    inputPath,
    '-t',
    String(duration)
  ]

  if (target === 'audio') {
    args.push('-map', '0:a:0', '-vn')
    if (mode === 'copy') {
      args.push('-c:a', 'copy')
    } else {
      args.push('-c:a', 'aac', '-b:a', '192k')
    }
  } else if (target === 'video') {
    args.push('-map', '0:v:0', '-an')
    if (mode === 'copy') {
      args.push('-c:v', 'copy')
    } else {
      args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p')
    }
  } else {
    args.push('-map', '0:v:0?', '-map', '0:a:0?')
    if (mode === 'copy') {
      args.push('-c', 'copy')
    } else {
      args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k')
    }
  }

  if (extension === 'mp4') {
    args.push('-avoid_negative_ts', 'make_zero', '-movflags', '+faststart')
  }
  args.push(outputPath)
  const log = await runFfmpeg(args)

  return {
    outputs: [{ kind: outputKind, path: outputPath }],
    log
  }
}

async function createMediaUrl(filePath: string): Promise<string> {
  await access(filePath, constants.R_OK)
  const token = randomUUID()
  mediaUrlTokens.set(token, filePath)
  return `zzmedia://asset/${token}`
}

function registerMediaProtocol(): void {
  protocol.handle('zzmedia', async (request) => {
    const url = new URL(request.url)
    if (url.hostname !== 'asset') {
      return new Response('Unknown media host.', { status: 404 })
    }

    const token = url.pathname.replace(/^\//, '')
    const filePath = mediaUrlTokens.get(token)
    if (!filePath) {
      return new Response('Media token expired or missing.', { status: 404 })
    }

    return net.fetch(pathToFileURL(filePath).toString())
  })
}

function registerIpc(): void {
  ipcMain.handle('dialog:select-media-file', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择媒体文件',
      properties: ['openFile'],
      filters: outputFilters('media')
    })

    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('dialog:select-file', async (_event, kind: FilePickerKind = 'media') => {
    const result = await dialog.showOpenDialog({
      title: '选择文件',
      properties: ['openFile'],
      filters: outputFilters(kind)
    })

    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('dialog:select-output-dir', async (_event, defaultPath?: string) => {
    const result = await dialog.showOpenDialog({
      title: '选择输出目录',
      defaultPath: typeof defaultPath === 'string' && defaultPath ? dirname(defaultPath) : undefined,
      properties: ['openDirectory', 'createDirectory']
    })

    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('media:probe', async (_event, inputPath: unknown) => {
    return probeMedia(assertString(inputPath, 'inputPath'))
  })

  ipcMain.handle('media:extract', async (_event, request: ExtractRequest) => {
    return extractMedia(request)
  })

  ipcMain.handle('media:convert-audio', async (_event, request: AudioConvertRequest) => {
    return convertAudio(request)
  })

  ipcMain.handle('media:mux', async (_event, request: MuxRequest) => {
    return muxMedia(request)
  })

  ipcMain.handle('media:replace-audio-segment', async (_event, request: ReplaceAudioSegmentRequest) => {
    return replaceAudioSegment(request)
  })

  ipcMain.handle('media:repair', async (_event, request: RepairMediaRequest) => {
    return repairMedia(request)
  })

  ipcMain.handle('media:transcode-video', async (_event, request: VideoTranscodeRequest) => {
    return transcodeVideo(request)
  })

  ipcMain.handle('media:trim', async (_event, request: TrimMediaRequest) => {
    return trimMedia(request)
  })

  ipcMain.handle('media:create-url', async (_event, inputPath: unknown) => {
    return createMediaUrl(assertString(inputPath, 'inputPath'))
  })

  ipcMain.handle('media:tool-status', async (): Promise<ToolStatus> => {
    const [ffmpeg, ffprobe] = await Promise.all([
      getFirstLine(ffmpegPath, ['-version']),
      getFirstLine(ffprobePath, ['-version'])
    ])

    return { ffmpeg, ffprobe }
  })

  ipcMain.handle('system:show-item', async (_event, itemPath: unknown) => {
    shell.showItemInFolder(assertString(itemPath, 'itemPath'))
  })
}

app.whenReady().then(() => {
  registerMediaProtocol()
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
