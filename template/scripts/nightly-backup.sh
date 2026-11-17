#!/usr/bin/env bash
# nightly-backup.sh: copies every video's work (out/, text, the paid voice; not render scratch) to an rclone destination and
# checks each copy by checksum, by running `video archive` on every video folder of every channel. A template: nothing in
# this kit schedules it. Run it by hand, or schedule it yourself (cron, launchd, Task Scheduler), after you have tried it once.
#
# Set these (in the environment, or edit the two lines below):
#   BAGELUNIT_BACKUP_TO   where the copies go, an rclone destination, e.g. gdrive:Video Backups  (set the remote up with: rclone config)
#   BAGELUNIT_CHANNELS    folders to back up, separated by ":" (default: every channel in ~/.config/bagelunit-video/channels.json,
#                         else the folder above this script)
# Each video goes to $BAGELUNIT_BACKUP_TO/<channel folder name>/<video folder name>/. Log: $BAGELUNIT_BACKUP_LOG (default ~/bagelunit-backup.log).
set -uo pipefail
TO="${BAGELUNIT_BACKUP_TO:-}"                        # <- the placeholder: put your rclone destination here or in the environment
VIDEO="${BAGELUNIT_VIDEO:-$HOME/.claude/skills/bagelunit-video/tools/video.mjs}"
LOG="${BAGELUNIT_BACKUP_LOG:-$HOME/bagelunit-backup.log}"
[ -n "$TO" ] || { echo "set BAGELUNIT_BACKUP_TO to an rclone destination first (for example gdrive:Video Backups)"; exit 2; }
[ -f "$VIDEO" ] || { echo "the video kit is not installed ($VIDEO missing): run bash setup/install.sh in the kit"; exit 2; }
exec >>"$LOG" 2>&1
echo "=== $(date '+%Y-%m-%d %H:%M:%S') start"

channels=()
if [ -n "${BAGELUNIT_CHANNELS:-}" ]; then IFS=':' read -r -a channels <<<"$BAGELUNIT_CHANNELS"
else
  REG="${BAGELUNIT_VIDEO_CONFIG:-$HOME/.config/bagelunit-video}/channels.json"
  if [ -f "$REG" ]; then
    while IFS= read -r d; do channels+=("$d"); done < <(node -e 'for (const c of JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))) if (c && c.dir) console.log(c.dir)' "$REG")
  fi
  [ ${#channels[@]} -gt 0 ] || channels=("$(cd "$(dirname "$0")/.." && pwd)")
fi

ok=0; failed=0
for ch in "${channels[@]}"; do
  [ -d "$ch/videos" ] || { echo "skip $ch (no videos folder)"; continue; }
  for ep in "$ch"/videos/*/; do
    ep="${ep%/}"; name="$(basename "$ep")"
    [[ "$name" == .* || "$name" == _* ]] && continue
    [ -f "$ep/video.json" ] || continue
    if node "$VIDEO" archive "$ep" --to "$TO/$(basename "$ch")"; then ok=$((ok+1)); else failed=$((failed+1)); echo "FAILED: $ep"; fi
  done
done
echo "=== $(date '+%H:%M:%S') done: $ok archived, $failed failed"
[ "$failed" -eq 0 ]
