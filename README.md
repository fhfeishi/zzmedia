# ZZ Media

ZZ Media 是一个面向桌面端的轻量音视频处理工具。当前版本聚焦本地轻量处理工作流：

- 选择本地 MP4 / 常见视频文件
- 使用 FFprobe 读取封装格式、时长、码率、音频轨和视频轨
- 使用 FFmpeg 无重编码提取 `audio_only`
- 使用 FFmpeg 无重编码提取 `video_only`
- 将音频转换为 `m4a`、`mp3`、`wav`、`flac`、`opus`
- 转换音频采样率、声道和常用码率
- 查看媒体封装、轨道、分辨率、帧率和码率信息
- 尝试修复轻微损坏的 MP4：快速重封装或 H.264 + AAC 重建编码
- 将视频转为 H.264 / H.265，并缩放到常用分辨率
- 按秒裁剪整段媒体、仅视频或仅音频
- 将 `audio_only` 与 `video_only` 重新合成为 MP4
- 在波形时间线上选择一段源音频，并用另一段音频替换

## 开发

当前版本依赖系统环境中的 `ffmpeg` 和 `ffprobe`。Windows 上可以先将 FFmpeg 加入 `PATH`；后续打包时再把平台对应的二进制一起分发。

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
npm run preview
```

## 后续方向

- 打包 Windows 安装包，并内置 FFmpeg
- 增加裁剪、静音、淡入淡出、增益和批量队列
- 将波形编辑改为项目化的非破坏式时间线
- 接入 DashScope：ASR 转写、选区转写、TTS 生成替换片段
- 增加云端 API Key 的安全存储
- 增加更完整的视频裁切框、旋转、黑边检测和字幕轨处理
- 补齐 macOS / Ubuntu 的路径、权限和打包配置
