#!/bin/bash
# install.sh - 安装 native messaging host
#   1. 编译 Swift 二进制到 native-host/mic-monitor
#   2. 注册 NativeMessagingHosts manifest 到 ~/Library
#   3. 提示用户填入扩展 ID

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"
HOST_PATH="$SCRIPT_DIR/mic-monitor"

echo "==> 1/3 编译 mic-monitor"
./build.sh

echo ""
echo "==> 2/3 注册 native messaging manifest"

NATIVE_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
mkdir -p "$NATIVE_DIR"

# 读取扩展 ID（如果用户传入了）
EXTENSION_ID="${1:-EXTENSION_ID_HERE}"

HOST_PATH_JSON=$(printf '%s' "$HOST_PATH" | sed 's/\\/\\\\/g; s/"/\\"/g')

cat > "$NATIVE_DIR/com.micpause.host.json" <<EOF
{
  "name": "com.micpause.host",
  "description": "Mic Pause - 系统级麦克风活动监听",
  "path": "$HOST_PATH_JSON",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://${EXTENSION_ID}/"
  ]
}
EOF

echo "已写入: $NATIVE_DIR/com.micpause.host.json"

echo ""
echo "==> 3/3 完成"
echo ""
echo "下一步："
echo "  1. 打开 chrome://extensions"
echo "  2. 开启右上角'开发者模式'"
echo "  3. 点击'加载已解压的扩展程序'，选择:"
echo "     $SCRIPT_DIR/../extension"
echo "  4. 复制扩展 ID，重跑本脚本把 ID 写进 manifest:"
echo "     ./install.sh <你的扩展 ID>"
echo ""
echo "  5. 如果需要 Chrome 自启动 host（service worker 不活跃时不阻塞监听），"
echo "     可以把 host 注册到系统 launchd（高级用法，见 README）"
