#!/usr/bin/env bash
# ==========================================================================
# NOGIKU デプロイ設定
#  1) サーバープログラムを「常時起動」にする（systemd）
#  2) nginx で 外部(80番) -> プログラム(3000番) に橋渡し
#  3) ファイアウォール(ufw)で 22/80/443 を許可
# ==========================================================================
set -e

echo "=== [1/3] 常時起動サービスを作成します ==="
cat >/etc/systemd/system/nogiku.service <<'UNIT'
[Unit]
Description=NOGIKU booking server
After=network.target

[Service]
Type=simple
WorkingDirectory=/root/app
ExecStart=/usr/bin/node /root/app/server.js
Environment=PORT=3000
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable nogiku
systemctl restart nogiku
echo "  -> nogiku サービスを起動しました"

echo "=== [2/3] nginx の橋渡し設定をします ==="
cat >/etc/nginx/sites-available/nogiku <<'NGINX'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/nogiku /etc/nginx/sites-enabled/nogiku
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl restart nginx
echo "  -> nginx を設定しました"

echo "=== [3/3] ファイアウォールを設定します ==="
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
echo "  -> ファイアウォールを設定しました"

echo ""
echo "=== 状態確認 ==="
echo -n "  nogiku: "; systemctl is-active nogiku
echo -n "  nginx : "; systemctl is-active nginx
echo ""
echo "=== 完了！ このあと、パケットフィルター設定とアクセス確認に進みます ==="
