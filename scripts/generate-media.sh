#!/usr/bin/env bash
# Generates original placeholder clips (9:16, H.264 + quiet AAC tone) and poster
# frames into assets/media. Everything here is synthesized by ffmpeg, so there are
# no third-party rights to track.
set -euo pipefail

OUT="$(cd "$(dirname "$0")/.." && pwd)/assets/media"
mkdir -p "$OUT"
FONT="/System/Library/Fonts/Avenir Next.ttc"
DUR=8
W=720
H=1280

caption() {
  # $1 = text. Bold white text on a black box, Shorts/Reels style.
  local t="${1//:/\\:}"
  echo "drawtext=fontfile='${FONT}':text='${t}':fontsize=42:fontcolor=white:box=1:boxcolor=black@0.85:boxborderw=18:x=(w-text_w)/2:y=h*0.17"
}

encode() {
  # $1 = name, $2 = video filtergraph source, $3 = base audio frequency
  local name="$1" src="$2" f="$3"
  echo "→ $name"
  ffmpeg -v error -y \
    -f lavfi -i "$src" \
    -f lavfi -i "aevalsrc=0.04*sin(2*PI*${f}*t)*(0.6+0.4*sin(2*PI*0.5*t))+0.025*sin(2*PI*${f}*1.5*t):s=44100:d=${DUR}" \
    -t "$DUR" -r 30 -c:v libx264 -preset veryfast -crf 27 -maxrate 1600k -bufsize 3200k -pix_fmt yuv420p \
    -g 30 -keyint_min 30 -sc_threshold 0 -profile:v high \
    -c:a aac -b:a 64k -shortest -movflags +faststart \
    "$OUT/$name.mp4"
  ffmpeg -v error -y -ss 0.4 -i "$OUT/$name.mp4" -frames:v 1 -vf "scale=360:-2" -q:v 6 "$OUT/$name.jpg"
}

encode aurora \
  "gradients=s=${W}x${H}:r=30:d=${DUR}:c0=0x0f2027:c1=0x2c5364:c2=0x00c9a7:c3=0x845ec2:n=4:speed=0.03:type=radial,$(caption 'POV: you check the source')" 220

encode fractal \
  "mandelbrot=s=360x640:r=30:start_scale=3:end_scale=0.02:end_pts=240:maxiter=2000:start_x=-0.743643887037158:start_y=0.131825904205311,scale=${W}:${H}:flags=bicubic,$(caption 'Zoom in. Keep going.')" 196

encode petri \
  "life=s=180x320:r=30:mold=12:ratio=0.12:death_color=#2b0f54:life_color=#ff6f91:mold_color=#ffc75f,scale=${W}:${H}:flags=neighbor,$(caption 'Is this real or generated?')" 262

encode sunset \
  "gradients=s=${W}x${H}:r=30:d=${DUR}:c0=0xff5f6d:c1=0xffc371:c2=0x6a0572:n=3:speed=0.05:type=linear,$(caption 'Golden hour hits different')" 174

encode rule110 \
  "cellauto=rule=110:s=360x640:r=30:full=1:random_fill_ratio=0.5,format=gray,scale=${W}:${H}:flags=neighbor,lutrgb=r=val*0.3:g=val*0.9:b=val,$(caption 'Simple rules. Wild results.')" 294

encode nebula \
  "gradients=s=${W}x${H}:r=30:d=${DUR}:c0=0x12002f:c1=0x3a0ca3:c2=0xf72585:c3=0x4cc9f0:n=4:speed=0.04:type=spiral,$(caption 'Wait for the end...')" 247

encode drift \
  "mandelbrot=s=360x640:r=30:start_scale=0.3:end_scale=0.05:end_pts=240:maxiter=800:start_x=-0.1011:start_y=0.9563,scale=${W}:${H}:flags=bicubic,hue=h=t*25,$(caption 'Nobody talks about this')" 330

encode tide \
  "gradients=s=${W}x${H}:r=30:d=${DUR}:c0=0x00467f:c1=0xa5cc82:c2=0x1d976c:n=3:speed=0.06:type=circular,$(caption 'Rate this transition 1-10')" 208

echo "done: $(ls "$OUT" | wc -l | tr -d ' ') files in $OUT"
