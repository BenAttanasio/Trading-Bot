#!/bin/bash
# Wait up to 30s for dashboard to be ready before opening browser
for i in $(seq 1 30); do
  STATUS=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:5173)
  if [ "$STATUS" = "200" ]; then
    break
  fi
  sleep 1
done

WAYLAND_DISPLAY=wayland-0 XDG_RUNTIME_DIR=/run/user/1000 \
  chromium --ozone-platform=wayland \
  --start-fullscreen \
  --app=http://localhost:5173 \
  2>/dev/null
