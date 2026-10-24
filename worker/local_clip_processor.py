"""Local, CPU-only clip processor for the Aura OS free beta.

Uses Faster-Whisper for timestamps, ranks transcript windows with transparent
language heuristics, then renders captioned vertical MP4s with FFmpeg. It is
intended for short, user-owned uploads and a single creator workstation.
"""

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse

import requests
from faster_whisper import WhisperModel

MAX_BYTES = 45 * 1024 * 1024
MAX_DURATION_SECONDS = 30 * 60
WINDOW_SECONDS = 35.0
MAX_CLIPS = 5
HIGHLIGHT_WORDS = {
    "because", "secret", "mistake", "finally", "never", "always", "lesson",
    "why", "how", "believe", "discover", "best", "worst", "first", "changed",
    "important", "actually", "learned", "result", "surprised", "remember",
}
STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from",
    "i", "if", "in", "is", "it", "of", "on", "or", "that", "the", "this",
    "to", "was", "we", "were", "with", "you", "your",
}


def log(message):
    print(message, file=sys.stderr, flush=True)


def run(command, *, cwd=None, timeout=1800, capture=True):
    try:
        return subprocess.run(
            command,
            cwd=cwd,
            check=True,
            text=True,
            stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
            stderr=subprocess.PIPE if capture else subprocess.DEVNULL,
            timeout=timeout,
        )
    except FileNotFoundError as exc:
        raise RuntimeError("FFmpeg and FFprobe must be installed and available on PATH.") from exc
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or "").strip()[-1200:]
        raise RuntimeError("FFmpeg could not process this video. " + detail) from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("A video processing step exceeded its time limit.") from exc


def download_source(source_url, supabase_origin, target):
    requested = urlparse(source_url)
    project = urlparse(supabase_origin)
    if requested.scheme != "https" or requested.hostname != project.hostname:
        raise RuntimeError("Only a signed Aura upload can be processed. Upload a video file you own or have permission to edit.")
    if not requested.path.startswith("/storage/v1/object/sign/source-videos/"):
        raise RuntimeError("The source link is not a signed private Aura upload.")

    total = 0
    try:
        with requests.get(source_url, stream=True, timeout=(20, 120), allow_redirects=False) as response:
            response.raise_for_status()
            header_size = response.headers.get("content-length")
            if header_size and int(header_size) > MAX_BYTES:
                raise RuntimeError("This file is larger than the 45 MB free-beta limit.")
            with target.open("wb") as output:
                for chunk in response.iter_content(chunk_size=1024 * 1024):
                    if not chunk:
                        continue
                    total += len(chunk)
                    if total > MAX_BYTES:
                        raise RuntimeError("This file is larger than the 45 MB free-beta limit.")
                    output.write(chunk)
    except requests.RequestException as exc:
        raise RuntimeError("Could not download the private source video. Check the upload and Supabase connection.") from exc
    if total == 0:
        raise RuntimeError("The uploaded source video is empty.")


def get_duration(source):
    result = run([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(source),
    ], timeout=60)
    try:
        duration = float(result.stdout.strip())
    except (ValueError, TypeError) as exc:
        raise RuntimeError("Could not read the video duration.") from exc
    if duration < 10:
        raise RuntimeError("Upload a video that is at least 10 seconds long.")
    if duration > MAX_DURATION_SECONDS:
        raise RuntimeError("Free-beta videos must be 30 minutes or shorter.")
    return duration


def transcribe(source, work_dir, model_name):
    audio_path = work_dir / "aura-audio.wav"
    run([
        "ffmpeg", "-nostdin", "-y", "-i", str(source), "-vn", "-ac", "1",
        "-ar", "16000", "-f", "wav", str(audio_path),
    ], timeout=900)
    if not audio_path.exists() or audio_path.stat().st_size < 1024:
        raise RuntimeError("This source has no usable speech audio.")

    if model_name not in {"tiny", "base", "small"}:
        model_name = "base"
    log("Loading the local Whisper " + model_name + " model (first run downloads it once).")
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    segments, _ = model.transcribe(
        str(audio_path), beam_size=1, word_timestamps=True, vad_filter=True,
    )
    words = []
    for segment in segments:
        segment_text = (segment.text or "").strip()
        segment_words = getattr(segment, "words", None) or []
        if segment_words:
            for word in segment_words:
                text = clean_text(getattr(word, "word", ""))
                start = getattr(word, "start", None)
                end = getattr(word, "end", None)
                if text and start is not None and end is not None and float(end) > float(start):
                    words.append({"text": text, "start": float(start), "end": float(end)})
        elif segment_text:
            pieces = segment_text.split()
            span = max(0.1, float(segment.end) - float(segment.start))
            for index, piece in enumerate(pieces):
                start = float(segment.start) + span * index / len(pieces)
                end = float(segment.start) + span * (index + 1) / len(pieces)
                words.append({"text": clean_text(piece), "start": start, "end": end})
    if len(words) < 8:
        raise RuntimeError("Aura could not find enough clear speech to make clips. Try a video with spoken audio.")
    return words


def clean_text(value):
    return re.sub(r"\s+", " ", str(value or "").replace("<", "").replace(">", "")).strip()


def ranked_windows(words, duration):
    clip_length = min(WINDOW_SECONDS, duration)
    last_start = max(0.0, duration - clip_length)
    starts = [float(value) for value in range(0, int(last_start) + 1, 5)]
    if not starts or starts[-1] < last_start:
        starts.append(last_start)

    candidates = []
    for window_start in starts:
        window_end = min(duration, window_start + clip_length)
        part = [word for word in words if word["start"] < window_end and word["end"] > window_start]
        if len(part) < 12:
            continue
        aligned_start = max(0.0, part[0]["start"] - 0.35)
        clip_end = min(duration, aligned_start + clip_length)
        part = [word for word in words if word["start"] < clip_end and word["end"] > aligned_start]
        text = " ".join(word["text"] for word in part).strip()
        score = score_window(text, part)
        candidates.append({
            "start": aligned_start,
            "end": clip_end,
            "text": text,
            "words": part,
            "score": score,
        })

    selected = []
    for candidate in sorted(candidates, key=lambda item: (item["score"], len(item["words"])), reverse=True):
        if all(overlap(candidate, chosen) < 0.45 * min(candidate["end"] - candidate["start"], chosen["end"] - chosen["start"]) for chosen in selected):
            selected.append(candidate)
        if len(selected) >= MAX_CLIPS:
            break
    selected.sort(key=lambda item: item["start"])
    return selected


def score_window(text, words):
    tokens = re.findall(r"[a-zA-Z']+", text.lower())
    if not tokens:
        return 0
    meaningful = [token for token in tokens if token not in STOPWORDS]
    unique_ratio = len(set(meaningful)) / max(1, len(meaningful))
    cue_hits = sum(1 for token in tokens if token in HIGHLIGHT_WORDS)
    punctuation = text.count("?") * 5 + text.count("!") * 4
    speech_density = min(1.0, len(words) / 62.0) * 32
    lexical_variety = min(1.0, unique_ratio / 0.62) * 17
    cue_score = min(20, cue_hits * 4)
    sentence_score = min(14, punctuation)
    return int(max(1, min(100, round(17 + speech_density + lexical_variety + cue_score + sentence_score))))


def overlap(left, right):
    return max(0.0, min(left["end"], right["end"]) - max(left["start"], right["start"]))


def srt_time(seconds):
    millis = max(0, int(round(seconds * 1000)))
    hours, millis = divmod(millis, 3_600_000)
    minutes, millis = divmod(millis, 60_000)
    seconds_value, millis = divmod(millis, 1000)
    return f"{hours:02}:{minutes:02}:{seconds_value:02},{millis:03}"


def write_captions(words, start, end, target):
    clipped = [word for word in words if word["start"] < end and word["end"] > start]
    groups = []
    current = []
    for word in clipped:
        current.append(word)
        current_text = " ".join(item["text"] for item in current)
        if len(current) >= 5 or len(current_text) >= 32:
            groups.append(current)
            current = []
    if current:
        groups.append(current)
    if not groups:
        raise RuntimeError("No captions were produced for a selected moment.")

    lines = []
    for index, group in enumerate(groups, 1):
        local_start = max(0.0, group[0]["start"] - start)
        local_end = min(end - start, max(group[-1]["end"] - start, local_start + 0.2))
        caption = " ".join(item["text"] for item in group).strip()
        lines.extend([str(index), f"{srt_time(local_start)} --> {srt_time(local_end)}", caption, ""])
    target.write_text("\n".join(lines), encoding="utf-8")


def make_title(text, index):
    sentence = re.split(r"(?<=[.!?])\s+", text, maxsplit=1)[0].strip()
    sentence = sentence.strip(" .!?-—")
    if not sentence:
        return f"Aura moment {index}"
    return (sentence[:76].rstrip() + ("…" if len(sentence) > 76 else ""))


def render_clip(source, work_dir, candidate, index, has_audio):
    subtitle = work_dir / f"captions-{index:03}.srt"
    output = work_dir / f"clip-{index:03}.mp4"
    write_captions(candidate["words"], candidate["start"], candidate["end"], subtitle)
    duration = candidate["end"] - candidate["start"]
    video_filter = (
        "scale=720:1280:force_original_aspect_ratio=increase,"
        "crop=720:1280,"
        "zoompan=z='min(zoom+0.00035\\,1.06)':"
        "x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
        "d=1:s=720x1280:fps=30,subtitles=" + subtitle.name
    )
    command = [
        "ffmpeg", "-nostdin", "-y", "-ss", f"{candidate['start']:.3f}", "-t", f"{duration:.3f}",
        "-i", str(source),
    ]
    if has_audio:
        command.extend(["-f", "lavfi", "-i", "anoisesrc=color=pink:sample_rate=48000:duration=0.45"])
        audio_mix = (
            "[0:a:0]aresample=48000[base];"
            "[1:a:0]highpass=f=700,lowpass=f=6000,"
            "afade=t=in:st=0:d=0.03,afade=t=out:st=0.05:d=0.4,volume=0.035[sfx];"
            "[base][sfx]amix=inputs=2:duration=first:dropout_transition=0[aout]"
        )
        command.extend([
            "-vf", video_filter, "-filter_complex", audio_mix,
            "-map", "0:v:0", "-map", "[aout]",
        ])
    else:
        command.extend(["-vf", video_filter, "-an"])
    command.extend([
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "25", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(output),
    ])
    run(command, cwd=work_dir, timeout=900)
    if not output.exists() or output.stat().st_size < 1024:
        raise RuntimeError("FFmpeg did not create a usable MP4 clip.")
    return output


def process(request):
    work_dir = Path(request["workDir"]).resolve()
    source = work_dir / "source-video"
    source_url = str(request.get("sourceUrl", ""))
    supabase_origin = str(request.get("supabaseOrigin", ""))
    download_source(source_url, supabase_origin, source)
    duration = get_duration(source)
    has_audio_result = run([
        "ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=index",
        "-of", "csv=p=0", str(source),
    ], timeout=60)
    has_audio = bool(has_audio_result.stdout.strip())
    if not has_audio:
        raise RuntimeError("Add spoken audio to this video so Aura can find and caption its moments.")

    log("Transcribing the uploaded source video on this computer.")
    words = transcribe(source, work_dir, str(request.get("model", "base")))
    candidates = ranked_windows(words, duration)
    if not candidates:
        raise RuntimeError("Aura could not find clear 12-word moments in this video. Try a video with more speech.")

    clips = []
    for index, candidate in enumerate(candidates, 1):
        log(f"Rendering clip {index} of {len(candidates)}.")
        output = render_clip(source, work_dir, candidate, index, has_audio)
        clips.append({
            "output_index": index,
            "title": make_title(candidate["text"], index),
            "start_seconds": round(candidate["start"], 3),
            "end_seconds": round(candidate["end"], 3),
            "virality_score": candidate["score"],
            "transcript": candidate["text"][:12000],
            "output_file": str(output),
        })
    return {"clips": clips}


if __name__ == "__main__":
    try:
        request = json.loads(sys.stdin.read())
        result = process(request)
        print(json.dumps(result, ensure_ascii=False), flush=True)
    except Exception as exc:
        log(str(exc) or "Local processing failed.")
        sys.exit(1)
