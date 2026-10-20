# Pipeline: copy-paste scripts (bash 3.2 safe)

Set these once. `NAMES` is the ordered section ids; the last is the hero/finale.

```bash
WORK=/tmp/scroll-world           # scratch dir for prompts, sources, frames
ASSETS=./assets                  # where the site reads stills (webp) + clips (mp4)
mkdir -p "$WORK" "$ASSETS/vid"
NAMES="farm kitchen shop delivery plaza finale"   # <-- your section ids, in order

# Chain video model — ONE for every chained clip (SKILL Step 4 roster).
VMODEL=seedance_2_0
case "$VMODEL" in
  kling3_0)          VOPTS="--mode std --sound off";          DIVE_DUR=10; CONN_DUR=5 ;;
  seedance_2_0_mini) VOPTS="--mode std --resolution 720p";    DIVE_DUR=8;  CONN_DUR=5 ;;
  *)                 VOPTS="--mode std --resolution 1080p";   DIVE_DUR=8;  CONN_DUR=5 ;;
esac
```

Higgsfield generations take minutes — every `higgsfield ... --wait` call below is meant
to run inside a **backgrounded** script.

## 1. Scene stills (Step 2)

Write one prompt file per section to `$WORK/still_<name>.txt` (see prompts.md), then:

```bash
gen_still() { # name
  higgsfield generate create gpt_image_2 --prompt "$(cat "$WORK/still_$1.txt")" \
    --aspect_ratio 3:2 --resolution 2k --quality high --wait --wait-timeout 15m --json \
    > "$WORK/still_$1.json" 2> "$WORK/still_$1.err"
  url=$(jq -r '.[0].result_url // empty' "$WORK/still_$1.json")
  [ -n "$url" ] && curl -fsSL "$url" -o "$WORK/still_$1.png" && echo "still $1 ok" || echo "still $1 FAIL"
}
for n in $NAMES; do gen_still "$n" & done ; wait
```

Codex variant (STILLS_SOURCE=codex, subscription-billed, zero credits):

```bash
gen_still_codex() { # name
  codex exec -C "$WORK" -s workspace-write --skip-git-repo-check \
    'Use the image generation tool ($imagegen) to generate: '"$(cat "$WORK/still_$1.txt")"' Wide 3:2 landscape, high resolution. Save it as ./still_'"$1"'.png. Do not do anything else.' \
    > "$WORK/still_$1.codex.log" 2>&1 < /dev/null
  [ -f "$WORK/still_$1.png" ] && echo "still $1 ok (codex)" || echo "still $1 FAIL (see .codex.log)"
}
```

Convert to webp for the site:

```bash
for n in $NAMES; do cwebp -quiet -q 84 -resize 1800 0 "$WORK/still_$n.png" -o "$ASSETS/$n.webp"; done
```

## 2. Dive-in clips (Step 4)

```bash
gen_dive() { # name
  higgsfield generate create "$VMODEL" --prompt "$(cat "$WORK/dive_$1.txt")" \
    --start-image "$WORK/still_$1.png" \
    $VOPTS --aspect_ratio 16:9 --duration "$DIVE_DUR" \
    --wait --wait-timeout 20m --json > "$WORK/dive_$1.json" 2> "$WORK/dive_$1.err"
  url=$(jq -r '.[0].result_url // empty' "$WORK/dive_$1.json")
  [ -n "$url" ] && curl -fsSL "$url" -o "$WORK/dive_$1.mp4" && echo "dive $1 ok" || echo "dive $1 FAIL"
}
for n in $NAMES; do gen_dive "$n" & done ; wait
```

## 3. Extract boundary frames (Step 5)

```bash
set -- $NAMES
prev=""
for n in "$@"; do
  ffmpeg -v error -ss 0 -i "$WORK/dive_$n.mp4" -frames:v 1 -q:v 2 "$WORK/first_$n.png"
  ffmpeg -v error -sseof -0.15 -i "$WORK/dive_$n.mp4" -frames:v 1 -q:v 2 "$WORK/last_$n.png"
done
```

## 4. Connector clips (Step 5)

```bash
gen_conn() { # i startPng endPng
  higgsfield generate create "$VMODEL" --prompt "$(cat "$WORK/conn_$1.txt")" \
    --start-image "$2" --end-image "$3" \
    $VOPTS --aspect_ratio 16:9 --duration "$CONN_DUR" \
    --wait --wait-timeout 20m --json > "$WORK/conn_$1.json" 2> "$WORK/conn_$1.err"
  url=$(jq -r '.[0].result_url // empty' "$WORK/conn_$1.json")
  [ -n "$url" ] && curl -fsSL "$url" -o "$WORK/conn_$1.mp4" && echo "conn $1 ok" || echo "conn $1 FAIL"
}
set -- $NAMES ; i=0 ; prev=""
for n in "$@"; do
  if [ -n "$prev" ]; then i=$((i+1)); gen_conn "$i" "$WORK/last_$prev.png" "$WORK/first_$n.png" & fi
  prev="$n"
done ; wait
```

## 5. Encode for scrubbing (Step 6)

```bash
enc() { ffmpeg -v error -y -i "$1" -an -vf "unsharp=5:5:0.8:5:5:0.0" \
  -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p \
  -g 8 -keyint_min 8 -sc_threshold 0 -movflags +faststart "$2"; echo "enc $2 $(du -h "$2"|cut -f1)"; }

for n in $NAMES; do enc "$WORK/dive_$n.mp4" "$ASSETS/vid/$n.mp4"; done
i=0; for f in "$WORK"/conn_*.mp4; do i=$((i+1)); enc "$f" "$ASSETS/vid/conn$i.mp4"; done
```

## 6. Mobile crop encodes (FALLBACK ONLY)

```bash
encm() { ffmpeg -v error -y -i "$1" -an -vf "scale=-2:720,unsharp=5:5:0.6:5:5:0.0" \
  -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p \
  -g 4 -keyint_min 4 -sc_threshold 0 -movflags +faststart "$2"; echo "encm $2 $(du -h "$2"|cut -f1)"; }

for n in $NAMES; do encm "$WORK/dive_$n.mp4" "$ASSETS/vid/$n-m.mp4"; done
i=0; for f in "$WORK"/conn_*.mp4; do i=$((i+1)); encm "$f" "$ASSETS/vid/conn$i-m.mp4"; done
```

## 7. Monid backend — Seedance 2.0 (DEFAULT)

```bash
monid_frame_url() { # localPng remoteName
  jpg="$WORK/sfs_$2.jpg"
  ffmpeg -v error -y -i "$1" -vf "scale='min(1536,iw)':-2" -q:v 2 "$jpg"
  size=$(stat -f%z "$jpg")
  up=$(NO_COLOR=1 monid run -p sfs -e /put \
    -i "{\"path\":\"chain/$2.jpg\",\"sizeBytes\":$size,\"ttl\":\"1h\"}" -w 60 -j \
    | jq -r '.output.uploadUrl')
  curl -fsS -T "$jpg" "$up" > /dev/null
  NO_COLOR=1 monid run -p sfs -e /cat -i "{\"path\":\"chain/$2.jpg\",\"ttl\":\"1d\"}" \
    -w 60 -j | jq -r '.output.url'
}

monid_wait() { # runId outJson
  while :; do
    NO_COLOR=1 monid runs get -r "$1" -j > "$2" 2>/dev/null
    case "$(jq -r '.status // empty' "$2")" in
      COMPLETED|FAILED|BLOCKED|STOPPED|TIME_OUT) break ;;
    esac
    sleep 8
  done
}

gen_dive_monid() { # name
  furl=$(monid_frame_url "$WORK/still_$1.png" "still_$1")
  jq -n --arg p "$(cat "$WORK/dive_$1.txt")" --arg u "$furl" --arg r "$VRES" \
    '{content:[{type:"text",text:$p},
               {type:"image_url",image_url:{url:$u},role:"first_frame"}],
      resolution:$r, duration:'"$DIVE_DUR"', ratio:"16:9", generate_audio:false}' \
    > "$WORK/dive_$1.body.json"
  rid=$(NO_COLOR=1 monid run -p bytedance -e /v1/video/seedance-2.0 \
    -f "$WORK/dive_$1.body.json" -j | jq -r '.runId')
  monid_wait "$rid" "$WORK/dive_$1.json"
  url=$(jq -r '.output.content.video_url // empty' "$WORK/dive_$1.json")
  [ -n "$url" ] && curl -fsSL "$url" -o "$WORK/dive_$1.mp4" \
    && echo "dive $1 ok (\$$(jq -r '.cost.value' "$WORK/dive_$1.json"))" \
    || echo "dive $1 FAIL ($(jq -r '.status' "$WORK/dive_$1.json"))"
}

gen_conn_monid() { # i startPng endPng
  su=$(monid_frame_url "$2" "conn$1_start"); eu=$(monid_frame_url "$3" "conn$1_end")
  jq -n --arg p "$(cat "$WORK/conn_$1.txt")" --arg s "$su" --arg e "$eu" --arg r "$VRES" \
    '{content:[{type:"text",text:$p},
               {type:"image_url",image_url:{url:$s},role:"first_frame"},
               {type:"image_url",image_url:{url:$e},role:"last_frame"}],
      resolution:$r, duration:'"$CONN_DUR"', ratio:"16:9", generate_audio:false}' \
    > "$WORK/conn_$1.body.json"
  rid=$(NO_COLOR=1 monid run -p bytedance -e /v1/video/seedance-2.0 \
    -f "$WORK/conn_$1.body.json" -j | jq -r '.runId')
  monid_wait "$rid" "$WORK/conn_$1.json"
  url=$(jq -r '.output.content.video_url // empty' "$WORK/conn_$1.json")
  [ -n "$url" ] && curl -fsSL "$url" -o "$WORK/conn_$1.mp4" \
    && echo "conn $1 ok (\$$(jq -r '.cost.value' "$WORK/conn_$1.json"))" \
    || echo "conn $1 FAIL ($(jq -r '.status' "$WORK/conn_$1.json"))"
}
```
