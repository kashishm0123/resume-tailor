#!/bin/bash
# Double-click this file (macOS) to start Resume Tailor and open it in your browser.
cd "$(dirname "$0")"
[ -d node_modules ] || npm install
(sleep 1.5 && open http://localhost:4747) &
node server.js
