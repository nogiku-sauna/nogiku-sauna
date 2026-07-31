#!/usr/bin/env bash
# ==========================================================================
# NOGIKU HTTPS(鍵マーク)設定
#  - certbot をインストール
#  - nginx を api.nogikusauna.com 用に設定
#  - Let's Encrypt の無料証明書を取得し、https を自動設定（http は https に転送）
# ==========================================================================
set -e
export DEBIAN_FRONTEND=noninteractive

echo "=== [1/3] certbot をインストールします ==="
apt-get install -y certbot python3-certbot-nginx

echo "=== [2/3] nginx をドメイン用に設定します ==="
cat >/etc/nginx/sites-available/nogiku <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name api.nogikusauna.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGINX
nginx -t
systemctl reload nginx

echo "=== [3/3] 証明書を取得して https を設定します ==="
certbot --nginx -d api.nogikusauna.com \
  --non-interactive --agree-tos --no-eff-email \
  -m nogikusauna@gmail.com --redirect

echo ""
echo "=== 完了！ https://api.nogikusauna.com/health を開いて、鍵マークを確認してください ==="
