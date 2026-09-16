#!/bin/bash
# build.sh - 编译 Swift native messaging host
# 默认输出到本目录，避免安装时要求管理员权限。

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

OUTPUT_PATH="${MIC_PAUSE_BIN:-$SCRIPT_DIR/mic-monitor}"

echo "==> 编译 mic-monitor.swift -> $OUTPUT_PATH"

# 用 swiftc 直接编译，链接 CoreAudio / AudioToolbox / Foundation
# -O 优化，strip 减小体积
swiftc -O \
    -framework CoreAudio \
    -framework AudioToolbox \
    -framework Foundation \
    -o "$OUTPUT_PATH" \
    mic-monitor.swift

echo "==> 编译完成"

# 验证
if [ -f "$OUTPUT_PATH" ]; then
    ls -lh "$OUTPUT_PATH"
    file "$OUTPUT_PATH"
fi
