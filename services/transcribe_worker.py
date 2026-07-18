#!/usr/bin/env python3
import sys
import json
from faster_whisper import WhisperModel

def main():
    if len(sys.argv) != 3:
        print("Usage: python3 transcribe_worker.py <audio_path> <output_json_path>", file=sys.stderr)
        sys.exit(1)

    audio_path = sys.argv[1]
    output_path = sys.argv[2]

    model_size = "small"
    model = WhisperModel(model_size, device="cpu", compute_type="int8")

    segments, _info = model.transcribe(audio_path, word_timestamps=True, language="en")

    words = []
    for segment in segments:
        for w in segment.words:
            words.append({
                "word": w.word.strip(),
                "start": round(w.start, 3),
                "end": round(w.end, 3),
            })

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump({"words": words}, f, ensure_ascii=False, indent=2)

    print(f"Wrote {len(words)} word timestamps to {output_path}")

if __name__ == "__main__":
    main()
