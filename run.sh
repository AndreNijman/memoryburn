#!/bin/sh
D="$HOME/.local/share/memoryburn"
exec "$D/venv/bin/python" -I "$D/MemoryBurn.pyc" "$@"
